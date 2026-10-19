#!/usr/bin/env node
// Stage 0 of tools/component-release/conformance-run.sh. Reads the frozen
// capability vectors a release `implements` (the ACTIVE Catalog contract is
// built from the same contracts/adapter/<category>.v<N>/registration.json,
// DD-108) and derives every native object the isolated instance must hold
// before Core's suite can pass. Each identity is classified against the
// component's *native* API (07 §8A: fixtures are created only through the
// original product, never SQL or a simulated result):
//
//   mintable      the native API accepts the caller-chosen identity
//   observed      any native identity works; the seed records what it gets
//   unmintable    the native service mints it server-side, or only Core can
//                 mint it; no native-only fixture can equal the frozen vector
//
// Any unmintable requirement, or a contract step this tool cannot classify,
// is a release blocker (exit 3): registering would freeze a plan whose
// expectations no isolated instance can meet, and changing the expectation
// instead would be an invented fact. The fix is a new, implementation-neutral
// capability contract version (DD-102 capability_contract.register/approve),
// not a different fixture.
//
// V2 vectors (DD-124(1)(2), file_storage@2) classify every value instead:
//
//   LITERAL       platform-side ids, caller-chosen ids, content and metadata
//   PRECONDITION  case preconditions[]: the seed creates each through the
//                 original native entry and records the identity Cells
//                 returned (precondition class below); never a vector value
//   CAPTURE       Core takes it from the candidate's own SUCCEEDED wire
//                 response during the run; nothing is seeded or predicted
//
// Wren V2 (data_query@2, DD-124(3)): no precondition and no Wren-generated
// identity is in the vectors. Every step targets the one literal platform
// Resource that the conformance provider maps to the native model the seed
// deployed through the original GraphQL deploy (data-query/docker/conformance/
// provider.mjs prepare); describe's deployment id/hash and typed reference are
// captured by Core. The model name/columns and the source rows are literal
// content of the isolated instance. data_query@1 (V1) writes the deployment id
// and MDL hash Wren generates as literals: unmintable, exit 3.
//
// The vector document is first checked with the shared DD-124 reader
// (vector-v2.mjs); a document that writes an implementation-generated identity
// as LITERAL, or uses an undeclared placeholder, is refused. Each precondition
// is mapped to its Cells native role from how the frozen steps consume it
// (node / draft revision / share link); a role or Resource mapping the Cells
// native model cannot honour is a release blocker (exit 3) like above.
//
// WeKnora V2 (knowledge@3, DD-124(3)(4)): every case that depends on the
// service read edge is a RECEIVER case observed only in the isolated receiver
// deployment (tools/component-release/receiver-run.sh); its Resources are
// preconditions whose values the isolated Core's real resource.create returned,
// its source file/revision preconditions come
// from the isolated Core's actual contract read of the APPROVED source release
// and its import configurations from WeKnora's own data source entry. Execution
// ids and batch ids are captured from the isolated Core and candidate only.
//
// Usage: node tools/component-release/conformance/vector-requirements.mjs \
//          --component file-storage|knowledge|data-query [--out /abs/requirements.json]
// Writes nothing else; contacts nothing.

import { constants, closeSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VectorRefusal, analyseV2, parseVectors } from './vector-v2.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COMPONENTS = {
  'file-storage': { manifest: 'file-storage/fork/release/manifest.json', native: 'cells' },
  knowledge: { manifest: 'knowledge/fork/release/manifest.json', native: 'weknora' },
  'data-query': { manifest: 'data-query/fork/release/manifest.json', native: 'wren' },
};

