import { Refused, exactKeys } from '../../../client-kit/adapter/protocol.mjs';
import { bindingValidationConfiguration as validateConfiguration, bindingObservation as observe,
  bindingArguments } from '../../../client-kit/adapter/binding-validation.mjs';

function executionMapping(action) {
  if (!exactKeys(action, ['actionKey', 'actionVersion']) || (!Number.isSafeInteger(action.actionVersion) || action.actionVersion <= 0)) throw new Refused(503);
  const operation = /^knowledge\.(search|read|export|ingest|delete)@v[12]$/.exec(action.actionKey)?.[1];
  if (!operation || action.actionKey === 'knowledge.search@v1') throw new Refused(503);
  return { ...action, nativeType: { search: 'search_knowledge', read: 'read_document',
    export: 'export_document', ingest: 'add_document', delete: 'delete_document' }[operation],
  cancelCapability: 'UNSUPPORTED' };
}

export { bindingArguments };
export function bindingValidationConfiguration(value, config) {
  validateConfiguration(value, config, { nativeScopeRef: config.nativeKnowledgeBaseId, isolationMode: 'RESOURCE_FILTER',
    credentialFiles: [config.nativeMcpBearerFile, config.oidcClientSecretFile], executionMapping });
}
export function bindingObservation(config, deadline) { return observe(config, executionMapping, deadline); }
