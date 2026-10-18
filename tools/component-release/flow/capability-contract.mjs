// Shared by capability-contract-activate.mjs and capability-contract-deprecate.mjs:
// the digests Core computes for a checked-in registration, and the Catalog row.
import { canonical, digest, readAll } from './lib.mjs';

// capability_contract.rs registration(): schema documents keyed by the
// canonical sha256 of each document; Rust BTreeMap iterates in key order.
export function expectedSchemaSetDigest(registration) {
  const documents = new Map();
  for (const text of registration.schemaDocuments) {
    const parsed = JSON.parse(text);
    documents.set(digest(parsed), parsed);
  }
  const ordered = [...documents.keys()].sort().map((d) => ({ digest: d, schema: documents.get(d) }));
  return digest(ordered);
}

// capability_contract.rs vectors(): every step document is stored as its
// compact sorted-key JSON (serde_json without preserve_order), then the whole
// vector document is digested canonically.
export function expectedSuiteDigest(registration) {
  const vectors = JSON.parse(registration.testVectorsJson);
  for (const vectorCase of vectors.cases ?? []) {
    for (const step of vectorCase.steps ?? []) {
      step.inputJson = canonical(JSON.parse(step.inputJson));
      step.expectedOutputJson = canonical(JSON.parse(step.expectedOutputJson));
    }
  }
  return { formatVersion: vectors.formatVersion, digest: digest(vectors) };
}

export async function contract(session, category, version) {
  const { rows } = await readAll(session, '/api/v1/platform/capability-contracts', 'contracts');
  return rows.find((row) => row.categoryKey === category && row.contractVersion === version);
}