// Source evidence (fixed fork trees in this repository) for each class.
const EVIDENCE = {
  cellsNode: 'file-storage/gateway/restv2/api-create.go Create: IncomingNode.ResourceUuid -> Create-Resource-Uuid (also X-Amz-Meta-Create-Resource-Uuid on PUT)',
  cellsDraft: 'file-storage/common/nodes/version/handler-version.go routeUploadToContentRevision: X-Amz-Meta-Create-Version-Id with X-Amz-Meta-Draft-Mode=true names the owner draft revision',
  cellsHead: 'file-storage/data/versions/grpc/handler.go CreateVersion: VersionId = uuid.New() unless a claimed Task supplies a sha256-hex id (data/versions/action-version.go); promote copies into a new version (gateway/restv2/api-versions.go promoteDraftVersion)',
  cellsShare: 'file-storage/idm/share/client.go: a new link takes the UUID of its newly created link workspace; a caller-supplied Uuid selects the update of an existing link',
  coreAe: 'Core admission creates ActionExecution ids itself (governance.rs); no native or platform API accepts a caller-chosen AE id',
  readGrant: 'knowledge ingest@v2 calls request_read_grant with receiverActionExecutionId = the Core-signed probe AE (knowledge/adapter/src/service-read.mjs); Core admits only an APPLICATION AE it holds for that receiver binding (core/crates/platform-core/src/application_read_grant.rs), which an isolated Core cannot hold for a production registration AE, and 07 §8A forbids simulating that grant',
  receiver: 'NATIVE_INTERNAL receiver steps need the isolated Core of 07 §8A (core/verify/receiver-environment-bootstrap.rs; its real-environment entry is still #[ignore]) and Core-minted SOURCE read AEs',
  isolatedResource: 'DD-124(4), 07 §8A: the isolated Core registers each platform Resource through the real resource.create over an existing native object (DD-98; core/verify/receiver-environment-bootstrap.rs) and grants the read edge through the real resource.grant_read; the returned Resource ids are the fixture values; nothing is written to production',
  isolatedSource: 'DD-124(4): the source file is created through the APPROVED source release\'s native entry in the isolated deployment; the seed records the typed ContentReference the isolated Core\'s actual contract read returned (never a vector value)',
  weknoraImport: 'knowledge/internal/application/service/datasource_file_storage.go: a file_storage data source of the receiver knowledge base is created through WeKnora\'s own /api/v1/datasource entry (internal/router/routes_infra.go); its id is the importConfigRef the seed records',
  isolatedCapture: 'DD-124(4): the isolated Core creates the receiver admission, SOURCE read ActionExecutions and the candidate its batch; Core verifies they are absent from the frozen plan and fixture',
  cellsLink: 'file-storage/idm/share/client.go UpsertLink: a new public link (PUT /a/share/link, Uuid empty) takes the UUID Cells mints for its link workspace; the seed records that returned Uuid',
  capture: 'DD-124(2): Core takes the value from the candidate\'s own SUCCEEDED wire response (typed ContentReference or generatedRefs field) during the run; the seed creates nothing and no expectation is written here',
  cellsRoot: 'file-storage/idm/share/native-link.go nativeShareIntent: a governed revoke targets the Resource whose native ref is the binding nativeRootRef',
  cellsPromote: 'file-storage/gateway/restv2/native-write-execution.go executeNativePromote: a governed promote targets the Resource whose native ref is the written node',
  wrenDeployment: 'data-query/wren-ui/src/apollo/server/services/deployService.ts: the original deploy commits a deploy_log row whose serial id and createMDLHash are generated by Wren (SF-WRN-08); data-query/docker/conformance/provider.mjs prepare publishes the row it observed, never a chosen value',
  wrenModel: 'data-query/docker/conformance/provider.mjs prepare: the native project/model created through the original Wren setup is deployed by the original GraphQL deploy; the provider maps the step Resource to that model (07 §8A)',
  wrenSource: 'isolated PostgreSQL source of the native project: table, column and rows are literal fixture content the operator creates, read only through the original Ibis query consumer',
};

class Refusal extends Error {}
const fail = (message) => { throw new Refusal(message); };

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--component', '--out'].includes(argv[i]) || argv[i + 1] === undefined || out[argv[i].slice(2)] !== undefined) {
      fail('usage: vector-requirements.mjs --component file-storage|knowledge|data-query [--out /abs/file]');
    }
    out[argv[i].slice(2)] = argv[i + 1];
  }
  if (!COMPONENTS[out.component]) fail('--component must be file-storage, knowledge or data-query');
  if (out.out !== undefined && !isAbsolute(out.out)) fail('--out must be absolute');
  return out;
}

const json = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));

function vectors(manifest) {
  return manifest.implements.map(({ categoryKey, contractVersion }) => {
    const registration = json(`contracts/adapter/${categoryKey}.v${contractVersion}/registration.json`);
    const parsed = parseVectors(registration);
    return { category: categoryKey, version: contractVersion, format: parsed.formatVersion, vectors: parsed, cases: parsed.cases };
  });
}

const verbOf = (contractKey, category) => contractKey.replace(new RegExp(`^${category}\\.|@v[0-9]+$`, 'g'), '');

