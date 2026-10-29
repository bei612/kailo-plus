#!/usr/bin/env node
// Isolated deployment operator: a fresh Gateway machine key lives in OpenBao.
// Only the original Agent delivers its private PEM to the Gateway-owned volume;
// Core receives only public JWKS through the existing start-core contract.
// This entry never signs a token or creates a Core/IdP business identity.
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import { lstatSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join, posix } from 'node:path';
import { FlowError, main, parseArgs, privateText } from '../flow/lib.mjs';

const require = (condition, message) => { if (!condition) throw new FlowError(message, 2); };
function write(path, content) {
  const next = `${path}.${randomBytes(8).toString('hex')}.next`;
  writeFileSync(next, content, { mode: 0o600, flag: 'wx' });
  renameSync(next, path);
}
const exact = (value, wanted) => Object.entries(wanted).every(([key, expected]) => JSON.stringify(value[key]) === JSON.stringify(expected));

await main(async () => {
  try {
    const args = parseArgs(process.argv.slice(2), ['input']);
    const input = JSON.parse(privateText(args.input));
    const deployment = input.deployment;
    require(/^\/volumes\/data\/kailo\/conformance\/runs\/[^/]+\/receiver\/apps\/deploy\/local$/.test(deployment ?? '')
      && realpathSync(deployment) === deployment, 'canonical isolated receiver deployment required');
    const root = deployment.split('/receiver/apps/')[0];
    require(/^kailo-receiver-[a-f0-9]{6,32}$/.test(input.project ?? '')
      && input.project === `kailo-receiver-${basename(root).split('-').at(-1)}`, 'Gateway project differs from its isolated run');
    const directory = join(root, 'receiver/gateway'), bootstrap = join(directory, 'bootstrap'), publicDirectory = join(directory, 'public');
    for (const path of [directory, bootstrap, publicDirectory]) {
      const info = lstatSync(path);
      require(realpathSync(path) === path && info.isDirectory() && info.uid === process.getuid()
        && (info.mode & (path === publicDirectory ? 0o022 : 0o077)) === 0, 'controlled Gateway delivery directories required');
    }
    for (const key of ['gatewayUid', 'gatewayGid', 'operatorUid', 'operatorGid']) {
      require(Number.isSafeInteger(input[key]) && input[key] >= 0 && input[key] < 2147483648, 'numeric delivery ownership required');
    }
    require(input.gatewayUid > 0 && input.operatorUid > 0 && input.operatorUid === process.getuid()
      && input.operatorGid === process.getgid(), 'independent Gateway and current operator ownership required');
    const base = new URL(input.baoUrl);
    require(['http:', 'https:'].includes(base.protocol) && base.hostname === 'openbao' && base.origin === input.baoUrl
      && !base.username && !base.password, 'isolated in-network OpenBao origin required');
    require(typeof input.privateRoot === 'string' && posix.isAbsolute(input.privateRoot) && input.privateRoot !== '/'
      && /^[A-Za-z0-9/_-]+$/.test(input.privateRoot) && posix.normalize(input.privateRoot) === input.privateRoot, 'Gateway private volume root required');
    const operator = JSON.parse(privateText(join(deployment, 'secrets/openbao_init.json'))).root_token;
    require(typeof operator === 'string' && operator.length > 0, 'isolated OpenBao operator delivery missing');
    const namespace = 'receiver-gateway', role = 'gateway-service-reader', mount = 'kv', keyPath = 'service-signing';
    const api = async (method, path, body, { namespaced = true, missing = false, wrap = false } = {}) => {
      const response = await fetch(new URL(path, base), { method, redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { 'content-type': 'application/json', 'x-vault-token': operator,
          ...(namespaced ? { 'x-vault-namespace': namespace } : {}), ...(wrap ? { 'x-vault-wrap-ttl': '5m' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      if (missing && response.status === 404) return null;
      require(response.ok, `isolated Gateway OpenBao ${method} refused (${response.status})`);
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    };
    if (!await api('GET', `/v1/sys/namespaces/${namespace}`, undefined, { namespaced: false, missing: true })) {
      await api('POST', `/v1/sys/namespaces/${namespace}`, {}, { namespaced: false });
    }
    let mounts = (await api('GET', '/v1/sys/mounts')).data;
    if (!mounts[`${mount}/`]) { await api('POST', `/v1/sys/mounts/${mount}`, { type: 'kv', options: { version: '2' } }); mounts = (await api('GET', '/v1/sys/mounts')).data; }
    require(mounts[`${mount}/`]?.type === 'kv' && mounts[`${mount}/`]?.options?.version === '2', 'Gateway namespace requires its own KV v2 mount');
    const keyId = 'gateway-service-1';
    const publicKey = (privateKey) => ({ ...createPublicKey(privateKey).export({ format: 'jwk' }), kid: keyId, alg: 'ES256', use: 'sig' });
    const materialPath = `/v1/${mount}/data/${keyPath}`;
    let stored = await api('GET', materialPath, undefined, { missing: true });
    if (!stored) {
      const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      await api('POST', materialPath, { options: { cas: 0 }, data: { project: input.project,
        private_key: privateKey.export({ format: 'pem', type: 'pkcs8' }), public_jwks: JSON.stringify({ keys: [publicKey(privateKey)] }) } });
      stored = await api('GET', materialPath);
    }
    const material = stored.data?.data;
    require(stored.data?.metadata?.version === 1 && material?.project === input.project
      && Object.keys(material).sort().join(',') === 'private_key,project,public_jwks', 'Gateway key version or owner differs; no automatic replacement');
    const privateKey = createPrivateKey(material.private_key);
    require(privateKey.asymmetricKeyType === 'ec' && privateKey.asymmetricKeyDetails?.namedCurve === 'prime256v1'
      && JSON.stringify(JSON.parse(material.public_jwks)) === JSON.stringify({ keys: [publicKey(privateKey)] }), 'stored Gateway public key differs from its private key');
    const auth = (await api('GET', '/v1/sys/auth')).data;
    if (!auth['approle/']) await api('POST', '/v1/sys/auth/approle', { type: 'approle' });
    else require(auth['approle/'].type === 'approle', 'Gateway AppRole mount differs');
    const policy = `path "${mount}/data/${keyPath}" { capabilities = ["read"] }\n`;
    const policyPath = `/v1/sys/policies/acl/${role}`;
    let current = await api('GET', policyPath, undefined, { missing: true });
    if (!current) { await api('PUT', policyPath, { policy }); current = await api('GET', policyPath); }
    require(current.data?.policy === policy, 'Gateway Agent policy differs; not overwritten');
    const rolePath = `/v1/auth/approle/role/${role}`;
    const wanted = { bind_secret_id: true, secret_id_num_uses: 1, token_policies: [role], token_ttl: 3600, token_max_ttl: 3600 };
    current = await api('GET', rolePath, undefined, { missing: true });
    if (!current) { await api('POST', rolePath, wanted); current = await api('GET', rolePath); }
    require(current.data && exact(current.data, wanted), 'Gateway Agent role differs; not overwritten');
    const roleId = (await api('GET', `${rolePath}/role-id`)).data?.role_id;
    const wrapped = (await api('POST', `${rolePath}/secret-id`, {}, { wrap: true })).wrap_info?.token;
    require(typeof roleId === 'string' && roleId && typeof wrapped === 'string' && wrapped, 'Gateway one-use Agent delivery missing');
    write(join(bootstrap, 'role-id'), roleId);
    write(join(bootstrap, 'wrapped-secret-id'), wrapped);
    const signingKeyFile = join(input.privateRoot, `${input.project}-service.pem`), jwksFile = join(publicDirectory, 'gateway-service.jwks.json');
    const quote = JSON.stringify;
    let hcl = `exit_after_auth = true\nvault { address = ${quote(input.baoUrl)} }\n`
      + `auto_auth {\n method "approle" {\n namespace = ${quote(namespace)}\n config = {\n`
      + `role_id_file_path = ${quote(join(bootstrap, 'role-id'))}\nsecret_id_file_path = ${quote(join(bootstrap, 'wrapped-secret-id'))}\n`
      + `secret_id_response_wrapping_path = ${quote(`auth/approle/role/${role}/secret-id`)}\n}\n}\n}\n`
      + 'template_config { exit_on_retry_failure = true }\n';
    for (const [field, destination, uid, gid, perms] of [
      ['private_key', signingKeyFile, input.gatewayUid, input.gatewayGid, '0600'],
      ['public_jwks', jwksFile, input.operatorUid, input.operatorGid, '0644'],
    ]) {
      const contents = `{{ with secret "${mount}/data/${keyPath}?version=1" }}{{ .Data.data.${field} }}{{ end }}`;
      hcl += `template {\n contents = ${quote(contents)}\n destination = ${quote(destination)}\n perms = ${quote(perms)}\n`
        + ` uid = ${uid}\n gid = ${gid}\n backup = false\n error_on_missing_key = true\n}\n`;
    }
    write(join(bootstrap, 'agent.hcl'), hcl);
    write(join(directory, 'identity.json'), JSON.stringify({ project: input.project, namespace, version: 1, keyId,
      issuer: `https://${input.project}.invalid/gateway-service`, audience: `${input.project}-gateway-core`, callerId: `${input.project}-gateway`,
      jwksFile, signingKeyFile, agentConfig: join(bootstrap, 'agent.hcl') }, null, 2) + '\n');
    console.log(JSON.stringify({ step: 'receiver-gateway-identity', status: 'AGENT_DELIVERY_PREPARED' }));
  } catch (error) {
    throw error instanceof FlowError ? error : new FlowError('isolated Gateway identity delivery failed; credential details are not logged');
  }
});
