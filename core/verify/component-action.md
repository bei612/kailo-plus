# HUMAN component action implementation evidence

This implementation follows DD-90 and the existing APPLICATION action contract,
including design commit `f41205728d0cb9826aca2aacc2169fa9eb15b189` and its
same-semantics kind-table completion `57424a0f5aaf87f289ff1cba529915366b644bd9`.
`COMPONENT_ACTION` is a case of the original `ComponentTaskWorkflow`, not another
workflow engine or a component-specific workflow kind. Same-request SYNC actions
without native execution history are not relabelled by this change.

## Implemented caller and boundaries

1. The existing shared Tasks page mounts `ComponentActionsPanel`. It submits an
   original `ActionCommand` through the normal BFF session. The reviewed document
   contains the exact versioned target, capability action and durable native
   `ContentReference`; it does not carry SQL, results or native credentials.
2. `governance_api::submit_action` and `application_action::submit` consume that
   command. They use the original tenant/actor/scope guards, exact approved
   APPLICATION definition, fresh authorization, approval and quota. Existing AE
   idempotency owns the operation. A mismatched receipt cannot unlock the UI's
   frozen original request after an UNKNOWN response.
3. The original ComponentTask calls `AdvanceComponentAction`. Core locks the
   original AE, freezes the EE and actual usage projection in one transaction,
   rechecks approval and authorization, then commits UNKNOWN before the native
   request. Existing EE means observe only: neither a lost ACK nor a restarted
   Workflow causes another execute. Cancellation before dispatch is serialized
   with that same AE; a dispatched native query is observed rather than treated
   as cancelled merely because a cancellation was requested.
4. The native Wren reference caller uses its original View, Project, DeployLog,
   QueryService and ApiHistory. A Human ticket binds the original EE and key.
   View revision, deployment or account changes are rejected before query
   execution. A positively identified pre-query refusal is recorded in original
   native history so the original EE can reconcile it; absent history or an
   uncertain query exception is not invented terminal evidence. Core settles
   only through the original native observation, usage and audit consumers.

The independent native browser session is not a Kailo BFF session. Its original
query UI remains native; it can export a reference to an existing view for the
separate Kailo action caller. This does not forward a native browser JWT to Core,
replace the native UI, or make native management APIs platform actions.

Native source remains Wren GenBI commit
`c5f02a0391c87420dba78632dcd86073710deb72`:
`/volumes/kailo/.references/WrenAI-ui-0.32.2/wren-ui/src/apollo/server/services/queryService.ts::QueryService.preview`
and `/volumes/kailo/.references/WrenAI-ui-0.32.2/wren-ui/src/apollo/server/repositories/apiHistoryRepository.ts::ApiHistoryRepository`.
The implementation extends those existing native consumers; it neither executes
the reference checkout nor substitutes the separate Python Wren v2 product.

## Reproduction and current evidence

Private implementation baseline is tree
`7a5c2ca90efc1e347455f4cc2e50035eaba7a282` (the reviewed HB input plus the
previously delivered Wren lifecycle dependency). Only this new delta is owned
by the present slice. Logs are retained under
`/volumes/data/kailo/tmp/codex-human-component-action-20261005.gEJTdj/`.

Validation uses the existing fixed `10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`
SDK, 4 CPU/8 GiB, UID 1000, Data caches and `CARGO_BUILD_JOBS=16`. Native Wren
uses the previously retained 4 CPU/4 GiB SDK and isolated native PostgreSQL.
No host toolchain or reference-tree execution is involved.

- Original contract generation completed with exit 0 (`gen-restored.log`).
  Earlier Dart writable-directory failures remain in `gen.log` and `gen-2.log`.
- `cargo check -p platform-core --all-targets` completed with exit 0
  (`core-third.log`). Earlier sparse input omissions remain recorded; the
  original collaboration and Gateway proto inputs were restored, not replaced.
- Migration `20261005020000` completed original up/down/up with exit 0
  (`migrations-final.log` and `migration-session-union.log`). The latter preserves
  the original system-only `PROTOCOL_SESSION_RECONCILE` workflow-ref kind, not a
  business ActionDefinition kind. The earlier PL/pgSQL expression error remains in
  `migrations-restored.log`; no migration checksum was edited to bypass it.