// V2 (DD-124): native role of every precondition, derived from the frozen
// steps that send it, plus the native object each referenced Resource maps to.
function cellsV2(category, version, analysed, push) {
  for (const vectorCase of analysed.cases) {
    const caseKey = `${category}:${version}:${vectorCase.caseKey}`;
    const roles = new Map();
    const assign = (key, role, at, node) => {
      const known = roles.get(key);
      if (known && (known.role !== role || known.node !== node)) fail(`${at}: precondition ${key} is used as both ${known.role} and ${role}`);
      roles.set(key, { role, node });
    };
    const inputBinding = (step, pointer) => step.bindings.find((b) => b.side === 'INPUT' && b.pointer === pointer);
    for (const step of vectorCase.steps) {
      const verb = verbOf(step.contractKey, category);
      const at = `${caseKey}/${step.stepKey}`;
      for (const binding of step.bindings.filter((b) => b.side === 'INPUT' && b.source === 'PRECONDITION')) {
        if (binding.pointer === '/nativeObjectRef' && ['list_revisions', 'read', 'export', 'write'].includes(verb)) assign(binding.key, 'node', at);
        else if (verb === 'delete' && /^\/nativeObjectRefs\/(0|[1-9][0-9]*)$/.test(binding.pointer)) assign(binding.key, 'node', at);
        else if (verb === 'write' && binding.pointer === '/nativeRevision') {
          const node = inputBinding(step, '/nativeObjectRef');
          if (node?.source !== 'PRECONDITION') fail(`${at}: draft precondition ${binding.key} needs the written node as a precondition`);
          assign(binding.key, 'draft', at, node.key);
        } else if (verb === 'share' && binding.pointer === '/nativeShareRef') assign(binding.key, 'share', at);
        else fail(`${at}: precondition ${binding.key} at INPUT${binding.pointer} is not classified for Cells`);
      }
      for (const capture of step.captures) {
        push({ at, kind: 'capture', key: capture.key, slot: capture.slot, ...(capture.pointer ? { pointer: capture.pointer } : {}),
          class: 'capture', evidence: EVIDENCE.capture });
      }
    }
    // Metadata and content of each node come from the precondition's own
    // literal properties or the case's literal expectations, never invented.
    const literal = (key, field) => {
      const values = new Set();
      const precondition = vectorCase.preconditions.find((item) => item.key === key);
      if (typeof precondition.properties[field] === 'string') values.add(precondition.properties[field]);
      for (const step of vectorCase.steps) {
        const bound = inputBinding(step, '/nativeObjectRef');
        if (bound?.source !== 'PRECONDITION' || bound.key !== key) continue;
        const verb = verbOf(step.contractKey, category);
        if (['read', 'export', 'write'].includes(verb) && typeof step.input[field] === 'string'
          && !step.bindings.some((b) => b.side === 'INPUT' && b.pointer === `/${field}`)) values.add(step.input[field]);
        if (field === 'text' && verb === 'read' && typeof step.expected.text === 'string') values.add(step.expected.text);
        if (field === 'text' && verb === 'export' && typeof step.expected.contentBase64 === 'string') {
          values.add(Buffer.from(step.expected.contentBase64, 'base64').toString('utf8'));
        }
      }
      if (field === 'text' && typeof precondition.properties.content === 'string') values.add(precondition.properties.content);
      // A node whose bytes no step reads is created empty; bytes no step
      // compares are fixture content, not an expectation.
      if (field === 'text' && values.size === 0) return '';
      if (values.size !== 1) fail(`${caseKey}/${key}: ${values.size ? 'conflicting' : 'no'} literal ${field} for the native file`);
      return [...values][0];
    };
    for (const [key, { role, node }] of roles) {
      const precondition = vectorCase.preconditions.find((item) => item.key === key);
      const base = { at: `${caseKey}/${key}`, kind: 'cells-precondition', caseKey, key, contractKind: precondition.kind, role, class: 'precondition' };
      if (role === 'node') {
        push({ ...base, displayName: literal(key, 'displayName'), mediaType: literal(key, 'mediaType'), text: literal(key, 'text'),
          evidence: EVIDENCE.cellsNode });
      } else if (role === 'draft') {
        // Created together with its node by the actor's draft-mode upload, so
        // the promoted revision is the node's first published one. Its bytes
        // are the draft_revision's own literal text property.
        const text = typeof precondition.properties.text === 'string' ? precondition.properties.text : literal(node, 'text');
        const read = literal(node, 'text');
        if (read !== '' && read !== text) fail(`${caseKey}/${key}: draft text differs from the case's literal read/export expectation`);
        push({ ...base, node, text, owner: 'conformance-actor', evidence: EVIDENCE.cellsDraft });
      } else {
        push({ ...base, target: 'binding-root', evidence: `${EVIDENCE.cellsLink}; ${EVIDENCE.cellsRoot}` });
      }
    }
    // Resource -> native object. Cells admits a governed promote only on the
    // written node's Resource and a revoke only on the binding root Resource.
    for (const step of vectorCase.steps) {
      // The step's Resource is its typed referenceResourceId when present
      // (write/read/export) and otherwise the literal input resourceId that
      // the isolated identity context targets (list, list_revisions, share,
      // delete); never a bound value.
      const inputResource = step.bindings.some((b) => b.side === 'INPUT' && b.pointer === '/resourceId') ? undefined : step.input?.resourceId;
      const resourceId = step.referenceResourceId ?? inputResource;
      const verb = verbOf(step.contractKey, category);
      const at = `${caseKey}/${step.stepKey}`;
      if (resourceId === undefined) continue;
      if (!UUID.test(resourceId) || (step.referenceResourceId !== undefined && inputResource !== undefined && inputResource !== step.referenceResourceId)) {
        fail(`${at}: step Resource must be one literal UUID (referenceResourceId and input resourceId agree)`);
      }
      const target = (pointer) => {
        const bound = inputBinding(step, pointer);
        return bound?.source === 'PRECONDITION' && roles.get(bound.key)?.role === 'node' ? { precondition: bound.key } : null;
      };
      let nativeObject;
      if (verb === 'share') nativeObject = { root: true };
      else if (verb === 'list') nativeObject = JSON.stringify(step.expected) === '{"citations":[]}' ? { emptyFolder: true } : null;
      else if (verb === 'delete') nativeObject = target('/nativeObjectRefs/0');
      else nativeObject = target('/nativeObjectRef');
      push({ at, kind: 'platform-resource', caseKey, resourceId, verb,
        ...(nativeObject ? { nativeObject, class: 'observed', evidence: verb === 'share' ? EVIDENCE.cellsRoot : verb === 'write' ? EVIDENCE.cellsPromote
          : 'simulated isolated Resource id; the conformance provider maps it to the observed native object (07 §8A)' }
          : { class: 'unmintable', evidence: `${verb} Resource has no native object a seed can create before the run (non-empty listing or captured node)` }) });
    }
  }
}

