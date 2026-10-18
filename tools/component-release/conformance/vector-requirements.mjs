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
// Usage: node tools/component-release/conformance/vector-requirements.mjs \
//          --component file-storage|knowledge [--out /abs/requirements.json]
// Writes nothing else; contacts nothing.

import { constants, closeSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COMPONENTS = {
  'file-storage': { manifest: 'file-storage/fork/release/manifest.json', native: 'cells' },
  knowledge: { manifest: 'knowledge/fork/release/manifest.json', native: 'weknora' },
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
};

class Refusal extends Error {}
const fail = (message) => { throw new Refusal(message); };

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--component', '--out'].includes(argv[i]) || argv[i + 1] === undefined || out[argv[i].slice(2)] !== undefined) {
      fail('usage: vector-requirements.mjs --component file-storage|knowledge [--out /abs/file]');
    }
    out[argv[i].slice(2)] = argv[i + 1];
  }
  if (!COMPONENTS[out.component]) fail('--component must be file-storage or knowledge');
  if (out.out !== undefined && !isAbsolute(out.out)) fail('--out must be absolute');
  return out;
}

const json = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));

function vectors(manifest) {
  return manifest.implements.map(({ categoryKey, contractVersion }) => {
    const registration = json(`contracts/adapter/${categoryKey}.v${contractVersion}/registration.json`);
    const parsed = typeof registration.testVectorsJson === 'string' ? JSON.parse(registration.testVectorsJson) : registration.testVectorsJson;
    return { category: categoryKey, version: contractVersion, cases: parsed.cases };
  });
}

function cells(caseKey, step, input, expected, push) {
  const verb = step.contractKey.replace(/^file_storage\.|@v1$/g, '');
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
  const verb = step.contractKey.replace(/^knowledge\.|@v2$/g, '');
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
  for (const { category, version, cases } of vectors(manifest)) {
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
        (component.native === 'cells' ? cells : weknora)(caseKey, step, input, expected, push);
      }
    }
  }
  const blocked = requirements.filter((entry) => entry.class === 'unmintable');
  const report = { component: options.component, manifest: component.manifest,
    implements: manifest.implements, satisfiable: blocked.length === 0, requirements, blocked };
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
  process.stderr.write(`vector-requirements: ${error instanceof Refusal ? error.message : 'unreadable contract or manifest'}\n`);
  process.exitCode = 1;
}