- With an isolated database migrated from the candidate and seeded through
  `core/verify/application-execution-base.sql`, run
  `APPLICATION_EXECUTION_TEST_DATABASE_URL=<isolated-db> cargo test -p platform-core --bin platform-core human_component -- --include-ignored --nocapture`.
  The actual catalog registration/facts and same-target reference cases passed
  2/2 (`core-db-clippy.log`). The test uses the committed original dispatch
  fixture inside a rollback transaction; it does not disable database guards.
- Original Go activity/workflow targets passed (`worker-handler.log`): the HTTP
  consumer rejects wrong AE, unknown state, extra response fields and dependency
  failure; the Workflow keeps the original key through lost ACK/mismatched
  receipts and cancellation until an authoritative receipt is available.
- The first Clippy run rejected an eight-argument function and a large tuple.
  Reusing the original `Target` value and a local named normalized command fixed
  those two diagnostics without suppressions. `core-restored.log` then completed
  the two real Core targets and `cargo clippy -p platform-core --all-targets -- -D warnings`,
  exit 0. The final source includes the native PEP's fresh consumed-approval check.
- Shared UI typechecking passed. Its first Vitest process timed out while
  starting a worker, before executing any case (`ui-restored-targeted.log`), so
  that output is not UI acceptance. The unchanged original
  `npm run typecheck && npm test -- test/component-actions.test.tsx` subsequently
  passed 5/5 (`ui-consumer-final.log`), including test TypeScript checking.
- Removing the actual Workflow AE-match guard made the lost-ACK consumer fail
  with two calls/one UNKNOWN instead of three calls/two UNKNOWN, exit 1
  (`worker-mutation-2.log`). After byte-for-byte source restoration, both original
  activity/workflow targets passed (`worker-restored.log`). The first mutation
  command lacked the existing Go-cache environment and did not execute tests;
  `worker-mutation.log` is retained and is not counted as a valid counterexample.
- Removing the actual UI operation-match guard unlocked the frozen UNKNOWN
  intent on another operation's denial: one original DOM case failed, exit 1
  (`ui-mutation.log`). After byte-for-byte restoration, the same typecheck/test
  command passed 5/5 again (`ui-restored.log`).
- Replacing only the isolated database's declaration function by the original
  pre-COMPONENT_ACTION guard made the actual catalog consumer fail with SQLSTATE
  23514, exit 101 (`core-guard-mutation.log`). Restoring the exact new migration
  function returned the original two tests to exit 0 (`core-guard-restored.log`).
  No migration checksum, source guard or business database was bypassed.
- The actual native HUMAN handler targets passed typechecking and 4/4 cases
  (`wren-human-final.log`, exit 0). The original nine unrelated cases are
  explicitly excluded by `-t HUMAN`, not counted as passing in that command.
  Removing the real HUMAN idempotency-key guard in the execution copy made the
  wrong-key HTTP request return 200 instead of 403 (`wren-human-mutation.log`,
  exit 1). Production and test sources were restored byte for byte. The final
  typecheck passed and that same execution/key case passed again, as did the
  connection/deployment refusal cases, but the view-refusal case exceeded its
  unchanged five-second timeout (`wren-human-restored.log`, exit 1; 3 passed,
  1 timed out). Therefore a final all-four restored exit 0 is still outstanding;
  no further retry was started under the observed I/O pressure.
  Earlier native failures remain in `wren-final.log`
  (test union-type access), `wren-final-2.log` (an original binding-case timeout
  and a Date-versus-string assertion), and `wren-final-3.log` (the enlarged
  HUMAN case exceeded its unchanged default timeout). The reference, connection
  and deployment refusal cases are now independent actual-handler cases, each
  retaining the original timeout, zero-query assertion and native observation.
  Original fixture seeding now restores its fixed isolated project/deployment
  values on conflict, avoiding interrupted-run state leaking into the next run.
  No production deadline was relaxed and no failing HUMAN case was skipped.
  The original registry generation exposed the design
  table's missing `kind=COMPONENT_ACTION` entry despite its explicit definition;
  `registry.log` retains that refusal. After the isolated, reviewed one-line
  design correction, original generation/check passed (21 capabilities, 19
  kinds). No gate was weakened. Original `check-docs.sh` then passed with the
  complete original linked inputs and markdownlint configuration present
  (`design-kind-docs-restored.log`); the earlier sparse-input failure is retained.