// knowledge@3 (DD-124(3)(4)): classify each precondition by its registered
// kind and each step Resource as an isolated bootstrap Resource.
const WEKNORA_KINDS = {
  receiver_resource: { class: 'precondition', role: 'receiver-resource', evidence: 'isolatedResource' },
  source_resource: { class: 'precondition', role: 'source-resource', evidence: 'isolatedResource' },
  import_config: { class: 'precondition', role: 'import-config', evidence: 'weknoraImport' },
  retiring_import_config: { class: 'precondition', role: 'retiring-import-config', evidence: 'weknoraImport' },
  source_file: { class: 'precondition', role: 'source-file', evidence: 'isolatedSource' },
  source_revision: { class: 'precondition', role: 'source-revision', evidence: 'isolatedSource' },
};

function weknoraV2(category, version, analysed, push) {
  for (const vectorCase of analysed.cases) {
    const caseKey = `${category}:${version}:${vectorCase.caseKey}`;
    for (const precondition of vectorCase.preconditions) {
      const known = WEKNORA_KINDS[precondition.kind] ?? fail(`${caseKey}/${precondition.key}: kind ${precondition.kind} is not classified for WeKnora`);
      push({ at: `${caseKey}/${precondition.key}`, kind: 'weknora-precondition', caseKey, key: precondition.key,
        contractKind: precondition.kind, role: known.role, properties: precondition.properties, class: known.class,
        evidence: EVIDENCE[known.evidence] });
    }
    for (const step of vectorCase.steps) {
      const at = `${caseKey}/${step.stepKey}`;
      const verb = verbOf(step.contractKey, category);
      const receiver = vectorCase.direction === 'RECEIVER';
      // A case that reads the source edge runs wholly in the isolated receiver
      // deployment; a FORWARD ingest or sync would need production source
      // reads the plan cannot hold.
      if (['ingest', 'sync_apply', 'sync_retire'].includes(verb) && !receiver) {
        fail(`${at}: ${step.contractKey} must be in a RECEIVER case for WeKnora`);
      }
      for (const capture of step.captures) {
        const isolated = receiver && ['ACTION_EXECUTION_ID', 'OPERATION_ID', 'GENERATED_REF'].includes(capture.slot);
        push({ at, kind: 'capture', key: capture.key, slot: capture.slot, ...(capture.pointer ? { pointer: capture.pointer } : {}),
          class: 'capture', evidence: isolated ? EVIDENCE.isolatedCapture : EVIDENCE.capture });
      }
      // DD-124(4): every Resource of a receiver-direction case is a seeded
      // precondition; a literal one could not be the isolated Core's own id.
      if (step.referenceResourceId !== undefined) fail(`${at}: knowledge Resources are preconditions, not literal ids`);
      for (const pointer of ['/resourceId', '/sourceResourceId']) {
        if (step.input?.[pointer.slice(1)] !== undefined
          && !step.bindings.some((b) => b.side === 'INPUT' && b.source === 'PRECONDITION' && b.pointer === pointer)) {
          fail(`${at}: INPUT${pointer} must be a Resource precondition`);
        }
      }
    }
  }
}

