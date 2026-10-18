#!/usr/bin/env node
// Batch B2: assemble the three isolated conformance inputs Core/Worker consume
// for a REMOTE_ADAPTER ComponentRelease that registers existing native
// references (implements[] non-empty, DD-98; .design/07 §8A, REQ-22, DD-76):
//
//   COMPONENT_CONFORMANCE_FIXTURE_FILE      contracts/domain/component_conformance_fixture.schema.json
//   COMPONENT_CONFORMANCE_IDENTITY_FILE     contracts/domain/component_conformance_identity.schema.json
//   COMPONENT_CONFORMANCE_ENVIRONMENT_FILE  contracts/domain/component_conformance_environment.schema.json
//
// This is an assembler and pre-delivery checker, not a suite runner, a PEP or a
// source of passing results. Every native expectation (handshake, binding
// observation, execute/observe/cancel bodies, error-class mapping, redaction)
// comes from the operator facts file, observed on the isolated conformance
// instance of the SAME candidate artifact. Nothing here contacts that instance,
// OpenBao, Core or a production binding. Core still freezes the plan, signs
// each probe with the isolated identity and Worker still runs every wire step.
//
// Isolation (data-query/docker/conformance/README.md): the identity issuer and
// audience are a separate simulated issuer; the audience must differ from the
// release's production executionConnector.actionTokenAudience; the signing
// private key is referenced only by an OpenBao `platform/…` SecretRef that Core
// reads itself, and only a public jwksFile path is delivered. No key, token or
// secret value is accepted, generated, printed or written by this script.
//
// Usage (from the fixed source candidate, existing constrained Node runtime):
//
//   node tools/component-release/conformance-inputs.mjs \
//     --facts /abs/owner-only/facts.json \
//     --manifest /abs/rendered/manifest.json \
//     --out /abs/existing/output-dir \
//     [--registration /abs/or/repo/contracts/adapter/<category>.v<N>/registration.json ...]
//
// --manifest is the rendered release manifest (tools/component-release/render.mjs
// output, digests filled), not the in-repo template. Registrations default to
// contracts/adapter/<categoryKey>.v<contractVersion>/registration.json for every
// manifest implements[] entry; they must equal the ACTIVE Catalog contract rows
// Core freezes (the bootstrap seeds come from these files, DD-108). Outputs are
// written create-only, mode 0600, as fixture.json, identity.json and
// environment.json; existing files are never overwritten.
//
// Facts file (absolute, regular, not a symlink, no group/other permission).
// See conformance-facts.example.json for a skeleton:
//
// {
//   "formatVersion": 1,
//   "seed": "<uuid>",                       // UUIDv5 namespace for step/execution ids
//   "artifactDigest": "<64 lowercase hex>",  // = manifest.adapterBuildRef
//   "environment": { "adapterBaseUrl": "http(s)://host:port/", "maxResponseBytes": <int>,
//                    "maxSteps": <int>, "nativeReadAuthorities"?: [ComponentNativeReadAuthority],
//                    "receiverActionBaseUrl"?: "http(s)://host:port/" },   // isolated APPLICATION receiver entry
//   "receiverEnvironment"?: { "isolatedCoreBuildId", "sourceReleaseId",     // DD-124(4); required iff the
//                             "sourceArtifactDigest", "sourceManifestDigest" },  // plan has receiver steps
//   "identity": { "issuer", "audience", "tokenSeconds", "secretLocator": "platform/…",
//                 "secretVersion", "secretAudience", "privateKeyField", "jwksFile": "/abs" },
//   "principals": { "tenantId", "workspaceId"?, "actorPrincipalId", "deniedActorPrincipalId",
//                   "authorizationMinZedToken" },
//   "bindingManagement": { "bindingId", "actionDefinitionVersion" },   // application_binding.create
//   "protocol": {
//     "handshake": { "request"?: {…}, "expected": {…} },               // request defaults to Core's
//     "validateBinding": { "request": {…}, "expected": {…} },          // handshake arguments
//     "execution": { "actionKey", "target": {"resourceId"|"assetId": uuid}, "input": {…},
//                    "resultExposurePolicyId", "resultExposurePolicyVersion",
//                    "expectedFirst": {…}, "expectedRepeat"?: {…}, "observeRequest": {…},
//                    "observeExpected": {…} },
//     "cancel"?: { same fields as execution plus "cancelRequest", "cancelExpected" },
//     "errorMappings": [ { "request": {…}, "expected": {"class": …} } × 6 ],
//     "redaction": { "request": {…}, "expected": {…} }
//   },
//   "vectorContexts": { "default"?: { "resultExposurePolicyId", "resultExposurePolicyVersion",
//                                     "target"? },   (default: the step's literal input resourceId)
//                       "byContract"?: { "<contractKey>": { …same… } },
//                       "byStep"?: { "<category>:<version>:<caseKey>/<stepKey>": { …same… } } },
//   "nativeReceivers"?: [ { "caseKey", "stepKey", "contractKey", "request": ComponentNativeReceiverRequest } ],
//                        // NATIVE_INTERNAL keys and every step of a V2 RECEIVER case; importConfigRef only for a native batch
//   "preconditions"?: [ { "caseKey": "<category>:<version>:<caseKey>", "key", "value" } ]
// }
//
// DD-124 (V2 vectors): preconditions are exactly the seed's record of identities
// the candidate's native entry returned (observe.mjs copies them from
// seed-cells.mjs output); every V2 case precondition needs exactly one value and
// nothing else is accepted. They become fixture.preconditions, which Core
// substitutes when it freezes the plan. CAPTURE values are never an input: Core
// takes them from the candidate's own SUCCEEDED responses during the run, so a
// facts file cannot carry them and no expectation is rewritten here.
//
// DD-124(4): a step's referenceResourceKey names the precondition whose value
// is its target Resource; in a receiver-direction case every platform Resource
// is such a precondition, created by the isolated Core's real resource.create.
//
// DD-124(3)(4): every step of a V2 case with direction RECEIVER (and every
// NATIVE_INTERNAL key) becomes receiver_start/receiver_observe, observed only
// from the isolated receiver deployment (tools/component-release/receiver-run.sh);
// steps are never split between directions. Its request is never substituted;
// a native batch names the frozen importConfigRef, an APPLICATION receiver
// action (knowledge.ingest/read/export/search/delete) names none and is served
// by environment.receiverActionBaseUrl. Such a plan must carry receiverEnvironment
// (the isolated Core build and the production APPROVED source release), which
// Core re-checks against its own build and Catalog; a plan without receiver
// steps must not.
//
// The script injects only deterministic identifiers: each protocol request and
// execution expectation receives its step idempotencyKey (a supplied different
// value is refused), and execute contexts receive a UUIDv5 externalExecutionId.
// Vector-step idempotency keys are derived by Core from the ActionExecution at
// registration and cannot be known here; check_plan is mirrored against a
// placeholder ActionExecution id only to prove the context/envelope shapes.
//
// Mirrored Core rules (core/crates/platform-core/src):
//   component_release.rs   registration (connector/implements subset), active_contracts
//                          (roundtrip vector required), validate_protocol_fixture,
//                          prewrite (vector probe + permission-denied expansion, native
//                          receiver mapping), production_probe_execute
//   component_conformance_identity.rs  validate, result_policy_id, context, check_plan,
//                          parameter_hash (execute envelope, receiver request shape)
//   application_tool.rs    target (exact {target,input} arguments)
//   worker/activities/component_conformance.go  newComponentCandidate, validatePlan (maxSteps)
// A mismatch here is a delivery error; passing here is NOT a suite pass.

