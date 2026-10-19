#!/usr/bin/env node
// DD-98(3)(4) existing native reference registration (V-SCN-82): register one
// object a REMOTE_ADAPTER instance already owns (Wren model/view) as a Core
// Resource through the governed HUMAN resource.create only.
//
// The five-field reference is never typed in. The component produced it inside
// its own instance from the native database and the frozen binding/generation
// (Wren: `node docker-entrypoint.mjs resource-evidence TYPE_KEY NATIVE_TYPE
// NATIVE_REF EVIDENCE_REF`, data-query/docker/README.md "Existing native
// model/view reference delivery"), and the operator deployed that candidate
// ApplicationAdapterDirectory through the controlled directory delivery
// (deploy/local/start-core.sh --no-build). This script reads the DEPLOYED
// directory, takes exactly the binding's nativeResources entry for the native
// object, submits resource.create with it and waits for the RESOURCE_PROVISION
// workflow. Core re-verifies the same delivery, the APPROVED release, ACTIVE
// binding, Workspace/Tenant create permission and generation before ACTIVE; an
// object already registered in this Tenant is only reconciled to its Resource.
// Nothing here writes the directory, a database row, a grant or a native object.
//
// Usage:
//   node resource-register.mjs --directory <deployed adapter-directory.json> --binding-id <uuid>
//     --native-type model|view --native-ref <native id> [--workspace-id <uuid>]
//     [--account admin] [--attempt N] [--wait-seconds 900]
// Exit codes follow lib.mjs main(): 0 ACTIVE, 1 refused/FAILED, 2 invalid input,
// 3 still converging (re-run the same command with the same arguments).
import { readFileSync } from 'node:fs';
import { attempt, canonical, FlowError, key, log, login, main, parseArgs, requireSession, submit, UUID, waitTask } from './lib.mjs';

function reference(directory, bindingId, nativeType, nativeRef) {
  const found = [];
  for (const adapter of directory?.adapters ?? []) {
    for (const binding of adapter?.bindings ?? []) {
      if (binding?.bindingId !== bindingId) continue;
      for (const item of binding.nativeResources ?? []) {
        if (item?.nativeType === nativeType && item?.nativeRef === nativeRef) found.push(item);
      }
    }
  }
  if (found.length !== 1) {
    throw new FlowError(`${found.length ? 'several' : 'no'} delivered nativeResources entry for ${nativeType}/${nativeRef} `
      + `under binding ${bindingId}; deploy the component's resource evidence first`, 2);
  }
  const [item] = found;
  const keys = ['evidenceDigest', 'evidenceRef', 'nativeRef', 'nativeType', 'typeKey'];
  if (Object.keys(item).sort().join() !== keys.join() || !/^[0-9a-f]{64}$/.test(item.evidenceDigest)
    || keys.some((name) => typeof item[name] !== 'string' || !item[name] || item[name].trim() !== item[name])) {
    throw new FlowError('the delivered reference is not a five-field ResourceCreate', 2);
  }
  return item;
}

await main(async () => {
  const args = parseArgs(process.argv.slice(2),
    ['directory', 'binding-id', 'native-type', 'native-ref', 'workspace-id', 'account', 'attempt', 'wait-seconds']);
  for (const name of ['directory', 'binding-id', 'native-type', 'native-ref']) {
    if (!args[name]) throw new FlowError(`--${name} is required`, 2);
  }
  if (!UUID.test(args['binding-id']) || (args['workspace-id'] && !UUID.test(args['workspace-id']))) {
    throw new FlowError('--binding-id/--workspace-id must be lowercase UUIDs', 2);
  }
  const run = attempt(args);
  const resourceCreate = reference(JSON.parse(readFileSync(args.directory, 'utf8')), args['binding-id'],
    args['native-type'], args['native-ref']);
  const session = await login(args.account ?? 'admin', `resource-${args['native-type']}-${args['native-ref']}`);
  const member = await requireSession(session);
  const workspace = args['workspace-id'] ? { workspaceId: args['workspace-id'] } : {};
  log({ step: 'reference', bindingId: args['binding-id'], typeKey: resourceCreate.typeKey,
    nativeType: resourceCreate.nativeType, nativeRef: resourceCreate.nativeRef, evidenceRef: resourceCreate.evidenceRef });
  const view = await submit(session, { actionKey: 'resource.create',
    idempotencyKey: key('resource.create', member.tenantId, args['binding-id'], canonical(resourceCreate),
      args['workspace-id'] ?? 'NONE', run),
    ...workspace, resourceCreate }, 'resource-create');
  const task = await waitTask(session, view.actionExecutionId, { seconds: Number(args['wait-seconds'] ?? 900), label: 'resource-provision' });
  if (task.gateState !== 'ALLOWED' || task.taskStatus !== 'COMPLETED') {
    throw new FlowError(`resource.create ended ${task.gateState}/${task.taskStatus} ${task.reason ?? ''}`.trim());
  }
  log({ step: 'done', actionExecutionId: view.actionExecutionId, resourceId: task.targetId ?? view.targetId,
    typeKey: resourceCreate.typeKey, nativeRef: resourceCreate.nativeRef });
});
