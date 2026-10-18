#!/usr/bin/env node
// Stage 3 of tools/component-release/conformance-run.sh: observe the protocol
// expectations of the SAME candidate adapter on its isolated instance and
// write the owner-only facts.json that conformance-inputs.mjs assembles into
// COMPONENT_CONFORMANCE_{FIXTURE,IDENTITY,ENVIRONMENT}_FILE (07 §8A, DD-76).
//
// Nothing is predicted: every expectation is the actual wire response of the
// candidate, with only Worker-forbidden volatile fields removed
// (lastObservedAt/terminalAt, verifyConformanceStep) and OpenBao request ids
// removed exactly as Core's binding_comparison does. The observer signs with
// an ephemeral in-memory ES256 key that it publishes as the adapter's only
// trusted JWKS for the duration of the observation (the same pattern as
// data-query/docker/conformance/preparation.test.mjs); the in-process
// conformance-provider answers the PEP for those observation contexts. The
// key is never written; on exit the published JWKS is emptied, so a later
// suite run trusts only Core's isolated identity JWKS. Core still signs,
// freezes and checks every suite step itself.
//
// Usage: node tools/component-release/conformance/observe.mjs --run /abs/observe.json
// observe.json (owner-only; operator inputs, not expectations):
// { "component", "manifestFile":"/abs/rendered manifest.json", "seed":"<uuid>",
//   "adapterBaseUrl":"http://<isolated adapter>/",          as reached from here
//   "suiteAdapterBaseUrl":"http://<adapter as reached by Worker>/",
//   "maxResponseBytes":<int>, "maxSteps":<int>,
//   "adapterConfigFile":"/abs adapter config (read only)",
//   "adapterJwksFile":"/abs the adapter's actionTokenJwksFile (replaced 0600; run as the adapter UID)",
//   "provider":{ "listenHost","listenPort","productionActionAudience","bindingFile",
//                "targetsFile","nativeCheck","requestTimeoutMs","requestMaxBytes" },
//   "identity":{ Core isolated identity public facts: issuer, audience, tokenSeconds,
//                secretLocator, secretVersion, secretAudience, privateKeyField, jwksFile },
//   "principals":{ tenantId, workspaceId?, actorPrincipalId, deniedActorPrincipalId,
//                  authorizationMinZedToken },
//   "bindingManagement":{ bindingId, actionDefinitionVersion },
//   "execution":{ actionKey, target:{resourceId}, input:{…},
//                 resultExposurePolicyId, resultExposurePolicyVersion },
//   "vectorContexts":{ "default":{ resultExposurePolicyId, resultExposurePolicyVersion } },
//   "nativeFactsFile":"/abs/native-facts.json"   (seed output; required for V2 vectors),
//   "receiver"?:{ bindingId, generation, expiresAt,      (DD-124(4); receiver-run.sh only)
//                 receiverEnvironmentFile:"/abs owner-only ComponentConformanceReceiverEnvironment",
//                 receiverActionBaseUrl, nativeReadAuthorities:[ComponentNativeReadAuthority] },
//   "out":"/abs/facts.json" }
//
// DD-124 (V2 vectors): PRECONDITION values are copied unchanged from the seed's
// owner-only record of what the native entry returned (seed-cells.mjs) into
// facts.preconditions; observe.json itself may not carry precondition or
// capture values. CAPTURE values do not exist here at all: Core takes them from
// the candidate's own SUCCEEDED responses during its run, and nothing observed
// here is published as a vector expectation.
//
// DD-124(4): RECEIVER steps are not observed here at all. With "receiver",
// facts.nativeReceivers names each of them for the isolated receiver
// deployment (one frozen request per step; a native batch names the frozen
// importConfigRef, i.e. its seeded precondition, an APPLICATION receiver
// action names none) and facts.receiverEnvironment carries the isolated Core
// build and the APPROVED source release that Core re-checks itself.