// data_query@2 (DD-124(3)): one native model with a SUCCESS deployment behind
// each literal step Resource; everything Wren generates is a capture.
function wrenV2(category, version, analysed, push) {
  for (const vectorCase of analysed.cases) {
    const caseKey = `${category}:${version}:${vectorCase.caseKey}`;
    if (vectorCase.direction === 'RECEIVER') fail(`${caseKey}: Wren has no read-edge receiver case`);
    for (const precondition of vectorCase.preconditions) {
      fail(`${caseKey}/${precondition.key}: precondition kind ${precondition.kind} is not classified for Wren`);
    }
    const models = new Map();
    for (const step of vectorCase.steps) {
      const at = `${caseKey}/${step.stepKey}`;
      const verb = verbOf(step.contractKey, category);
      if (!['describe', 'dry_run', 'query'].includes(verb)) fail(`${at}: contract key ${step.contractKey} is not classified for Wren`);
      for (const capture of step.captures) {
        push({ at, kind: 'capture', key: capture.key, slot: capture.slot, ...(capture.pointer ? { pointer: capture.pointer } : {}),
          class: 'capture', evidence: capture.slot === 'GENERATED_REF' ? `${EVIDENCE.capture}; ${EVIDENCE.wrenDeployment}` : EVIDENCE.capture });
      }
      // Wren's adapter targets the Resource of the typed reference; a step
      // without one has no native model a seed can deploy before the run.
      const inputResource = step.bindings.some((b) => b.side === 'INPUT' && b.pointer === '/resourceId') ? undefined : step.input?.resourceId;
      const resourceId = step.referenceResourceId;
      if (!UUID.test(resourceId ?? '') || (inputResource !== undefined && inputResource !== resourceId)) {
        push({ at, kind: 'platform-resource', caseKey, resourceId: resourceId ?? inputResource, verb, class: 'unmintable',
          evidence: 'a Wren step names one literal Resource by referenceResourceId (and the same input resourceId)' });
        continue;
      }
      if (verb === 'describe') {
        if (!Array.isArray(step.expected.models) || step.expected.models.length !== 1) fail(`${at}: describe must expect exactly one model`);
        const [model] = step.expected.models;
        models.set(resourceId, { name: model.name, columns: model.columns });
        push({ at, kind: 'wren-model', caseKey, resourceId, name: model.name, columns: model.columns, class: 'observed',
          evidence: `${EVIDENCE.wrenModel}; ${EVIDENCE.wrenDeployment}` });
      } else if (verb === 'query') {
        push({ at, kind: 'wren-source-rows', caseKey, resourceId, columns: step.expected.columns, data: step.expected.data,
          class: 'mintable', evidence: EVIDENCE.wrenSource });
      }
      push({ at, kind: 'platform-resource', caseKey, resourceId, verb,
        ...(models.has(resourceId) ? { nativeObject: { model: models.get(resourceId).name }, class: 'observed',
          evidence: 'simulated isolated Resource id; the Wren conformance provider maps it to the deployed native model (07 §8A)' }
          : { class: 'unmintable', evidence: `${verb} Resource names no model a preceding describe step expects` }) });
    }
  }
}