import { createHash } from 'node:crypto';
import { constants, lstatSync, openSync, readFileSync, statSync, writeSync, closeSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VectorRefusal, analyseV2, hasRoundtripV2, parseVectors, pointerSet } from './conformance/vector-v2.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

class Refusal extends Error {}
const refuse = (message) => { throw new Refusal(message); };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonempty = (v) => typeof v === 'string' && v.trim() !== '';
const positiveInt = (v) => Number.isSafeInteger(v) && v > 0;

function uuid(value, label) {
  if (typeof value !== 'string' || !UUID.test(value) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value)) {
    refuse(`${label}: canonical lowercase non-nil UUID required`);
  }
  return value;
}

function text(value, label) {
  if (!nonempty(value)) refuse(`${label}: non-empty string required`);
  return value;
}

function exactKeys(value, required, optional, label) {
  if (!isObject(value)) refuse(`${label}: object required`);
  for (const key of required) if (!(key in value)) refuse(`${label}: missing ${key}`);
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) refuse(`${label}: unknown field ${key}`);
  }
}

// Same bytes as collab_bridge::limits::canonical_json for string/integer data.
function canonical(value) {
  const canon = (v) => Array.isArray(v) ? v.map(canon)
    : isObject(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
  return JSON.stringify(canon(value));
}

function uuidv5(namespace, name) {
  const bytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(Buffer.concat([bytes, Buffer.from(name, 'utf8')])).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = hash.subarray(0, 16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function ownerOnlyJson(path, label) {
  if (!isAbsolute(path)) refuse(`${label}: absolute path required`);
  const link = lstatSync(path);
  if (link.isSymbolicLink() || !link.isFile()) refuse(`${label}: regular file (not symlink) required`);
  if ((link.mode & 0o077) !== 0) refuse(`${label}: owner-only file required (no group/other permission)`);
  if (typeof process.getuid === 'function' && link.uid !== process.getuid()) refuse(`${label}: must be owned by the running operator`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function plainJson(path, label) {
  const absolute = isAbsolute(path) ? path : resolve(root, path);
  const link = lstatSync(absolute);
  if (link.isSymbolicLink() || !link.isFile()) refuse(`${label}: regular file (not symlink) required`);
  return JSON.parse(readFileSync(absolute, 'utf8'));
}

function args(argv) {
  const out = { registrations: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!['--facts', '--manifest', '--out', '--registration'].includes(key) || value === undefined) {
      refuse('usage: conformance-inputs.mjs --facts <abs> --manifest <path> --out <abs dir> [--registration <path>]...');
    }
    if (key === '--registration') out.registrations.push(value);
    else if (out[key.slice(2)] !== undefined) refuse(`${key} given twice`);
    else out[key.slice(2)] = value;
    i += 1;
  }
  if (!out.facts || !out.manifest || !out.out) refuse('--facts, --manifest and --out are required');
  return out;
}

// ---- release manifest (subset of component_release::registration) ----------

function releaseFacts(manifest) {
  if (!isObject(manifest)) refuse('manifest: object required');
  const connector = manifest.executionConnector;
  if (!isObject(connector) || connector.mode !== 'REMOTE_ADAPTER' || connector.adapterProtocolRange !== '1'
    || !nonempty(connector.actionTokenAudience) || connector.actionTokenAudience === 'NONE') {
    refuse('manifest: REMOTE_ADAPTER executionConnector with adapterProtocolRange "1" required (PROTOCOL_PEER uses component_release_peer inputs)');
  }
  if (!HEX64.test(manifest.adapterBuildRef ?? '')) refuse('manifest: rendered adapterBuildRef (64 lowercase hex) required; render the release first');
  uuid(manifest.id, 'manifest.id');
  text(manifest.componentTypeKey, 'manifest.componentTypeKey');
  if (!Array.isArray(manifest.implements) || manifest.implements.length === 0) {
    refuse('manifest: implements[] must be non-empty; creation-fencing (DD-101 example) fixtures are not produced by this tool');
  }
  const declarations = manifest.capabilityDeclarations;
  if (!Array.isArray(declarations)) refuse('manifest: capabilityDeclarations[] required');
  const cancelSupported = declarations.some((d) => d?.cancel === 'SUPPORTED');
  const actions = new Map();
  for (const action of manifest.actionDefinitions ?? []) {
    if (!nonempty(action?.actionKey) || !positiveInt(action?.version)) refuse('manifest: actionDefinitions need actionKey/version');
    actions.set(action.actionKey, action.version);
  }
  const native = new Set();
  for (const resource of manifest.resourceTypeDefinitions ?? []) {
    for (const incremental of resource?.incrementalContracts ?? []) {
      if (incremental?.role === 'NATIVE_INTERNAL' && incremental?.engine === 'NATIVE') native.add(incremental.contractKey);
    }
  }
  return { productionAudience: connector.actionTokenAudience, cancelSupported, actions, native };
}

function loadRegistrations(manifest, explicit) {
  const paths = explicit.length ? explicit
    : manifest.implements.map((c) => `contracts/adapter/${c.categoryKey}.v${c.contractVersion}/registration.json`);
  const registrations = paths.map((p) => plainJson(p, `registration ${p}`));
  const wanted = manifest.implements.map((c) => `${c.categoryKey}@${c.contractVersion}`);
  const got = registrations.map((r) => `${r.categoryKey}@${r.contractVersion}`);
  if (canonical(wanted) !== canonical(got)) refuse(`registrations ${got.join(',')} must equal manifest implements order ${wanted.join(',')}`);
  return registrations.map((registration) => {
    const vectors = parseVectors(registration);
    const label = `${registration.categoryKey}@${registration.contractVersion}`;
    if (vectors.formatVersion === 'V2') {
      // DD-124: the roundtrip is an actually observed value (an INPUT CAPTURE)
      // carried into a later request (Core capability_vector.rs has_roundtrip).
      const analysed = analyseV2(vectors, label, (registration.operationContracts ?? []).map((op) => op.contractKey));
      if (!hasRoundtripV2(vectors)) refuse(`${label}: no INPUT CAPTURE roundtrip vector; Core blocks this release`);
      return { category: registration.categoryKey, version: registration.contractVersion, format: 'V2', cases: vectors.cases, analysed };
    }
    // active_contracts: an existing-reference registration needs one typed
    // ContentReference roundtrip vector; otherwise Core blocks registration.
    if (!vectors.cases.some((c) => (c.steps ?? []).some((s) => s.referenceFromStepKey !== undefined))) {
      refuse(`${label}: no referenceFromStepKey roundtrip vector; Core blocks this release`);
    }
    return { category: registration.categoryKey, version: registration.contractVersion, format: 'V1', cases: vectors.cases };
  });
}

// DD-124(1): one seeded native identity per declared V2 precondition, nothing
// more. Returned in the frozen case/declaration order for fixture.preconditions.
function preconditionValues(facts, registrations) {
  const declared = [];
  for (const registration of registrations.filter((r) => r.format === 'V2')) {
    for (const vectorCase of registration.analysed.cases) {
      for (const item of vectorCase.preconditions) declared.push(`${registration.category}:${registration.version}:${vectorCase.caseKey}/${item.key}`);
    }
  }
  const supplied = facts.preconditions ?? [];
  if (!Array.isArray(supplied)) refuse('facts.preconditions: array');
  const values = new Map();
  for (const item of supplied) {
    exactKeys(item, ['caseKey', 'key', 'value'], [], 'facts.preconditions[]');
    const id = `${text(item.caseKey, 'preconditions[].caseKey')}/${text(item.key, 'preconditions[].key')}`;
    if (values.has(id)) refuse(`facts.preconditions: ${id} given twice`);
    const value = text(item.value, `preconditions ${id}.value`);
    if (value.trim() !== value) refuse(`facts.preconditions: ${id} value must be the exact native identity`);
    values.set(id, value);
  }
  for (const id of declared) if (!values.has(id)) refuse(`facts.preconditions: no seeded native identity for ${id}`);
  for (const id of values.keys()) if (!declared.includes(id)) refuse(`facts.preconditions: ${id} is not a declared V2 precondition`);
  return declared.map((id) => {
    const at = id.lastIndexOf('/');
    return { caseKey: id.slice(0, at), key: id.slice(at + 1), value: values.get(id) };
  });
}

// ---- protocol fixture (validate_protocol_fixture order) ---------------------

function withKey(body, key, label) {
  if (!isObject(body)) refuse(`${label}: object required`);
  if (body.idempotencyKey !== undefined && body.idempotencyKey !== key) {
    refuse(`${label}: supplied idempotencyKey differs from the generated step key; omit it`);
  }
  return { ...body, idempotencyKey: key };
}

function envelope(execution, key, label) {
  exactKeys(execution.target, [], ['resourceId', 'assetId'], `${label}.target`);
  const fields = Object.keys(execution.target);
  if (fields.length !== 1) refuse(`${label}.target: exactly one of resourceId/assetId`);
  uuid(execution.target[fields[0]], `${label}.target.${fields[0]}`);
  if (!isObject(execution.input)) refuse(`${label}.input: object required`);
  return { idempotencyKey: key, actionKey: text(execution.actionKey, `${label}.actionKey`),
    arguments: { target: { ...execution.target }, input: execution.input } };
}

function protocolFixture(facts, release, manifest) {
  const p = facts.protocol;
  exactKeys(p, ['handshake', 'validateBinding', 'execution', 'errorMappings', 'redaction'], ['cancel'], 'protocol');
  if (release.cancelSupported !== (p.cancel !== undefined)) {
    refuse(release.cancelSupported
      ? 'protocol.cancel is required: the manifest declares cancel=SUPPORTED'
      : 'protocol.cancel must be omitted: no declaration has cancel=SUPPORTED');
  }
  const steps = [];
  const key = (name) => uuidv5(facts.seed, `protocol:${name}`);
  const push = (caseKey, stepKey, operation, idempotencyKey, request, expected) => {
    if (!isObject(expected)) refuse(`${caseKey}/${stepKey}: expected response object required`);
    steps.push({ caseKey, stepKey, operation, idempotencyKey, requestJson: canonical(request),
      expectedResponseJson: canonical(expected), expectedHttpStatus: 200 });
  };

  exactKeys(p.handshake, ['expected'], ['request'], 'protocol.handshake');
  const hk = key('handshake');
  const handshake = p.handshake.request ?? { componentReleaseId: manifest.id,
    componentTypeKey: manifest.componentTypeKey, protocolRange: manifest.adapterProtocolRange };
  push('protocol_handshake', 'handshake', 'handshake', hk, withKey(handshake, hk, 'handshake.request'), p.handshake.expected);

  exactKeys(p.validateBinding, ['request', 'expected'], [], 'protocol.validateBinding');
  const bk = key('validate_binding');
  push('protocol_binding', 'validate_binding', 'validate_binding', bk,
    withKey(p.validateBinding.request, bk, 'validateBinding.request'), p.validateBinding.expected);

  const executionFields = ['actionKey', 'target', 'input', 'resultExposurePolicyId', 'resultExposurePolicyVersion'];
  exactKeys(p.execution, [...executionFields, 'expectedFirst', 'observeRequest', 'observeExpected'], ['expectedRepeat'], 'protocol.execution');
  const ek = key('execution');
  const request = envelope(p.execution, ek, 'protocol.execution');
  push('protocol_execution_idempotency', 'execute-first', 'execute', ek, request, withKey(p.execution.expectedFirst, ek, 'execution.expectedFirst'));
  push('protocol_execution_idempotency', 'execute-repeat', 'execute', ek, request,
    withKey(p.execution.expectedRepeat ?? p.execution.expectedFirst, ek, 'execution.expectedRepeat'));
  push('protocol_execution_idempotency', 'observe', 'observe', ek, withKey(p.execution.observeRequest, ek, 'execution.observeRequest'),
    withKey(p.execution.observeExpected, ek, 'execution.observeExpected'));

  if (p.cancel !== undefined) {
    exactKeys(p.cancel, [...executionFields, 'expectedFirst', 'cancelRequest', 'cancelExpected', 'observeRequest', 'observeExpected'], [], 'protocol.cancel');
    const ck = key('cancel');
    push('protocol_cancel', 'execute', 'execute', ck, envelope(p.cancel, ck, 'protocol.cancel'), withKey(p.cancel.expectedFirst, ck, 'cancel.expectedFirst'));
    push('protocol_cancel', 'cancel', 'cancel', ck, withKey(p.cancel.cancelRequest, ck, 'cancel.cancelRequest'), withKey(p.cancel.cancelExpected, ck, 'cancel.cancelExpected'));
    push('protocol_cancel', 'observe', 'observe', ck, withKey(p.cancel.observeRequest, ck, 'cancel.observeRequest'), withKey(p.cancel.observeExpected, ck, 'cancel.observeExpected'));
  }

  if (!Array.isArray(p.errorMappings) || p.errorMappings.length !== 6) refuse('protocol.errorMappings: exactly six entries');
  for (const mapping of p.errorMappings) {
    exactKeys(mapping, ['request', 'expected'], [], 'protocol.errorMappings[]');
    const cls = text(mapping.expected?.class, 'errorMappings[].expected.class');
    const mk = key(`error:${cls}`);
    push('protocol_error_mapping', `error-${cls.toLowerCase()}`, 'map_native_status_error', mk,
      withKey(mapping.request, mk, `errorMappings ${cls}.request`), mapping.expected);
  }
  exactKeys(p.redaction, ['request', 'expected'], [], 'protocol.redaction');
  const rk = key('redaction');
  push('protocol_redaction', 'redaction', 'map_native_status_error', rk, withKey(p.redaction.request, rk, 'redaction.request'), p.redaction.expected);
  return steps;
}

// Mirror of component_release::validate_protocol_fixture for implements != [].
function verifyFixture(fixture, adapterDigest, cancelSupported) {
  exactKeys(fixture, ['artifactDigest', 'steps'], ['nativeReceivers', 'preconditions'], 'fixture');
  if (fixture.artifactDigest !== adapterDigest) refuse('fixture.artifactDigest differs from manifest.adapterBuildRef');
  const cases = [
    ['protocol_handshake', ['handshake']],
    ['protocol_binding', ['validate_binding']],
    ['protocol_execution_idempotency', ['execute', 'execute', 'observe']],
    ['protocol_cancel', ['execute', 'cancel', 'observe']],
    ['protocol_error_mapping', Array(6).fill('map_native_status_error')],
    ['protocol_redaction', ['map_native_status_error']],
  ];
  let offset = 0;
  const classes = new Set();
  for (const [caseKey, operations] of cases) {
    if (caseKey === 'protocol_cancel' && !cancelSupported) continue;
    let preceding = null;
    for (const operation of operations) {
      const step = fixture.steps[offset];
      const where = `fixture step ${offset} (${caseKey}/${operation})`;
      if (!step || step.caseKey !== caseKey || step.operation !== operation || 'contractKey' in step) refuse(`${where}: order/case/operation mismatch`);
      exactKeys(step, ['caseKey', 'stepKey', 'operation', 'idempotencyKey', 'requestJson', 'expectedResponseJson', 'expectedHttpStatus'], [], where);
      const request = JSON.parse(step.requestJson);
      const expected = JSON.parse(step.expectedResponseJson);
      if (!isObject(request) || !isObject(expected) || request.idempotencyKey !== step.idempotencyKey) refuse(`${where}: object bodies with step idempotencyKey required`);
      if (caseKey === 'protocol_handshake' && (expected.protocolVersion !== '1' || expected.artifactDigest !== adapterDigest)) {
        refuse(`${where}: observed handshake must report protocolVersion "1" and the release adapterBuildRef`);
      }
      if (caseKey === 'protocol_execution_idempotency' || caseKey === 'protocol_cancel') {
        if (expected.idempotencyKey !== request.idempotencyKey) refuse(`${where}: expected idempotencyKey mismatch`);
        if (preceding) {
          if (preceding.request.idempotencyKey !== request.idempotencyKey || preceding.expected.nativeType !== expected.nativeType) {
            refuse(`${where}: one native execution identity (idempotencyKey/nativeType) per case required`);
          }
          if (caseKey === 'protocol_execution_idempotency' && operation === 'execute' && canonical(preceding.request) !== canonical(request)) {
            refuse(`${where}: repeated execute must be byte-identical`);
          }
        }
        if (!['SUPPORTED', 'UNSUPPORTED'].includes(expected.cancelCapability)) refuse(`${where}: cancelCapability SUPPORTED|UNSUPPORTED required`);
        if (caseKey === 'protocol_cancel' && expected.cancelCapability !== 'SUPPORTED') refuse(`${where}: cancel case requires cancelCapability SUPPORTED`);
        const terminal = caseKey === 'protocol_cancel' ? 'CANCELLED' : 'SUCCEEDED';
        if (operation === 'observe' && expected.platformStatus !== terminal) refuse(`${where}: observe platformStatus must be ${terminal}`);
        if (caseKey === 'protocol_cancel' && operation === 'execute' && expected.platformStatus !== 'RUNNING') refuse(`${where}: cancel execute must observe RUNNING`);
      }
      if (caseKey === 'protocol_error_mapping') {
        if (!['DENIED', 'BLOCKED', 'PRECONDITION', 'LIMIT', 'CONFLICT', 'UNKNOWN'].includes(expected.class) || classes.has(expected.class)) {
          refuse(`${where}: each of DENIED, BLOCKED, PRECONDITION, LIMIT, CONFLICT, UNKNOWN exactly once`);
        }
        classes.add(expected.class);
      }
      preceding = { request, expected };
      offset += 1;
    }
  }
  if (offset !== fixture.steps.length) refuse('fixture: unexpected extra steps');
}

// ---- identity contexts ------------------------------------------------------

function policy(source, label) {
  return { resultExposurePolicyId: uuid(source?.resultExposurePolicyId, `${label}.resultExposurePolicyId`),
    resultExposurePolicyVersion: positiveInt(source?.resultExposurePolicyVersion)
      ? source.resultExposurePolicyVersion : refuse(`${label}.resultExposurePolicyVersion: positive integer`) };
}

function targetOf(targetObject, label) {
  const [field] = Object.keys(targetObject ?? {});
  if (Object.keys(targetObject ?? {}).length !== 1 || !['resourceId', 'assetId'].includes(field)) refuse(`${label}: {resourceId|assetId}`);
  return { targetType: field === 'resourceId' ? 'RESOURCE' : 'ASSET', targetId: uuid(targetObject[field], label) };
}

function buildIdentity(facts, release, fixtureSteps, vectorSteps) {
  const pr = facts.principals;
  exactKeys(pr, ['tenantId', 'actorPrincipalId', 'deniedActorPrincipalId', 'authorizationMinZedToken'], ['workspaceId'], 'principals');
  const base = { tenantId: uuid(pr.tenantId, 'principals.tenantId'),
    ...(pr.workspaceId === undefined ? {} : { workspaceId: uuid(pr.workspaceId, 'principals.workspaceId') }),
    actorPrincipalId: uuid(pr.actorPrincipalId, 'principals.actorPrincipalId'),
    authorizationMinZedToken: text(pr.authorizationMinZedToken, 'principals.authorizationMinZedToken') };
  if (uuid(pr.deniedActorPrincipalId, 'principals.deniedActorPrincipalId') === base.actorPrincipalId) {
    refuse('principals: denied actor must differ from the permitted actor');
  }
  exactKeys(facts.bindingManagement, ['bindingId', 'actionDefinitionVersion'], [], 'bindingManagement');
  if (!positiveInt(facts.bindingManagement.actionDefinitionVersion)) refuse('bindingManagement.actionDefinitionVersion: positive integer');
  const management = { ...base, actionKey: 'application_binding.create',
    actionDefinitionVersion: facts.bindingManagement.actionDefinitionVersion,
    targetType: 'APPLICATION_BINDING', targetId: uuid(facts.bindingManagement.bindingId, 'bindingManagement.bindingId') };

  const actionVersion = (actionKey) => release.actions.get(actionKey) ?? refuse(`manifest has no actionDefinition for ${actionKey}`);
  const business = (execution, label) => ({ ...base, actionKey: execution.actionKey,
    actionDefinitionVersion: actionVersion(execution.actionKey), ...targetOf(execution.target, `${label}.target`),
    ...policy(execution, label) });

  const contexts = [];
  const add = (step, operation, fields) => contexts.push({ caseKey: step.caseKey, stepKey: step.stepKey, operation, ...fields });
  const p = facts.protocol;
  for (const step of fixtureSteps) {
    switch (step.caseKey) {
      case 'protocol_handshake':
      case 'protocol_binding':
        add(step, step.operation, management);
        break;
      case 'protocol_execution_idempotency':
      case 'protocol_cancel': {
        const source = step.caseKey === 'protocol_cancel' ? p.cancel : p.execution;
        const fields = business(source, step.caseKey);
        const execution = step.operation === 'execute'
          ? { externalExecutionId: uuidv5(facts.seed, `external:${step.caseKey}`) } : {};
        add(step, step.operation, { ...fields, ...execution });
        add(step, 'reconcile', { ...fields, ...execution });
        break;
      }
      default:
        add(step, step.operation, business(p.execution, 'protocol.execution'));
    }
  }

  const vc = facts.vectorContexts ?? {};
  for (const { probe } of vectorSteps) {
    const pathKey = `${probe.caseKey}/${probe.stepKey}`;
    const override = { ...(vc.default ?? {}), ...(vc.byContract?.[probe.contractKey] ?? {}), ...(vc.byStep?.[pathKey] ?? {}) };
    let target;
    if (probe.referenceAssetId !== undefined) target = { targetType: 'ASSET', targetId: probe.referenceAssetId };
    else if (probe.referenceResourceId !== undefined) target = { targetType: 'RESOURCE', targetId: probe.referenceResourceId };
    else {
      // Steps without a typed reference (V2 list, list_revisions, share,
      // delete) target the Resource their literal input names; an explicit
      // vectorContexts target must be that same Resource, since Core signs
      // the context target and the adapter requires it to equal the input.
      let inputResource;
      try { inputResource = JSON.parse(probe.inputJson)?.resourceId; } catch { inputResource = undefined; }
      if (override.target !== undefined) {
        target = targetOf(override.target, `vectorContexts target for ${pathKey}`);
        if (inputResource !== undefined && (target.targetType !== 'RESOURCE' || target.targetId !== inputResource)) {
          refuse(`vectorContexts target for ${pathKey} must be the step input resourceId ${inputResource}`);
        }
      } else if (typeof inputResource === 'string') {
        target = { targetType: 'RESOURCE', targetId: uuid(inputResource, `${pathKey} input resourceId`) };
      } else target = targetOf(undefined, `vectorContexts target for ${pathKey}`);
    }
    const receiver = probe.operation === 'receiver_start';
    const fields = { ...base, actionKey: probe.contractKey, actionDefinitionVersion: actionVersion(probe.contractKey),
      ...target, ...policy(override, `vectorContexts for ${pathKey}`),
      ...(receiver ? {} : { externalExecutionId: uuidv5(facts.seed, `external:${pathKey}`) }) };
    const denied = { ...fields, actorPrincipalId: pr.deniedActorPrincipalId };
    const deniedStep = { caseKey: probe.caseKey, stepKey: `permission-denied:${probe.stepKey}` };
    for (const [step, values] of [[probe, fields], [deniedStep, denied]]) {
      if (receiver) {
        add(step, 'receiver_start', values);
        add(step, 'receiver_observe', values);
      } else {
        add(step, 'execute', values);
        add(step, 'reconcile', values);
      }
    }
  }

  const id = facts.identity;
  exactKeys(id, ['issuer', 'audience', 'tokenSeconds', 'secretLocator', 'secretVersion', 'secretAudience', 'privateKeyField', 'jwksFile'], [], 'identity');
  const receiving = vectorSteps.some(({ probe }) => probe.operation === 'receiver_start');
  if (receiving !== (facts.receiverEnvironment !== undefined)) {
    refuse(receiving ? 'receiverEnvironment is required: the plan has receiver steps (DD-124(4))'
      : 'receiverEnvironment must be omitted: the plan has no receiver steps');
  }
  return { artifactDigest: facts.artifactDigest, issuer: id.issuer, audience: id.audience, tokenSeconds: id.tokenSeconds,
    secretLocator: id.secretLocator, secretVersion: id.secretVersion, secretAudience: id.secretAudience,
    privateKeyField: id.privateKeyField, jwksFile: id.jwksFile, contexts,
    ...(receiving ? { receiverEnvironment: facts.receiverEnvironment } : {}) };
}

// Mirror of component_conformance_identity::validate/result_policy_id.
function verifyIdentity(identity, adapterDigest, productionAudience) {
  if (identity.artifactDigest !== adapterDigest) refuse('identity.artifactDigest differs from adapterBuildRef');
  if (text(identity.audience, 'identity.audience') === productionAudience) refuse('identity.audience must not reuse the production actionTokenAudience');
  if (!positiveInt(identity.tokenSeconds)) refuse('identity.tokenSeconds: positive integer');
  if (!positiveInt(identity.secretVersion) || identity.secretVersion > 0xffffffff) refuse('identity.secretVersion: 1..u32');
  if (!text(identity.secretLocator, 'identity.secretLocator').startsWith('platform/')) refuse('identity.secretLocator must be a platform/ OpenBao locator read only by Core');
  if (!isAbsolute(text(identity.jwksFile, 'identity.jwksFile'))) refuse('identity.jwksFile: absolute public JWKS path');
  for (const key of ['issuer', 'secretAudience', 'privateKeyField']) text(identity[key], `identity.${key}`);
  if (!identity.contexts.length) refuse('identity.contexts: non-empty');
  if (identity.receiverEnvironment !== undefined) {
    // component_conformance_identity::validate; Core also requires the build to
    // be its own and the source release APPROVED with read_edge SOURCE/BOTH.
    const environment = identity.receiverEnvironment;
    exactKeys(environment, ['isolatedCoreBuildId', 'sourceReleaseId', 'sourceArtifactDigest', 'sourceManifestDigest'], [], 'receiverEnvironment');
    if (!/^[0-9a-f]{40}$/.test(environment.isolatedCoreBuildId ?? '')) refuse('receiverEnvironment.isolatedCoreBuildId: the isolated Core PlatformBuildInfo buildId (40 lowercase hex)');
    uuid(environment.sourceReleaseId, 'receiverEnvironment.sourceReleaseId');
    for (const f of ['sourceArtifactDigest', 'sourceManifestDigest']) if (!HEX64.test(environment[f] ?? '')) refuse(`receiverEnvironment.${f}: 64 lowercase hex`);
  }
  const unique = new Set();
  for (const c of identity.contexts) {
    const where = `context ${c.caseKey}/${c.stepKey}/${c.operation}`;
    const key = canonical([c.caseKey, c.stepKey, c.operation]);
    if (unique.has(key)) refuse(`${where}: duplicate (caseKey, stepKey, operation)`);
    unique.add(key);
    uuid(c.tenantId, `${where}.tenantId`); uuid(c.actorPrincipalId, `${where}.actorPrincipalId`);
    for (const field of ['workspaceId', 'targetId', 'externalExecutionId']) if (c[field] !== undefined) uuid(c[field], `${where}.${field}`);
    if (!positiveInt(c.actionDefinitionVersion)) refuse(`${where}: actionDefinitionVersion`);
    text(c.actionKey, `${where}.actionKey`); text(c.authorizationMinZedToken, `${where}.authorizationMinZedToken`);
    if (c.operation === 'execute') uuid(c.externalExecutionId, `${where}.externalExecutionId`);
    if (['receiver_start', 'receiver_observe'].includes(c.operation) && (c.targetType !== 'RESOURCE' || c.externalExecutionId !== undefined)) refuse(`${where}: receiver contexts are RESOURCE without externalExecutionId`);
    if (c.operation.startsWith('mcp_')) refuse(`${where}: MCP peer identities are not adapter contexts`);
    if (!['TENANT', 'WORKSPACE', 'RESOURCE', 'ASSET', 'APPLICATION_BINDING'].includes(c.targetType)) refuse(`${where}: targetType`);
    if (c.targetType === 'APPLICATION_BINDING') {
      if (c.actionKey !== 'application_binding.create' || !['handshake', 'validate_binding'].includes(c.operation)
        || 'resultExposurePolicyId' in c || 'resultExposurePolicyVersion' in c || 'externalExecutionId' in c) {
        refuse(`${where}: management context is only application_binding.create handshake/validate_binding without policy`);
      }
      uuid(c.targetId, `${where}.targetId`);
    } else {
      uuid(c.resultExposurePolicyId, `${where}.resultExposurePolicyId`);
      if (!positiveInt(c.resultExposurePolicyVersion)) refuse(`${where}: resultExposurePolicyVersion`);
    }
  }
}

// ---- vector expansion (component_release::prewrite) and check_plan ----------

function vectorPlan(facts, release, registrations, placeholderAe, preconditions) {
  const receivers = facts.nativeReceivers ?? [];
  if (!Array.isArray(receivers)) refuse('nativeReceivers: array');
  const used = new Set();
  const probes = [];
  for (const { category, version, cases, format } of registrations) {
    for (const vectorCase of cases) {
      for (const step of vectorCase.steps) {
        const caseKey = `${category}:${version}:${text(vectorCase.caseKey, 'vector caseKey')}`;
        const stepKey = text(step.stepKey, `${caseKey} stepKey`);
        const key = uuidv5(placeholderAe, `${caseKey}:${stepKey}`);
        let inputJson = step.inputJson;
        if (step.bindings?.length) {
          // Core freezes PRECONDITION values into the request; CAPTURE
          // placeholders stay until the run supplies the candidate's value.
          const input = JSON.parse(step.inputJson);
          for (const binding of step.bindings.filter((b) => b.side === 'INPUT' && b.source === 'PRECONDITION')) {
            const value = preconditions.find((p) => p.caseKey === caseKey && p.key === binding.key)?.value
              ?? refuse(`${caseKey}/${stepKey}: no precondition value for ${binding.key}`);
            pointerSet(input, binding.pointer, value);
          }
          inputJson = JSON.stringify(input);
        }
        const probe = { caseKey, stepKey, operation: 'execute', contractKey: step.contractKey, idempotencyKey: key, inputJson };
        for (const field of ['referenceResourceId', 'referenceAssetId', 'referenceFromStepKey']) if (step[field] !== undefined) probe[field] = step[field];
        // DD-124(4): a target named by a precondition is the frozen fixture
        // value (the isolated Core's real resource.create result).
        if (step.referenceResourceKey !== undefined) {
          probe.referenceResourceId = uuid(preconditions.find((p) => p.caseKey === caseKey && p.key === step.referenceResourceKey)?.value,
            `${caseKey}/${stepKey} target precondition ${step.referenceResourceKey}`);
        }
        const native = release.native.has(step.contractKey);
        // DD-124(3)(4): every step of a V2 RECEIVER case runs in the isolated
        // deployment; a NATIVE_MANAGED key in V2 must be in such a case.
        const receiver = vectorCase.direction === 'RECEIVER';
        if (vectorCase.direction !== undefined && format !== 'V2') {
          refuse(`${caseKey}: direction is a V2 field`);
        }
        if (native && !receiver && format === 'V2') {
          refuse(`${caseKey}/${stepKey}: NATIVE_INTERNAL key ${step.contractKey} needs a RECEIVER V2 case; Core blocks this release`);
        }
        if (native || receiver) {
          const matches = receivers.filter((r) => r.caseKey === caseKey && r.stepKey === stepKey && r.contractKey === step.contractKey);
          if (matches.length !== 1) refuse(`${caseKey}/${stepKey}: exactly one nativeReceivers entry required (NATIVE_INTERNAL key or RECEIVER case step)`);
          exactKeys(matches[0], ['caseKey', 'stepKey', 'contractKey', 'request'], [], `nativeReceivers ${caseKey}/${stepKey}`);
          const request = matches[0].request;
          exactKeys(request, ['idempotencyKey', 'bindingId', 'generation', 'expiresAt'], ['importConfigRef'], `nativeReceivers ${caseKey}/${stepKey}.request`);
          for (const f of ['idempotencyKey', 'bindingId']) uuid(request[f], `nativeReceivers ${caseKey}/${stepKey}.request.${f}`);
          if (!positiveInt(request.generation)) refuse(`nativeReceivers ${caseKey}/${stepKey}: generation`);
          const expires = Date.parse(request.expiresAt);
          if (!Number.isFinite(expires) || expires <= Date.now()) refuse(`nativeReceivers ${caseKey}/${stepKey}: expiresAt must be a future RFC3339 time`);
          // A native batch is started for the exact frozen import
          // configuration; an APPLICATION receiver action names none.
          if (native) {
            uuid(request.importConfigRef, `nativeReceivers ${caseKey}/${stepKey}.request.importConfigRef`);
            if (JSON.parse(inputJson).importConfigRef !== request.importConfigRef) refuse(`nativeReceivers ${caseKey}/${stepKey}: importConfigRef must equal the frozen vector input`);
          } else if (request.importConfigRef !== undefined) {
            refuse(`nativeReceivers ${caseKey}/${stepKey}: an APPLICATION receiver action names no importConfigRef`);
          }
          used.add(`${caseKey}/${stepKey}`);
          probe.operation = 'receiver_start';
          probe.receiverRequest = { ...request, idempotencyKey: key };
          probe.application = !native;
        }
        probes.push({ probe });
      }
    }
  }
  if (receivers.length !== used.size) refuse('nativeReceivers: entries for non-native or unknown vector steps');
  return probes;
}

// application_tool::target
function toolTarget(argumentsValue, where) {
  if (!isObject(argumentsValue) || Object.keys(argumentsValue).length !== 2 || !('input' in argumentsValue)) refuse(`${where}: arguments must be exactly {target,input}`);
  return targetOf(argumentsValue.target, `${where}.arguments.target`);
}

function findContext(identity, step, operation) {
  const found = identity.contexts.find((c) => c.caseKey === step.caseKey && c.stepKey === step.stepKey && c.operation === operation);
  if (!found) refuse(`no identity context for ${step.caseKey}/${step.stepKey}/${operation}`);
  if (step.contractKey !== undefined && found.actionKey !== step.contractKey) refuse(`${step.caseKey}/${step.stepKey}: context actionKey must equal contractKey`);
  if (step.referenceResourceId !== undefined) {
    const [kind, target] = step.referenceAssetId !== undefined ? ['ASSET', step.referenceAssetId] : ['RESOURCE', step.referenceResourceId];
    if (found.targetType !== kind || found.targetId !== target) refuse(`${step.caseKey}/${step.stepKey}: context target must equal the vector reference`);
  }
  return found;
}

function parameterShape(context, operation, request, where) {
  if (operation !== 'execute') return;
  if (!isObject(request) || Object.keys(request).length !== 3 || request.actionKey !== context.actionKey) refuse(`${where}: execute envelope {idempotencyKey, actionKey, arguments} with the context actionKey`);
  uuid(request.idempotencyKey, `${where}.idempotencyKey`);
  const { targetType, targetId } = toolTarget(request.arguments, where);
  if (context.targetType !== targetType || context.targetId !== targetId) refuse(`${where}: execute target differs from its identity context`);
}

function checkPlan(identity, fixtureSteps, vectorProbes) {
  const steps = [...fixtureSteps];
  for (const { probe } of vectorProbes) {
    const context = findContext(identity, probe, probe.operation);
    let request;
    if (probe.operation === 'receiver_start') {
      request = probe.receiverRequest;
    } else {
      // production_probe_execute
      if (!['RESOURCE', 'ASSET'].includes(context.targetType)) refuse(`${probe.caseKey}/${probe.stepKey}: vector target must be RESOURCE or ASSET`);
      request = { idempotencyKey: probe.idempotencyKey, actionKey: probe.contractKey,
        arguments: { target: { [context.targetType === 'RESOURCE' ? 'resourceId' : 'assetId']: context.targetId }, input: JSON.parse(probe.inputJson) } };
    }
    const planned = { caseKey: probe.caseKey, stepKey: probe.stepKey, operation: probe.operation, contractKey: probe.contractKey,
      requestJson: canonical(request) };
    for (const f of ['referenceResourceId', 'referenceAssetId', 'referenceFromStepKey']) if (probe[f] !== undefined) planned[f] = probe[f];
    steps.push(planned);
    const denied = { ...planned, stepKey: `permission-denied:${probe.stepKey}` };
    delete denied.contractKey;
    steps.push(denied);
  }
  steps.forEach((step, index) => {
    const where = `plan step ${index} ${step.caseKey}/${step.stepKey}`;
    const principal = findContext(identity, step, step.operation);
    parameterShape(principal, step.operation, JSON.parse(step.requestJson), where);
    if (step.stepKey.startsWith('permission-denied:')) {
      const previous = steps[index - 1];
      const original = findContext(identity, previous, step.operation);
      if (step.requestJson !== previous.requestJson || step.caseKey !== previous.caseKey || principal.actorPrincipalId === original.actorPrincipalId) {
        refuse(`${where}: denied probe must repeat the request under a different actor`);
      }
      for (const f of ['tenantId', 'workspaceId', 'actionKey', 'actionDefinitionVersion', 'targetType', 'targetId',
        'resultExposurePolicyId', 'resultExposurePolicyVersion', 'externalExecutionId']) {
        if (principal[f] !== original[f]) refuse(`${where}: denied context ${f} must equal the original context`);
      }
    }
    if (['execute', 'cancel', 'observe', 'reconcile'].includes(step.operation)) findContext(identity, step, 'reconcile');
    if (['receiver_start', 'receiver_observe'].includes(step.operation)) {
      const observer = findContext(identity, step, 'receiver_observe');
      for (const f of ['tenantId', 'workspaceId', 'actorPrincipalId', 'actionKey', 'actionDefinitionVersion', 'targetType', 'targetId', 'resultExposurePolicyId', 'resultExposurePolicyVersion']) {
        if (observer[f] !== principal[f]) refuse(`${where}: receiver_observe context ${f} must equal receiver_start`);
      }
    }
  });
  return steps.length;
}

// ---- environment (worker newComponentCandidate) -----------------------------

function buildEnvironment(facts) {
  const env = facts.environment;
  exactKeys(env, ['adapterBaseUrl', 'maxResponseBytes', 'maxSteps'], ['nativeReadAuthorities', 'receiverActionBaseUrl'], 'environment');
  // worker isolatedOrigin
  const origin = (value, label) => {
    let url;
    try { url = new URL(value); } catch { refuse(`${label}: absolute URL`); }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash
      || !['', '/'].includes(url.pathname)) refuse(`${label}: http(s) origin with path "/" only`);
  };
  origin(env.adapterBaseUrl, 'environment.adapterBaseUrl');
  if (env.receiverActionBaseUrl !== undefined) origin(env.receiverActionBaseUrl, 'environment.receiverActionBaseUrl');
  if (!positiveInt(env.maxResponseBytes) || !positiveInt(env.maxSteps)) refuse('environment: positive maxResponseBytes/maxSteps');
  const out = { artifactDigest: facts.artifactDigest, adapterBaseUrl: env.adapterBaseUrl,
    maxResponseBytes: env.maxResponseBytes, maxSteps: env.maxSteps };
  if (env.nativeReadAuthorities !== undefined) {
    if (!Array.isArray(env.nativeReadAuthorities) || !env.nativeReadAuthorities.length) refuse('environment.nativeReadAuthorities: omit or non-empty array');
    for (const a of env.nativeReadAuthorities) {
      exactKeys(a, ['bindingId', 'generation', 'coreBaseUrl', 'oidcTokenUrl', 'oidcClientId', 'oidcClientSecretFile'], [], 'nativeReadAuthorities[]');
      uuid(a.bindingId, 'nativeReadAuthorities[].bindingId');
      if (!positiveInt(a.generation)) refuse('nativeReadAuthorities[].generation');
      for (const f of ['coreBaseUrl', 'oidcTokenUrl', 'oidcClientId']) text(a[f], `nativeReadAuthorities[].${f}`);
      if (!isAbsolute(text(a.oidcClientSecretFile, 'nativeReadAuthorities[].oidcClientSecretFile'))) refuse('nativeReadAuthorities[].oidcClientSecretFile: absolute path (file content is never read here)');
    }
    out.nativeReadAuthorities = env.nativeReadAuthorities;
  }
  if (env.receiverActionBaseUrl !== undefined) out.receiverActionBaseUrl = env.receiverActionBaseUrl;
  return out;
}

// ---- output ------------------------------------------------------------------

function createOnly(dir, name, value) {
  const path = join(dir, name);
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try { writeSync(fd, `${JSON.stringify(value, null, 2)}\n`); } finally { closeSync(fd); }
  return path;
}

function main() {
  const options = args(process.argv.slice(2));
  const facts = ownerOnlyJson(options.facts, '--facts');
  exactKeys(facts, ['formatVersion', 'seed', 'artifactDigest', 'environment', 'identity', 'principals', 'bindingManagement', 'protocol'],
    ['vectorContexts', 'nativeReceivers', 'preconditions', 'receiverEnvironment'], 'facts');
  if (facts.formatVersion !== 1) refuse('facts.formatVersion must be 1');
  uuid(facts.seed, 'facts.seed');
  const manifest = plainJson(options.manifest, '--manifest');
  const release = releaseFacts(manifest);
  if (facts.artifactDigest !== manifest.adapterBuildRef) refuse('facts.artifactDigest must equal manifest.adapterBuildRef (the candidate artifact under test)');
  const registrations = loadRegistrations(manifest, options.registrations);
  if (!isAbsolute(options.out) || !statSync(options.out).isDirectory()) refuse('--out: existing absolute directory');

  const fixtureSteps = protocolFixture(facts, release, manifest);
  const fixture = { artifactDigest: facts.artifactDigest, steps: fixtureSteps };
  const placeholderAe = uuidv5(facts.seed, 'placeholder-action-execution');
  const preconditions = preconditionValues(facts, registrations);
  const vectorProbes = vectorPlan(facts, release, registrations, placeholderAe, preconditions);
  if (facts.nativeReceivers?.length) fixture.nativeReceivers = facts.nativeReceivers;
  if (preconditions.length) fixture.preconditions = preconditions;
  const identity = buildIdentity(facts, release, fixtureSteps, vectorProbes.map(({ probe }) => ({ probe })));
  const environment = buildEnvironment(facts);
  // Worker routes an APPLICATION receiver step only to the isolated
  // deployment's receiver entry and blocks it otherwise.
  if (vectorProbes.some(({ probe }) => probe.application) && environment.receiverActionBaseUrl === undefined) {
    refuse('environment.receiverActionBaseUrl is required: the plan has APPLICATION receiver steps (receiver-run.sh driver)');
  }

  verifyFixture(fixture, manifest.adapterBuildRef, release.cancelSupported);
  verifyIdentity(identity, manifest.adapterBuildRef, release.productionAudience);
  const planSteps = checkPlan(identity, fixtureSteps, vectorProbes);
  if (planSteps > environment.maxSteps) refuse(`environment.maxSteps ${environment.maxSteps} < frozen plan steps ${planSteps}`);

  const written = [
    createOnly(options.out, 'fixture.json', fixture),
    createOnly(options.out, 'identity.json', identity),
    createOnly(options.out, 'environment.json', environment),
  ];
  process.stdout.write(`${JSON.stringify({ release: manifest.id, componentTypeKey: manifest.componentTypeKey,
    artifactDigest: manifest.adapterBuildRef, protocolSteps: fixtureSteps.length, vectorSteps: vectorProbes.length,
    planSteps, identityContexts: identity.contexts.length, files: written }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`conformance-inputs: ${error instanceof Refusal || error instanceof VectorRefusal ? error.message : 'unreadable or invalid input'}\n`);
  process.exitCode = 1;
}
