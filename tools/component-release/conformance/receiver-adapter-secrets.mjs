#!/usr/bin/env node
// Deployment-owned bootstrap material for the existing receiver fixture. This
// does not create a binding/Principal/Resource, mint tokens, or deliver files.
// Native API output enters this run's own tenant KV once; the original adapter
// reader/Agent consumes its fixed SecretRefs later.
import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { basename, join } from 'node:path';
import { FlowError, main, parseArgs, privateText, UUID } from '../flow/lib.mjs';

const require = (condition, reason) => { if (!condition) throw new FlowError(reason, 2); };
await main(async () => {
  try {
    const args = parseArgs(process.argv.slice(2), ['input']);
    const input = JSON.parse(privateText(args.input));
    const deployment = input.deployment;
    require(/^\/volumes\/data\/kailo\/conformance\/runs\/[^/]+\/receiver\/apps\/deploy\/local$/.test(deployment ?? '')
      && realpathSync(deployment) === deployment, 'canonical isolated receiver deployment required');
    const root = deployment.split('/receiver/apps/')[0];
    require(/^kailo-receiver-[a-f0-9]{6,32}$/.test(input.project ?? '')
      && input.project === `kailo-receiver-${basename(root).split('-').at(-1)}`, 'adapter project differs from its isolated run');
    require(UUID.test(input.tenantId ?? '') && Array.isArray(input.endpoints) && input.endpoints.length === 2,
      'actual isolated tenant and two adapter intents required');
    const base = new URL(input.baoUrl);
    require(['http:', 'https:'].includes(base.protocol) && base.hostname === 'openbao' && base.origin === input.baoUrl
      && !base.username && !base.password, 'isolated in-network OpenBao origin required');
    const operator = JSON.parse(privateText(join(deployment, 'secrets/openbao_init.json'))).root_token;
    require(typeof operator === 'string' && operator, 'isolated operator delivery missing');
    const namespace = `tenants/${input.tenantId}`, ids = new Set(), roles = new Set();
    // Validate every path before the first HTTP call or mutation.
    const entries = input.endpoints.flatMap((endpoint) => {
      require(['SOURCE', 'RECEIVER'].includes(endpoint.role) && !roles.has(endpoint.role)
        && UUID.test(endpoint.bindingId ?? '') && !ids.has(endpoint.bindingId), 'distinct fixed adapter intents required');
      roles.add(endpoint.role); ids.add(endpoint.bindingId);
      const nativeKey = endpoint.role === 'SOURCE' ? 'cells_bearer' : 'native_mcp_bearer';
      const expectedFile = join(root, endpoint.role === 'SOURCE' ? 'receiver/source-cells/secrets/service.pat' : 'receiver/knowledge/mcp-bearer');
      require(endpoint.nativeFile === expectedFile && realpathSync(expectedFile) === expectedFile, 'native credential must belong to the exact isolated component');
      const native = privateText(expectedFile).trim();
      require(native && !/[\s\x00]/.test(native), 'native credential unavailable');
      require(Array.isArray(endpoint.secretRefs) && endpoint.secretRefs.length === 2, 'two fixed adapter SecretRefs required');
      const keys = new Set();
      return endpoint.secretRefs.map((ref) => {
        const key = ref.secretKey;
        require([nativeKey, 'oidc_client_secret'].includes(key) && !keys.has(key), 'adapter secret schema differs');
        keys.add(key);
        require(Object.keys(ref).sort().join(',') === 'audience,locator,secretKey,version'
          && ref.locator === `${namespace}/kv/application-binding/${endpoint.bindingId}/${key}` && ref.version === 1
          && ref.audience === (endpoint.role === 'SOURCE' ? 'kailo-adapter-file-storage' : 'kailo-adapter-knowledge'), 'fixed original binding SecretRef required');
        return { path: `/v1/kv/data/application-binding/${endpoint.bindingId}/${key}`, value: key === nativeKey ? native : undefined };
      });
    });
    const api = async (method, path, body, missing = false) => {
      const response = await fetch(new URL(path, base), { method, redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { 'content-type': 'application/json', 'x-vault-token': operator, 'x-vault-namespace': namespace },
        body: body === undefined ? undefined : JSON.stringify(body) });
      if (missing && response.status === 404) return null;
      require(response.ok, `isolated adapter OpenBao ${method} refused (${response.status})`);
      const raw = await response.text(); return raw ? JSON.parse(raw) : {};
    };
    const mounts = (await api('GET', '/v1/sys/mounts')).data;
    require(mounts?.['kv/']?.type === 'kv' && mounts['kv/'].options?.version === '2', 'original tenant KV v2 provisioning incomplete');
    require((await api('GET', '/v1/sys/auth')).data?.['approle/']?.type === 'approle', 'original tenant AppRole provisioning incomplete');
    // Read/validate the whole existing set before creating any missing value.
    for (const entry of entries) {
      entry.stored = await api('GET', entry.path, undefined, true);
      if (entry.stored) validate(entry);
    }
    function validate(entry) {
      const stored = entry.stored, value = stored?.data?.data?.value;
      require(stored?.data?.metadata?.version === 1 && Object.keys(stored.data.data).join(',') === 'value'
        && typeof value === 'string' && value && !/[\s\x00]/.test(value)
        && (entry.value === undefined || entry.value === value), 'adapter secret drift or native credential rotation requires explicit repair');
    }
    for (const entry of entries) {
      if (!entry.stored) {
        const value = entry.value ?? randomBytes(32).toString('base64url');
        // If the acknowledgement is lost, a later invocation reads before CAS0;
        // never overwrite a retained key or emit its plaintext to the operator.
        await api('POST', entry.path, { options: { cas: 0 }, data: { value } });
        entry.stored = await api('GET', entry.path);
        validate(entry);
        require(entry.stored.data.data.value === value, 'adapter KV create read-back differs');
      }
    }
    console.log(JSON.stringify({ step: 'receiver-adapter-secrets', status: 'FIXED_REFERENCES_PREPARED', references: entries.length }));
  } catch (error) {
    throw error instanceof FlowError ? error : new FlowError('isolated adapter secret preparation failed; credential details are not logged');
  }
});