// data_query@1 (V1): the deployment id and MDL hash Wren generates are
// literal expectations; nothing the native entry accepts can choose them.
function wren(caseKey, step, input, expected, push) {
  const verb = verbOf(step.contractKey, 'data_query');
  const at = `${caseKey}/${step.stepKey}`;
  if (!['describe', 'dry_run', 'query'].includes(verb)) fail(`${at}: contract key ${step.contractKey} is not classified for Wren`);
  for (const document of [input, expected]) {
    if (document?.deploymentId !== undefined || document?.deploymentHash !== undefined) {
      push({ at, kind: 'wren-deployment', deploymentId: document.deploymentId, deploymentHash: document.deploymentHash,
        class: 'unmintable', evidence: EVIDENCE.wrenDeployment });
    }
  }
}

function cells(caseKey, step, input, expected, push) {
  const verb = verbOf(step.contractKey, 'file_storage');
  const at = `${caseKey}/${step.stepKey}`;
  switch (verb) {
    case 'list':
      push({ at, kind: 'cells-folder', resourceId: input.resourceId, emptyListing: JSON.stringify(expected) === '{"citations":[]}', class: 'observed' });
      break;
    case 'list_revisions':
      push({ at, kind: 'cells-node', nativeRef: input.nativeObjectRef, resourceId: input.resourceId, class: 'mintable', evidence: EVIDENCE.cellsNode });
      for (const citation of expected.citations ?? []) {
        push({ at, kind: 'cells-node-name', nativeRef: citation.nativeObjectRef, displayName: citation.displayName, mediaType: citation.mediaType, class: 'mintable', evidence: EVIDENCE.cellsNode });
        push({ at, kind: 'cells-head-revision', nativeRef: citation.nativeObjectRef, revision: citation.nativeRevision, class: 'unmintable', evidence: EVIDENCE.cellsHead });
      }
      break;
    case 'write': {
      let reference;
      try { reference = JSON.parse(input.nativeObjectRef); } catch { reference = { nodeUuid: input.nativeObjectRef }; }
      push({ at, kind: 'cells-node', nativeRef: reference.nodeUuid, resourceId: input.resourceId, class: 'mintable', evidence: EVIDENCE.cellsNode });
      push({ at, kind: 'cells-draft-revision', nativeRef: reference.nodeUuid, revision: input.nativeRevision, owner: 'conformance-actor', class: 'mintable', evidence: EVIDENCE.cellsDraft });
      break;
    }
    case 'read':
      if (step.referenceFromStepKey === undefined || typeof expected.text !== 'string') fail(`${at}: unclassified read vector`);
      push({ at, kind: 'cells-draft-content', from: step.referenceFromStepKey, text: expected.text, class: 'mintable', evidence: EVIDENCE.cellsDraft });
      break;
    case 'export':
      if (step.referenceFromStepKey === undefined) fail(`${at}: unclassified export vector`);
      push({ at, kind: 'cells-draft-content', from: step.referenceFromStepKey, text: Buffer.from(expected.contentBase64, 'base64').toString('utf8'),
        displayName: expected.filename, mediaType: expected.mediaType, class: 'mintable', evidence: EVIDENCE.cellsDraft });
      break;
    case 'share':
      push({ at, kind: 'cells-share-link', nativeRef: input.nativeShareRef, resourceId: input.resourceId, class: 'unmintable', evidence: EVIDENCE.cellsShare });
      break;
    case 'delete':
      for (const ref of input.nativeObjectRefs) push({ at, kind: 'cells-node', nativeRef: ref, resourceId: input.resourceId, class: 'mintable', evidence: EVIDENCE.cellsNode });
      break;
    default:
      fail(`${at}: contract key ${step.contractKey} is not classified for Cells`);
  }
}

