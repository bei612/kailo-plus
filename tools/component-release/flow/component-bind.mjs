#!/usr/bin/env node
// Batch F18: governed application_binding.create by a business-Tenant admin
// (default account "admin" = kailo-bootstrap-admin in kailo-verify).
// 03 §9 / DD-70 / V-SCN-47: secretRefs is [] and the secret values travel once,
// transiently, as bindingSecretValues; Core writes version 1 of
// <parent>/<tenant>/<kvMount>/application-binding/<bindingId>/<secretKey>
// (field `value`) inside the same governed action. 07 §4.6: the native page
// entry is normalizedConfig.nativePageUrl. normalizedConfig.client_id is the
// binding's own adapter IdP client: Core's adapter PEP, read-grant and native
// task callbacks identify the binding only by it (application_binding_pep.rs
// check, verify_binding_client), so it is unique per binding and defaults to
// <component>-adapter-<first 8 hex of bindingId> (adapter-delivery.py client
// registers exactly this id with the Agent-delivered oidc_client_secret).
//
// Two phases, same arguments:
//   --plan-only   log in, derive the binding identity and write the plan JSON
//                 (no secret values, no submission). bindingId and
//                 servicePrincipalId are UUIDv5 of tenant/release/attempt, so
//                 the adapter's OpenBao Agent policy/templates and its
//                 management.validation config can be delivered beforehand
//                 (deploy/components/adapter-reader.py, render-adapter-config.py).
//   (default)     re-read bindings; if absent, submit create with the values
//                 from --secret-values-file, then wait for ACTIVE.
//
// --secret-values-file: regular owner-only (0600/0400) JSON object
// {"<secretKey>": "<value>", ...} with exactly the release secretSchema keys.
// Values are read into memory only and never printed or written elsewhere.
//
// Usage:
//   node component-bind.mjs --component file-storage|knowledge|data-query --release-dir <rendered dir>
//     --native-page-url <url> --native-instance-ref <ref> [--native-scope-ref <ref>]
//     [--adapter-service-ref <ref>] [--isolation-mode <mode>] [--workspace-id <uuid>]
//     [--model-route-ids <uuid,...> --meter-keys <key,...>]     (knowledge modelGateway)
//     [--model-call-mode NONE|PLATFORM_LLM_ROUTE] [--client-id <adapter IdP client id>] [--account admin] [--attempt N]
//     --plan-out <plan.json> (--plan-only | --secret-values-file <file>) [--wait-seconds 1800]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { attempt, canonical, deployEnv, digest, FlowError, key, log, login, main, parseArgs, privateText,
  readAll, renderedRelease, requireSession, sleep, submit, UUID, waitTask } from './lib.mjs';

const DEFAULTS = {
  'file-storage': { adapterServiceRef: 'file-storage-adapter', isolationMode: 'DEDICATED_INSTANCE' },
  // knowledge adapter validates RESOURCE_FILTER with nativeScopeRef = nativeKnowledgeBaseId.
  knowledge: { adapterServiceRef: 'knowledge-adapter', isolationMode: 'RESOURCE_FILTER' },
  'data-query': { adapterServiceRef: 'data-query-ui', isolationMode: 'DEDICATED_INSTANCE' },
};

function list(value) {
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : [];
}

function exactOrigin(url, manifest) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new FlowError('--native-page-url is not a URL', 2); }
  if (parsed.username || parsed.password || !['http:', 'https:'].includes(parsed.protocol)) throw new FlowError('--native-page-url must be http(s) without credentials', 2);
  if (!manifest.frontendDelivery?.nativePageOrigins?.includes(parsed.origin)) {
    throw new FlowError(`native page origin ${parsed.origin} is not in the release nativePageOrigins`, 2);
  }
  return url;
}

