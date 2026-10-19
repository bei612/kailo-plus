#!/usr/bin/env node
// DD-124(3): withdraw the capability contract versions whose vectors no
// implementation can satisfy through its native entry, once their corrected
// successors are ACTIVE. file_storage@1 (literal head revision and share ids)
// is replaced by file_storage@2; knowledge@2 (literal source revision and Core
// execution ids, never approved) by knowledge@3; data_query@1 (literal Wren
// deployment id/hash, schema typing them as Wren's integer/hex) by data_query@2. Each withdrawal is the
// governed capability_contract.deprecate action (explicit confirmation, no
// approval); it applies to an ACTIVE seed and to a never-approved DRAFT alike,
// and a DEPRECATED version can never be approved again. Existing bindings keep
// working; new releases can no longer implement the deprecated version.
//
// The run refuses before any write unless every successor is ACTIVE with the
// checked-in schema and suite digests (capability-contract-activate.mjs), so a
// category is never left without an implementable version. A version that is
// already DEPRECATED, or was never registered, needs nothing.
//
// Usage: node capability-contract-deprecate.mjs [--attempt N]
// Exit codes follow lib.mjs main(): 0 done, 1 refused, 2 invalid state,
// 3 still converging (re-run the same command).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { attempt, FlowError, key, log, login, main, parseArgs, requireSession, sleep, submit } from './lib.mjs';
import { contract, expectedSchemaSetDigest, expectedSuiteDigest } from './capability-contract.mjs';

const REPLACEMENTS = [
  { retired: ['file_storage', 1], successor: ['file_storage', 2] },
  { retired: ['knowledge', 2], successor: ['knowledge', 3] },
  { retired: ['data_query', 1], successor: ['data_query', 2] },
];

function registrationOf(category, version) {
  const path = fileURLToPath(new URL(`../../../contracts/adapter/${category}.v${version}/registration.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

await main(async () => {
  const args = parseArgs(process.argv.slice(2), ['attempt']);
  const run = attempt(args);
  const admin = await login('platform-admin', 'contract-deprecate-admin');
  const catalog = await requireSession(admin);

  // Every successor must already be the immutable checked-in ACTIVE version.
  for (const { successor: [category, version] } of REPLACEMENTS) {
    const registration = registrationOf(category, version);
    const row = await contract(admin, category, version);
    const schemaSetDigest = expectedSchemaSetDigest(registration);
    const suite = expectedSuiteDigest(registration);
    log({ step: 'successor', contract: `${category}@${version}`, status: row?.status ?? 'ABSENT' });
    if (row?.status !== 'ACTIVE' || row.schemaSetDigest !== schemaSetDigest || row.conformanceSuiteDigest !== suite.digest) {
      throw new FlowError(`${category}@${version} is not the ACTIVE checked-in version; activate it first `
        + '(capability-contract-activate.mjs) — nothing was deprecated', 2);
    }
  }

  for (const { retired: [category, version] } of REPLACEMENTS) {
    const label = `${category}@${version}`;
    let row = await contract(admin, category, version);
    log({ step: 'read', contract: label, status: row?.status ?? 'ABSENT' });
    if (!row || row.status === 'DEPRECATED') continue;
    if (!['ACTIVE', 'DRAFT'].includes(row.status)) throw new FlowError(`${label} is ${row.status}; it cannot be deprecated`, 2);
    await submit(admin, { actionKey: 'capability_contract.deprecate',
      idempotencyKey: key('capability_contract.deprecate', catalog.tenantId, category, version, row.conformanceSuiteDigest, run),
      explicitConfirmation: true, capabilityContractRef: { categoryKey: category, contractVersion: version } }, `deprecate-${label}`);
    for (let i = 0; i < 40 && row?.status !== 'DEPRECATED'; i++) {
      await sleep(3000);
      row = await contract(admin, category, version);
    }
    if (row?.status !== 'DEPRECATED') throw new FlowError(`${label} still ${row?.status}; re-run the same command to keep waiting`, 3);
    log({ step: 'deprecated', contract: label });
  }
  log({ step: 'done' });
});