function weknora(caseKey, step, input, expected, push) {
  const verb = verbOf(step.contractKey, 'knowledge');
  const at = `${caseKey}/${step.stepKey}`;
  switch (verb) {
    case 'ingest':
      push({ at, kind: 'source-content-reference', sourceResourceId: input.resourceId, nativeRef: input.nativeObjectRef, revision: input.nativeRevision,
        class: 'unmintable', evidence: `${EVIDENCE.cellsHead}; ${EVIDENCE.readGrant}` });
      break;
    case 'read':
    case 'export':
    case 'delete':
      push({ at, kind: 'knowledge-document', from: step.referenceFromStepKey, class: 'unmintable', evidence: 'depends on the ingest step\'s server-side read grant and source reference above' });
      break;
    case 'search':
      for (const citation of expected.citations ?? []) {
        push({ at, kind: 'source-content-reference', nativeRef: citation.nativeObjectRef, revision: citation.nativeRevision, class: 'unmintable', evidence: EVIDENCE.cellsHead });
      }
      break;
    case 'sync_apply':
    case 'sync_retire':
      push({ at, kind: 'core-action-execution', id: input.sourceReadActionExecutionId, class: 'unmintable', evidence: EVIDENCE.coreAe });
      push({ at, kind: 'native-receiver', importConfigRef: input.importConfigRef, batchId: input.batchId, class: 'unmintable', evidence: EVIDENCE.receiver });
      break;
    default:
      fail(`${at}: contract key ${step.contractKey} is not classified for WeKnora`);
  }
}

function main() {
  const options = args(process.argv.slice(2));
  const component = COMPONENTS[options.component];
  const manifest = json(component.manifest);
  const requirements = [];
  const formats = [];
  for (const { category, version, format, vectors: document, cases } of vectors(manifest)) {
    formats.push({ categoryKey: category, contractVersion: version, formatVersion: format });
    if (format === 'V2') {
      const classify = { cells: cellsV2, weknora: weknoraV2, wren: wrenV2 }[component.native];
      classify(category, version, analyseV2(document, `${category}@${version}`), (entry) => requirements.push(entry));
      continue;
    }
    for (const vectorCase of cases) {
      const caseKey = `${category}:${version}:${vectorCase.caseKey}`;
      for (const step of vectorCase.steps) {
        const input = JSON.parse(step.inputJson);
        const expected = JSON.parse(step.expectedOutputJson);
        const push = (entry) => requirements.push({ contractKey: step.contractKey, ...entry });
        if (step.referenceResourceId !== undefined) {
          if (!UUID.test(step.referenceResourceId)) fail(`${caseKey}/${step.stepKey}: invalid referenceResourceId`);
          push({ at: `${caseKey}/${step.stepKey}`, kind: 'platform-resource', resourceId: step.referenceResourceId, class: 'observed',
            evidence: 'simulated isolated Resource id; the conformance provider maps it to the observed native object (07 §8A)' });
        }
        ({ cells, weknora, wren }[component.native])(caseKey, step, input, expected, push);
      }
    }
  }
  // One Resource maps to exactly one native object across every case.
  const mapped = new Map();
  for (const entry of requirements.filter((item) => item.kind === 'platform-resource' && item.nativeObject)) {
    const value = JSON.stringify(entry.nativeObject.precondition ? { precondition: `${entry.caseKey}/${entry.nativeObject.precondition}` } : entry.nativeObject);
    const known = mapped.get(entry.resourceId);
    if (known !== undefined && known !== value) {
      requirements.push({ at: entry.at, kind: 'resource-conflict', resourceId: entry.resourceId, class: 'unmintable',
        evidence: `one Resource would need two Cells native objects (${known} and ${value}); ${EVIDENCE.cellsRoot}; ${EVIDENCE.cellsPromote}` });
    }
    mapped.set(entry.resourceId, known ?? value);
  }
  const blocked = requirements.filter((entry) => entry.class === 'unmintable');
  const report = { component: options.component, manifest: component.manifest,
    implements: manifest.implements, formats, satisfiable: blocked.length === 0, requirements, blocked };
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (options.out) {
    const fd = openSync(options.out, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try { writeSync(fd, text); } finally { closeSync(fd); }
  }
  process.stdout.write(text);
  if (blocked.length) {
    process.stderr.write(`vector-requirements: ${blocked.length} frozen native identities cannot be created through the native API; `
      + 'register a corrected contract version instead of inventing fixtures\n');
    process.exitCode = 3;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`vector-requirements: ${error instanceof Refusal || error instanceof VectorRefusal ? error.message : 'unreadable contract or manifest'}\n`);
  process.exitCode = 1;
}