await main(async () => {
  const args = parseArgs(process.argv.slice(2), ['component', 'release-dir', 'native-page-url', 'native-instance-ref', 'native-scope-ref',
    'adapter-service-ref', 'isolation-mode', 'workspace-id', 'model-route-ids', 'meter-keys', 'model-call-mode', 'account', 'attempt',
    'plan-out', 'secret-values-file', 'wait-seconds', 'client-id'], ['plan-only']);
  const defaults = DEFAULTS[args.component];
  if (!defaults) throw new FlowError('--component must be file-storage, knowledge or data-query', 2);
  for (const name of ['release-dir', 'native-page-url', 'native-instance-ref', 'plan-out']) {
    if (!args[name]) throw new FlowError(`--${name} is required`, 2);
  }
  if (!args['plan-only'] && !args['secret-values-file']) throw new FlowError('--secret-values-file is required unless --plan-only', 2);
  if (args['workspace-id'] && !UUID.test(args['workspace-id'])) throw new FlowError('--workspace-id must be a UUID', 2);
  const run = attempt(args);
  const { manifest } = renderedRelease(args['release-dir']);

  const normalizedConfig = { nativePageUrl: exactOrigin(args['native-page-url'], manifest) };
  if (args['client-id'] !== undefined && !/^[A-Za-z0-9_-]+$/.test(args['client-id'])) throw new FlowError('--client-id must be one IdP client id segment', 2);
  const routes = list(args['model-route-ids']);
  const meters = list(args['meter-keys']);
  if (routes.length || meters.length) {
    if (!routes.length || !meters.length || routes.some((id) => !UUID.test(id))) throw new FlowError('--model-route-ids (uuids) and --meter-keys go together', 2);
    normalizedConfig.modelGateway = { routeResourceIds: routes, meterKeys: meters };
  }
  const modelCallMode = args['model-call-mode'] ?? manifest.allowedModelCallModes?.[0] ?? 'NONE';
  if (!(manifest.allowedModelCallModes ?? ['NONE']).includes(modelCallMode)) throw new FlowError(`modelCallMode ${modelCallMode} not allowed by the release`, 2);
  const { OPENBAO_TENANT_PARENT_NAMESPACE: parent, OPENBAO_KV_MOUNT: mount } = deployEnv('OPENBAO_TENANT_PARENT_NAMESPACE', 'OPENBAO_KV_MOUNT');
  if (!parent || !mount) throw new FlowError('OPENBAO_TENANT_PARENT_NAMESPACE / OPENBAO_KV_MOUNT missing from the live deploy .env', 2);

  const admin = await login(args.account ?? 'admin', `bind-${args.component}`);
  const tenant = await requireSession(admin);
  const bindingId = key('application_binding', tenant.tenantId, args['workspace-id'] ?? 'tenant', manifest.id, run);
  const servicePrincipalId = key('application_binding.service', bindingId);
  normalizedConfig.client_id = args['client-id'] ?? `${args.component}-adapter-${bindingId.slice(0, 8)}`;
  const audience = manifest.executionConnector.actionTokenAudience;
  const plan = {
    tenantId: tenant.tenantId,
    ...(args['workspace-id'] ? { workspaceId: args['workspace-id'] } : {}),
    componentReleaseId: manifest.id,
    componentTypeKey: manifest.componentTypeKey,
    artifactDigest: manifest.adapterBuildRef,
    bindingId,
    bindingVersion: 1,
    servicePrincipalId,
    adapterServiceRef: args['adapter-service-ref'] ?? defaults.adapterServiceRef,
    nativeInstanceRef: args['native-instance-ref'],
    ...(args['native-scope-ref'] ? { nativeScopeRef: args['native-scope-ref'] } : {}),
    isolationMode: args['isolation-mode'] ?? defaults.isolationMode,
    capabilityCategories: manifest.implements.map((item) => ({ category: item.categoryKey, version: item.contractVersion })),
    normalizedConfig,
    configDigest: digest(normalizedConfig),
    clientId: normalizedConfig.client_id,
    modelCallMode,
    retainOnTenantDelete: manifest.capabilityDeclarations.some((d) => d.tenantDelete === 'RETAIN_ON_TENANT_DELETE'),
    // Exactly what Core freezes (application_binding_secret.rs references()).
    secretRefs: manifest.secretSchema.map((s) => ({ secretKey: s.secretKey,
      locator: `${parent}/${tenant.tenantId}/${mount}/application-binding/${bindingId}/${s.secretKey}`, version: 1, audience })),
    actionVersions: manifest.actionDefinitions.map((a) => ({ actionKey: a.actionKey, actionVersion: a.version })),
  };
  const text = `${JSON.stringify(plan, null, 2)}\n`;
  if (existsSync(args['plan-out'])) {
    if (readFileSync(args['plan-out'], 'utf8') !== text) throw new FlowError(`${args['plan-out']} exists with a different plan`, 2);
  } else {
    writeFileSync(args['plan-out'], text, { mode: 0o644, flag: 'wx' });
  }
  log({ step: 'plan', planOut: args['plan-out'], bindingId, servicePrincipalId, tenantId: tenant.tenantId, secretKeys: plan.secretRefs.map((r) => r.secretKey) });
  if (args['plan-only']) return;

  const scope = args['workspace-id'] ? `?workspaceId=${args['workspace-id']}` : '';
  const read = async () => readAll(admin, `/api/v1/application-bindings${scope}`, 'bindings');
  let { rows, last } = await read();
  let binding = rows.find((row) => row.bindingId === bindingId);
  if (!binding) {
    const bindable = last.bindableReleases?.find((r) => r.componentReleaseId === manifest.id);
    if (!last.canCreate || !bindable) throw new FlowError('release is not bindable here (needs APPROVED release and tenant manage)', 2);
    const declared = bindable.secretSchema.map((s) => s.secretKey).sort();
    const values = JSON.parse(privateText(args['secret-values-file']));
    if (!values || typeof values !== 'object' || Array.isArray(values)
      || Object.keys(values).sort().join(',') !== declared.join(',')
      || Object.values(values).some((v) => typeof v !== 'string' || !v)) {
      throw new FlowError(`secret values file must be an object with exactly the keys ${declared.join(',')} (non-empty strings)`, 2);
    }
    const create = {
      bindingId, componentReleaseId: manifest.id, servicePrincipalId, adapterServiceRef: plan.adapterServiceRef,
      nativeInstanceRef: plan.nativeInstanceRef, ...(plan.nativeScopeRef ? { nativeScopeRef: plan.nativeScopeRef } : {}),
      isolationMode: plan.isolationMode, capabilityCategories: plan.capabilityCategories,
      normalizedConfigJson: canonical(normalizedConfig), secretRefs: [], modelCallMode,
      callIdentityMode: 'INSTANCE_SERVICE', retainOnTenantDelete: plan.retainOnTenantDelete,
    };
    const submitted = await submit(admin, { actionKey: 'application_binding.create',
      idempotencyKey: key('application_binding.create', bindingId, plan.configDigest),
      explicitConfirmation: true, ...(args['workspace-id'] ? { workspaceId: args['workspace-id'] } : {}),
      applicationBindingCreate: create,
      bindingSecretValues: declared.map((secretKey) => ({ secretKey, value: values[secretKey] })) }, 'create');
    await waitTask(admin, submitted.actionExecutionId, { seconds: Number(args['wait-seconds'] ?? 1800), label: 'binding-task' }).catch((error) => {
      if (error.exitCode !== 3) throw error;
    });
  }
  for (let i = 0; i < 60; i++) {
    ({ rows } = await read());
    binding = rows.find((row) => row.bindingId === bindingId);
    if (binding && ['ACTIVE', 'ERROR', 'DISABLED'].includes(binding.state)) break;
    await sleep(5000);
  }
  log({ step: 'binding', bindingId, state: binding?.state ?? 'ABSENT', version: binding?.version, hasNativePage: binding?.hasNativePage,
    activeProjectionGeneration: binding?.activeProjectionGeneration });
  if (binding?.state !== 'ACTIVE') {
    throw new FlowError(`binding is ${binding?.state ?? 'ABSENT'}; check adapter handshake/validate_binding, OpenBao audit delivery and the COMPONENT_BINDING task, then re-run`, binding?.state === 'PROVISIONING' ? 3 : 1);
  }
});