No full check, product build, commit, push, deployment, model call or real
datasource write was performed by this implementation slice. Real approved
release/binding/resource/policy facts and a live HUMAN Task/native usage end to
end remain separate acceptance requirements; fixture success cannot activate
an unverified binding.

## Native saved-view HUMAN admission, 2026-10-07

This incremental slice uses `edac76e72bc8c1283ea85640d1c00112b44a1c1e` as its
code base. It implements the existing SS-WRN-IDENTITY/SS-WRN-GOVERNANCE and
DD-12 dedicated-instance boundary; it does not introduce component users,
permissions, approvals, metering or a second action executor.

Four-step impact record:

1. The controlled ApplicationAdapterDirectory now optionally delivers
   `nativeHumanIdentities`, each fenced by binding ID, config digest and active
   projection generation, referencing an existing IdentityProvider. Its audience,
   public JWKS file and instance entitlement are operator facts, never request
   arguments. Issuer comes from the ACTIVE provider. SERVICE transport and the
   native HUMAN JWT must both validate independently.
2. `application_native_human::handle` maps the signed subject through the existing
   ExternalIdentity/HumanIdentity and exact binding-Tenant membership. It does
   not use or change the default-Tenant resolver and does not invent a
   PlatformSession. BFF and native requests share the refactored
   `application_action::submit_inner`, including its ActionDefinition, Resource,
   ResultExposurePolicy, approval, quota, AE/audit and ComponentTaskWorkflow.
   The new route is SERVICE transport, not a new browser endpoint. Four generated
   languages preserve the optional directory field and reference-only request
   and result contracts; old directories remain readable but cannot enable this
   native HUMAN path without explicit trust delivery. No migration is required.
3. Browser refresh reuses an opaque idempotency key. Native retries first observe
   the same HUMAN AE, do not refreeze an already accepted view or rerun SQL, and
   do not convert denial of observation into evidence of a failed side effect.
   The original tenant admission lock fences a concurrent different HUMAN using
   that key. No SQL, token, cookie or result body is added to Core, history or
   business contracts. Only the original reconciled terminal audit can produce
   terminalStatus; HTTP acceptance and DISPATCHED remain nonterminal.
4. Missing/duplicate headers, unknown provider/subject, foreign Tenant, revoked
   membership, disabled identity/Principal/provider, paused Tenant, wrong
   audience/issuer/instance, expired/future token and binding-generation drift
   fail closed. Rechecks occur before response disclosure. Wren also re-admits
   after reading its own matching native history. Unknown completion retains the
   original key; changing a view cannot replace its immutable reference.

Actual narrow evidence, not deployment acceptance:

- Original `tools/gen.sh` exited 0 in existing `kailo-agent-receipt-xvkujx`
  (4 CPU/8 GiB). New Rust/TypeScript/Go/Dart roundtrip each passed, including
  absence of terminal status in a merely dispatched receipt.
- Core native HUMAN tests: 3 passed, including a real transaction in the existing
  isolated test database, rolled back. One subject had two active Tenant
  memberships; exact binding Tenant selected the right HUMAN Principal, and
  each identity/membership/Tenant revocation was rejected. This is not a live
  datasource or approval/usage E2E. The earlier common-action unit run was
  4 passed/1 explicitly ignored original fixture-dependent case.
- `cargo clippy --offline --locked -j16 -p platform-core --bin platform-core --
  -D warnings` exited 0. Original failures remain: stale SDK Buzz input caused
  E0432; synchronizing the exact base and refreshing its source mtime corrected
  it. The initial new connection borrow produced E0308; using the actual acquired
  connection fixed that source error without relaxing checks.
- SDK-only removal of the instance entitlement guard caused the real JWT test
  to fail on `missing instance` (0 passed/1 failed, exit 101); the production
  file was restored byte-for-byte (cmp 0). Final targeted rerun passed all 3
  native HUMAN tests, including the rolled-back `component_runtime_lcivus`
  transaction, and clippy again exited 0.

Logs are under
`/volumes/data/kailo/tmp/gateway-locale-repair-20261007.iwRGvX/`:
`native-human-gen.log`, `native-human-core-initial.log`,
`native-human-core-restored.log`, `native-human-core-synchronized.log`,
`native-human-core-final.log`, `native-human-core-sql-restored.log`,
`native-human-roundtrips.log`, `native-human-core-mutation.log` and
`native-human-core-mutation-restored.log`. No full/build/deployment, real
resource mutation, quota top-up or native query replay was performed.
