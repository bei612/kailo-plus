#!/usr/bin/env node
// Governed llm_route.create over one existing Gateway native model source
// (DD-134(7), 05 §2.13; DD-136(5) isolated receiver deployments). The Tenant
// admin picks the source from the BFF's own source list (GET
// /api/v1/gateway/model-sources: provider/model ids, revisions and the digests
// Core re-checks), exactly as the Web gateway page does, and submits
// llm_route.create with providerCredentialMode NONE: only a keyless native
// provider (Core native_provider_without_auth) is accepted, so no SecretRef is
// typed or needed. It then waits until the route Resource is ACTIVE and prints
// its id. Nothing here writes the Gateway, SQL, OpenBao or IdP state.
//
// Usage:
//   node llm-route-create.mjs --provider-id <native provider id> --model-id <native model id>
//     [--workspace-id <uuid>] [--account admin] [--attempt N] [--wait-seconds 900] [--out <file>]
// --out receives {"routeResourceId": "<uuid>"} (0644, create-only; an identical file is accepted).
// Exit codes follow lib.mjs main(): 0 ACTIVE, 1 refused/FAILED, 2 invalid input, 3 still converging.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { attempt, FlowError, key, log, login, main, parseArgs, readAll, requireSession, sleep, submit, waitTask, UUID, api } from './lib.mjs';

await main(async () => {
  const args = parseArgs(process.argv.slice(2), ['provider-id', 'model-id', 'workspace-id', 'account', 'attempt', 'wait-seconds', 'out']);
  for (const name of ['provider-id', 'model-id']) if (!args[name]) throw new FlowError(`--${name} is required`, 2);
  if (args['workspace-id'] && !UUID.test(args['workspace-id'])) throw new FlowError('--workspace-id must be a UUID', 2);
  const run = attempt(args);
  const admin = await login(args.account ?? 'admin', 'llm-route');
  const tenant = await requireSession(admin);
  const sources = await api(admin, 'GET', '/api/v1/gateway/model-sources');
  if (sources.status !== 200 || !Array.isArray(sources.body?.sources)) {
    throw new FlowError(`GET /api/v1/gateway/model-sources: status ${sources.status} ${sources.body?.reason ?? sources.text ?? ''}`);
  }
  const matching = sources.body.sources.filter((s) => s.provider?.id === args['provider-id'] && s.model?.id === args['model-id']);
  if (matching.length !== 1) throw new FlowError(`exactly one Gateway source ${args['provider-id']}/${args['model-id']} required (found ${matching.length})`, 2);
  const [source] = matching;
  if (source.credentialRequired) throw new FlowError('the source needs a provider credential; isolated runs use keyless upstreams only (DD-136(5))', 2);
  const pinned = (value) => ({ id: value.id, revision: value.revision, sha256: value.sha256 });
  const idempotencyKey = key('llm_route.create', tenant.tenantId, args['workspace-id'] ?? 'tenant', source.provider.id,
    source.provider.sha256, source.model.id, source.model.sha256, run);
  const submitted = await submit(admin, { actionKey: 'llm_route.create', idempotencyKey, explicitConfirmation: true,
    ...(args['workspace-id'] ? { workspaceId: args['workspace-id'] } : {}),
    llmRouteCreate: { provider: pinned(source.provider), model: pinned(source.model), providerCredentialMode: 'NONE' } }, 'llm-route-create');
  const task = await waitTask(admin, submitted.actionExecutionId, { seconds: Number(args['wait-seconds'] ?? 900), label: 'llm-route-task' });
  if (!UUID.test(task?.targetId ?? '')) throw new FlowError('llm_route.create task carries no route Resource id');
  const window = { from: new Date(Date.now() - 3600e3).toISOString(), to: new Date().toISOString() };
  let route;
  for (let i = 0; i < 60; i++) {
    const page = await readAll(admin, `/api/v1/gateway/model-routes?from=${encodeURIComponent(window.from)}&to=${encodeURIComponent(window.to)}`, 'routes');
    route = page.rows.find((row) => row.resourceId === task.targetId);
    if (route?.resourceState === 'ACTIVE') break;
    await sleep(5000);
  }
  const routeResourceId = route?.resourceId;
  log({ step: 'route', routeResourceId, state: route?.resourceState ?? 'ABSENT' });
  if (route?.resourceState !== 'ACTIVE' || !UUID.test(routeResourceId ?? '')) {
    throw new FlowError(`route is ${route?.resourceState ?? 'ABSENT'}; check the llm_route.create task`, route ? 3 : 1);
  }
  if (args.out) {
    const text = `${JSON.stringify({ routeResourceId })}\n`;
    if (existsSync(args.out)) {
      if (readFileSync(args.out, 'utf8') !== text) throw new FlowError(`${args.out} exists with another route`, 2);
    } else {
      writeFileSync(args.out, text, { mode: 0o644, flag: 'wx' });
    }
  }
});
