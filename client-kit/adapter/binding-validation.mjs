import { createHash } from 'node:crypto';
import { Refused, exactKeys, object, nonempty, canonical, readSecretDeliveryReceipt } from './protocol.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digest = value => createHash('sha256').update(value).digest('hex');
const positive = value => Number.isSafeInteger(value) && value > 0;
const fields = ['bindingVersion', 'servicePrincipalId', 'adapterServiceRef', 'nativeInstanceRef',
  'nativeScopeRef', 'isolationMode', 'normalizedConfig', 'secretDeliveries', 'actionVersions'];

// Only controlled delivery selects files, object scope and declared actions.
// Caller-supplied SecretRefs never select a file or a network request.
export function bindingValidationConfiguration(value, config, { nativeScopeRef, isolationMode, credentialFiles, executionMapping }) {
  if (value === undefined) return;
  if (!exactKeys(value, fields) || !positive(value.bindingVersion) || !uuid.test(value.servicePrincipalId)
    || !['adapterServiceRef', 'nativeInstanceRef', 'nativeScopeRef'].every(key => nonempty(value[key]))
    || value.isolationMode !== isolationMode || value.nativeScopeRef !== nativeScopeRef
    || !object(value.normalizedConfig) || !Array.isArray(value.secretDeliveries) || !value.secretDeliveries.length
    || !Array.isArray(value.actionVersions) || !value.actionVersions.length) throw new Refused(503);
  const keys = new Set();
  const files = new Set();
  for (const entry of value.secretDeliveries) {
    if (!exactKeys(entry, ['secretKey', 'locator', 'version', 'audience', 'secretFile', 'secretSocket', 'secretValueKey'])
      || !['secretKey', 'locator', 'audience', 'secretFile', 'secretSocket', 'secretValueKey'].every(key => nonempty(entry[key]))
      || !positive(entry.version) || !entry.locator.startsWith(`tenants/${config.tenantId}/`)
      || !entry.secretFile.startsWith('/') || !entry.secretSocket.startsWith('/')
      || entry.secretFile === entry.secretSocket || keys.has(entry.secretKey) || files.has(entry.secretFile)) throw new Refused(503);
    keys.add(entry.secretKey); files.add(entry.secretFile);
  }
  // Both actual native and PEP credentials used by this adapter must be proven.
  if (credentialFiles.some(path => !files.has(path))) throw new Refused(503);
  const actions = new Set();
  for (const action of value.actionVersions) {
    executionMapping(action);
    const key = `${action.actionKey}:${action.actionVersion}`;
    if (actions.has(key)) throw new Refused(503);
    actions.add(key);
  }
}

function references(validation) {
  return validation.secretDeliveries.map(({ secretKey, locator, version, audience }) => ({ secretKey, locator, version, audience }));
}

export function bindingArguments(config, args) {
  const fixed = config.management?.validation;
  if (!fixed) throw new Refused(503);
  const expected = {
    bindingId: config.bindingId, bindingVersion: fixed.bindingVersion, tenantId: config.tenantId,
    ...(config.workspaceId === undefined ? {} : { workspaceId: config.workspaceId }),
    componentReleaseId: config.management.componentReleaseId, servicePrincipalId: fixed.servicePrincipalId,
    adapterServiceRef: fixed.adapterServiceRef, nativeInstanceRef: fixed.nativeInstanceRef,
    nativeScopeRef: fixed.nativeScopeRef, isolationMode: fixed.isolationMode,
    normalizedConfig: fixed.normalizedConfig, configDigest: digest(canonical(fixed.normalizedConfig)),
    secretRefs: references(fixed), idempotencyKey: args.idempotencyKey,
  };
  if (canonical(args) !== canonical(expected)) throw new Refused(403);
}

export async function bindingObservation(config, executionMapping, deadline) {
  const fixed = config.management.validation;
  const reads = [];
  for (const entry of fixed.secretDeliveries) {
    const read = await readSecretDeliveryReceipt(entry, config.maxBodyBytes, deadline);
    if (reads.some(value => value.requestId === read.requestId)) throw new Refused(503);
    reads.push(read);
  }
  // Freshness and role are NOT inferred from file time or adapter assertions.
  // Core verifies these request IDs against original OpenBao request+response
  // audit entries with not_before=ActionExecution.updated_at.
  return { bindingId: config.bindingId, tenantId: config.tenantId,
    ...(config.workspaceId === undefined ? {} : { workspaceId: config.workspaceId }),
    nativeInstanceRef: fixed.nativeInstanceRef, nativeScopeRef: fixed.nativeScopeRef,
    isolationMode: fixed.isolationMode, configDigest: digest(canonical(fixed.normalizedConfig)),
    secretRefDigest: digest(canonical(references(fixed))), artifactDigest: config.management.artifactDigest,
    secretReads: reads, executionMappings: fixed.actionVersions.map(executionMapping) };
}