import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { chmod, lstat, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { constants, closeSync, openSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { canonical, object } from '../../../client-kit/adapter/protocol.mjs';
import { openProvider } from '../conformance-provider.mjs';
import { parseVectors } from './vector-v2.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ERROR_STATUSES = [[403, 'DENIED'], [501, 'BLOCKED'], [404, 'PRECONDITION'], [429, 'LIMIT'], [409, 'CONFLICT'], [500, 'UNKNOWN']];
class Refusal extends Error {}
const fail = (message) => { throw new Refusal(message); };
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function uuidv5(namespace, name) {
  const hash = createHash('sha1').update(Buffer.concat([Buffer.from(namespace.replace(/-/g, ''), 'hex'), Buffer.from(name, 'utf8')])).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = hash.subarray(0, 16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function ownerOnly(path) {
  if (!isAbsolute(path ?? '')) fail('absolute owner-only input required');
  const entry = await lstat(path);
  if (entry.isSymbolicLink() || !entry.isFile() || (entry.mode & 0o077) !== 0) fail(`${path}: owner-only regular file required`);
  return JSON.parse(await readFile(path, 'utf8'));
}

async function replaceFile(path, text, mode) {
  const temporary = `${path}.${randomBytes(6).toString('hex')}`;
  await writeFile(temporary, text, { mode, flag: 'wx' });
  await chmod(temporary, mode);
  await rename(temporary, path);
}

// Mirror of component_conformance_identity.rs contextual_claims.
function claimsFor(context, operation, request, action, op) {
  const claims = { tenant_id: context.tenantId, actor_principal_id: context.actorPrincipalId,
    initiating_human_principal_id: context.actorPrincipalId, operation_id: op, action_execution_id: action,
    action_key: context.actionKey, action_definition_version: context.actionDefinitionVersion, target_type: context.targetType,
    normalized_parameter_hash: sha256(canonical(operation === 'execute' ? request.arguments : { operation, arguments: request })),
    authorization_min_zed_token: context.authorizationMinZedToken };
  if (context.resultExposurePolicyId !== undefined) {
    claims.result_exposure_policy_id = context.resultExposurePolicyId;
    claims.result_exposure_policy_version = context.resultExposurePolicyVersion;
  }
  if (context.workspaceId !== undefined) claims.workspace_id = context.workspaceId;
  if (context.targetId !== undefined) claims.target_id = context.targetId;
  if (operation === 'execute') {
    claims.external_execution_id = context.externalExecutionId;
    claims.idempotency_key = request.idempotencyKey;
  }
  return claims;
}

const volatile = (execution) => {
  if (!object(execution)) fail('adapter returned no execution observation');
  // Core (application_execution.rs observation) and the Worker
  // (validNativeObservation) reject a terminal observation without both a
  // nativeId and a nativeStatus; publishing it would freeze a failing plan.
  // DD-124(5): a terminal observation carries the raw native status it was
  // decided from; NONE/absent is only for PENDING_DISPATCH/RUNNING/UNKNOWN.
  if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(execution.platformStatus)
    && (typeof execution.nativeStatus !== 'string' || !execution.nativeStatus.trim() || execution.nativeStatus === 'NONE'
      || typeof execution.nativeId !== 'string')) {
    fail(`terminal ${execution.nativeType} observation lacks nativeStatus/nativeId required by Core and Worker (DD-124(5))`);
  }
  const { lastObservedAt, terminalAt, idempotencyKey, ...fixed } = execution;
  return fixed;
};

// The seed's record of identities the candidate's native entry returned
// (seed-cells.mjs V2 output). Copied verbatim; never derived or completed here.
async function seededPreconditions(path) {
  if (path === undefined) return undefined;
  const facts = await ownerOnly(path);
  if (facts?.formatVersion !== 'V2') return undefined;
  if (!Array.isArray(facts.preconditions)) fail('native facts: preconditions array required for V2');
  const seen = new Set();
  for (const item of facts.preconditions) {
    if (!item || Object.keys(item).sort().join() !== 'caseKey,key,value' || ![item.caseKey, item.key, item.value].every((v) => typeof v === 'string' && v.trim() === v && v)
      || seen.has(`${item.caseKey}/${item.key}`)) fail('native facts: each precondition needs one non-empty caseKey/key/value');
    seen.add(`${item.caseKey}/${item.key}`);
  }
  return facts.preconditions.map(({ caseKey, key, value }) => ({ caseKey, key, value }));
}

async function receiverFacts(run, manifest, preconditions) {
  if (run.receiver === undefined) return {};
  const receiver = run.receiver;
  const keys = ['bindingId', 'expiresAt', 'generation', 'nativeReadAuthorities', 'receiverActionBaseUrl', 'receiverEnvironmentFile'];
  if (!object(receiver) || Object.keys(receiver).sort().join() !== keys.join()) fail(`observe.json receiver: exactly ${keys.join(', ')}`);
  if (!UUID.test(receiver.bindingId) || !Number.isSafeInteger(receiver.generation) || receiver.generation <= 0
    || !(Date.parse(receiver.expiresAt) > Date.now()) || !Array.isArray(receiver.nativeReadAuthorities)
    || typeof receiver.receiverActionBaseUrl !== 'string') fail('observe.json receiver: invalid binding, deadline or delivery');
  const receiverEnvironment = await ownerOnly(receiver.receiverEnvironmentFile);
  const values = new Map((preconditions ?? []).map((item) => [`${item.caseKey}/${item.key}`, item.value]));
  const nativeReceivers = [];
  for (const { categoryKey, contractVersion } of manifest.implements ?? []) {
    const file = new URL(`../../../contracts/adapter/${categoryKey}.v${contractVersion}/registration.json`, import.meta.url);
    const vectors = parseVectors(JSON.parse(await readFile(file, 'utf8')));
    if (vectors.formatVersion !== 'V2') continue;
    for (const vectorCase of vectors.cases) {
      const caseKey = `${categoryKey}:${contractVersion}:${vectorCase.caseKey}`;
      for (const step of vectorCase.steps.filter((item) => item.direction === 'RECEIVER')) {
        const request = { idempotencyKey: uuidv5(run.seed, `receiver:${caseKey}/${step.stepKey}`),
          bindingId: receiver.bindingId, generation: receiver.generation, expiresAt: receiver.expiresAt };
        const input = JSON.parse(step.inputJson);
        if (Object.hasOwn(input, 'importConfigRef')) {
          const bound = (step.bindings ?? []).find((item) => item.side === 'INPUT' && item.pointer === '/importConfigRef');
          request.importConfigRef = bound === undefined ? input.importConfigRef
            : bound.source === 'PRECONDITION' ? values.get(`${caseKey}/${bound.key}`) : undefined;
          if (!UUID.test(request.importConfigRef ?? '')) fail(`${caseKey}/${step.stepKey}: no seeded import configuration`);
        }
        nativeReceivers.push({ caseKey, stepKey: step.stepKey, contractKey: step.contractKey, request });
      }
    }
  }
  if (!nativeReceivers.length) fail('observe.json receiver: the release has no RECEIVER vector step');
  return { nativeReceivers, receiverEnvironment,
    environment: { receiverActionBaseUrl: receiver.receiverActionBaseUrl, nativeReadAuthorities: receiver.nativeReadAuthorities } };
}

async function main() {
  const flag = process.argv.indexOf('--run');
  if (flag < 0 || process.argv.length !== 4) fail('usage: observe.mjs --run /abs/observe.json');
  const run = await ownerOnly(process.argv[flag + 1]);
  for (const key of ['component', 'manifestFile', 'seed', 'adapterBaseUrl', 'suiteAdapterBaseUrl', 'maxResponseBytes', 'maxSteps',
    'adapterConfigFile', 'adapterJwksFile', 'provider', 'identity', 'principals', 'bindingManagement', 'execution', 'vectorContexts', 'out']) {
    if (!Object.hasOwn(run, key)) fail(`observe.json: missing ${key}`);
  }
  if (!UUID.test(run.seed) || !isAbsolute(run.out) || !isAbsolute(run.adapterJwksFile)) fail('observe.json: seed/out/adapterJwksFile invalid');
  for (const key of ['preconditions', 'captures', 'captureValues', 'expectedOutputs']) {
    if (Object.hasOwn(run, key)) fail(`observe.json: ${key} is not an operator input (DD-124: native seed record or Core run only)`);
  }
  const preconditions = await seededPreconditions(run.nativeFactsFile);
  const manifest = JSON.parse(await readFile(run.manifestFile, 'utf8'));
  const adapter = JSON.parse(await readFile(run.adapterConfigFile, 'utf8'));
  const validation = adapter.management?.validation;
  if (!/^[a-f0-9]{64}$/.test(manifest.adapterBuildRef ?? '') || adapter.management?.artifactDigest !== manifest.adapterBuildRef
    || adapter.management?.componentReleaseId !== manifest.id || !object(validation)
    || adapter.bindingId !== run.bindingManagement.bindingId || adapter.tenantId !== run.principals.tenantId
    || adapter.workspaceId !== run.principals.workspaceId
    || adapter.actionTokenIssuer !== run.identity.issuer || adapter.actionTokenAudience !== run.identity.audience
    || adapter.actionTokenJwksFile !== run.adapterJwksFile) {
    fail('adapter configuration is not the isolated candidate for this manifest, binding and identity');
  }
  const p = run.principals;
  const base = { tenantId: p.tenantId, ...(p.workspaceId === undefined ? {} : { workspaceId: p.workspaceId }),
    actorPrincipalId: p.actorPrincipalId, authorizationMinZedToken: p.authorizationMinZedToken };
  const observationSeed = uuidv5(run.seed, 'observation');
  const management = { ...base, actionKey: 'application_binding.create', actionDefinitionVersion: run.bindingManagement.actionDefinitionVersion,
    targetType: 'APPLICATION_BINDING', targetId: run.bindingManagement.bindingId };
  const version = (manifest.actionDefinitions ?? []).find((action) => action.actionKey === run.execution.actionKey)?.version ?? fail('execution actionKey not in manifest');
  const [field] = Object.keys(run.execution.target ?? {});
  const business = { ...base, actionKey: run.execution.actionKey, actionDefinitionVersion: version,
    targetType: field === 'assetId' ? 'ASSET' : 'RESOURCE', targetId: run.execution.target[field],
    resultExposurePolicyId: run.execution.resultExposurePolicyId, resultExposurePolicyVersion: run.execution.resultExposurePolicyVersion };
  const external = uuidv5(observationSeed, 'external:protocol_execution_idempotency');
  const contexts = [
    { caseKey: 'protocol_handshake', stepKey: 'handshake', operation: 'handshake', ...management },
    { caseKey: 'protocol_binding', stepKey: 'validate_binding', operation: 'validate_binding', ...management },
    { caseKey: 'protocol_execution_idempotency', stepKey: 'execute', operation: 'execute', ...business, externalExecutionId: external },
    { caseKey: 'protocol_execution_idempotency', stepKey: 'observe', operation: 'observe', ...business },
    { caseKey: 'protocol_error_mapping', stepKey: 'map', operation: 'map_native_status_error', ...business },
  ];

  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const kid = `observation-${randomBytes(8).toString('hex')}`;
  const work = await mkdtemp(join(tmpdir(), 'conformance-observe-'));
  let provider;
  try {
    await chmod(work, 0o700);
    await replaceFile(run.adapterJwksFile, JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' }] }), 0o600);
    const identityFile = join(work, 'observation-identity.json');
    await writeFile(identityFile, JSON.stringify({ ...run.identity, artifactDigest: manifest.adapterBuildRef, jwksFile: run.adapterJwksFile, contexts }), { mode: 0o600 });
    const providerFile = join(work, 'provider.json');
    await writeFile(providerFile, JSON.stringify({ mode: 'CONFORMANCE_ONLY', ...run.provider, identityFile }), { mode: 0o600 });
    provider = await openProvider(providerFile);
    await new Promise((resolve, reject) => { provider.server.once('error', reject); provider.server.listen(run.provider.listenPort, run.provider.listenHost, resolve); });

    const call = async (operation, context, request) => {
      const now = Math.floor(Date.now() / 1000);
      const claims = { jti: randomUUID(), iss: run.identity.issuer, aud: run.identity.audience, iat: now,
        exp: now + run.identity.tokenSeconds, ...claimsFor(context, operation, request, randomUUID(), randomUUID()) };
      const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid, typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
      const token = `${header}.${payload}.${sign('sha256', Buffer.from(`${header}.${payload}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
      const response = await fetch(new URL(`platform-adapter/v1/${operation}`, run.adapterBaseUrl), { method: 'POST', redirect: 'manual',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': request.idempotencyKey },
        body: canonical(request), signal: AbortSignal.timeout(run.provider.requestTimeoutMs * 4) });
      const text = await response.text();
      if (text.includes(token)) fail(`${operation}: adapter echoed its ActionToken`);
      if (response.status !== 200) fail(`${operation}: candidate answered HTTP ${response.status}; nothing published`);
      return JSON.parse(text);
    };
    const key = (name) => uuidv5(observationSeed, `protocol:${name}`);

    const handshakeRequest = { componentReleaseId: manifest.id, componentTypeKey: manifest.componentTypeKey, protocolRange: manifest.adapterProtocolRange };
    const handshake = await call('handshake', contexts[0], { ...handshakeRequest, idempotencyKey: key('handshake') });
    if (handshake.protocolVersion !== '1' || handshake.artifactDigest !== manifest.adapterBuildRef) fail('handshake does not report the candidate artifact');

    const references = validation.secretDeliveries.map(({ secretKey, locator, version: v, audience }) => ({ secretKey, locator, version: v, audience }));
    const bindingRequest = { bindingId: adapter.bindingId, bindingVersion: validation.bindingVersion, tenantId: adapter.tenantId,
      ...(adapter.workspaceId === undefined ? {} : { workspaceId: adapter.workspaceId }), componentReleaseId: manifest.id,
      servicePrincipalId: validation.servicePrincipalId, adapterServiceRef: validation.adapterServiceRef,
      nativeInstanceRef: validation.nativeInstanceRef, nativeScopeRef: validation.nativeScopeRef, isolationMode: validation.isolationMode,
      normalizedConfig: validation.normalizedConfig, configDigest: sha256(canonical(validation.normalizedConfig)), secretRefs: references };
    const observedBinding = await call('validate_binding', contexts[1], { ...bindingRequest, idempotencyKey: key('validate_binding') });
    if (!Array.isArray(observedBinding.secretReads)) fail('validate_binding returned no secret read evidence');
    // Exactly Core's binding_comparison: request ids are fresh per read.
    const bindingExpected = { ...observedBinding, secretReads: observedBinding.secretReads.map(({ requestId, ...read }) => read) };

    const executionKey = key('execution');
    const executeRequest = { idempotencyKey: executionKey, actionKey: run.execution.actionKey,
      arguments: { target: run.execution.target, input: run.execution.input } };
    const first = await call('execute', contexts[2], executeRequest);
    const repeat = await call('execute', contexts[2], executeRequest);
    const nativeType = first.execution?.nativeType;
    const nativeId = repeat.execution?.nativeId ?? first.execution?.nativeId;
    const observeBody = { externalExecutionId: external, nativeType, ...(nativeId === undefined ? {} : { nativeId }) };
    const observed = await call('observe', contexts[3], { ...observeBody, idempotencyKey: executionKey });
    if (observed.execution?.platformStatus !== 'SUCCEEDED') fail(`protocol execution observed ${observed.execution?.platformStatus}; only an actual SUCCEEDED observation is published`);

    const errorMappings = [];
    for (const [nativeStatus, expectedClass] of ERROR_STATUSES) {
      const value = await call('map_native_status_error', contexts[4], { idempotencyKey: key(`error:${expectedClass}`), nativeStatus });
      if (value.class !== expectedClass) fail(`native status ${nativeStatus} maps to ${value.class}, not the closed ${expectedClass}`);
      errorMappings.push({ request: { nativeStatus }, expected: value });
    }
    const marker = `kailo-redaction-${randomBytes(12).toString('hex')}`;
    const redactionRequest = { nativeStatus: 500, nativeError: `token=${marker}` };
    const redacted = await call('map_native_status_error', contexts[4], { ...redactionRequest, idempotencyKey: key('redaction') });
    if (JSON.stringify(redacted).includes(marker)) fail('redaction probe text was disclosed');

    const receiving = await receiverFacts(run, manifest, preconditions);
    const facts = { formatVersion: 1, seed: run.seed, artifactDigest: manifest.adapterBuildRef,
      environment: { adapterBaseUrl: run.suiteAdapterBaseUrl, maxResponseBytes: run.maxResponseBytes, maxSteps: run.maxSteps,
        ...(receiving.environment ?? {}) },
      identity: run.identity, principals: run.principals, bindingManagement: run.bindingManagement,
      protocol: {
        handshake: { expected: handshake },
        validateBinding: { request: bindingRequest, expected: bindingExpected },
        execution: { ...run.execution, expectedFirst: volatile(first.execution), expectedRepeat: volatile(repeat.execution),
          // The suite's observe request carries the suite context's external id
          // (conformance-inputs.mjs buildIdentity); the native lookup is by key.
          observeRequest: { ...observeBody, externalExecutionId: uuidv5(run.seed, 'external:protocol_execution_idempotency') },
          observeExpected: volatile(observed.execution) },
        errorMappings,
        redaction: { request: redactionRequest, expected: redacted },
      },
      vectorContexts: run.vectorContexts, ...(preconditions ? { preconditions } : {}),
      ...(receiving.nativeReceivers ? { nativeReceivers: receiving.nativeReceivers, receiverEnvironment: receiving.receiverEnvironment } : {}) };
    const fd = openSync(run.out, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try { writeSync(fd, `${JSON.stringify(facts, null, 2)}\n`); } finally { closeSync(fd); }
    process.stdout.write(`${JSON.stringify({ facts: run.out, artifactDigest: manifest.adapterBuildRef, errorMappings: errorMappings.length })}\n`);
  } finally {
    await provider?.close();
    // Revoke the observation key: the adapter trusts nothing until Core's
    // isolated identity JWKS is delivered for the suite.
    await replaceFile(run.adapterJwksFile, JSON.stringify({ keys: [] }), 0o600).catch(() => {});
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`observe: ${error instanceof Refusal ? error.message : 'isolated observation failed; nothing published'}\n`);
  process.exitCode = 1;
});
