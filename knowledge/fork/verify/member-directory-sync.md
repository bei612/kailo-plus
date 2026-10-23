# Kailo member directory sync (DD-133(4), source stage)

## Authority

- `.design/02` DD-133(4) and `.design/07` §4.7.4: the read contract and the
  WeKnora mapping table (design-authority `1bd1d4771326b64b79ecb2e99a8cf53738264fb0`).
- Wire contract: `contracts/api/component_member_directory.schema.json`
  (Core: `core/crates/platform-core/src/component_directory.rs`).
- Shared component rules (the same for Cells and Wren): binding id, own
  directory client, release-written credential file, Core service origin,
  interval 10–3600 s (default 60); any failed read changes nothing.

## Mapping implemented (07 §4.7.4 WeKnora table)

| Kailo | Native | Rule |
|---|---|---|
| Tenant | space `kailo_scope_ref = "tenant:<Tenant id>"` + organisation `kailo_tenant_ref = <Tenant id>` | Space and organisation names follow the directory `tenant.name`. Every member of the snapshot is a member of the space. |
| Workspace | space `kailo_scope_ref = "workspace:<id>"`, `editor` member of the Tenant organisation | Every Workspace in `workspaces[]` gets its space (also with no member yet). Names follow the snapshot. Spaces of vanished Workspaces are kept, but their members are removed. |
| Tenant `ADMIN` | `admin` of the Tenant space and of every Workspace space | Never `owner`, never system administrator. |
| Tenant `MEMBER` | `contributor` of the Tenant space and of their own Workspace spaces | A Workspace-level `ADMIN` does not raise the native role. |
| Not in the snapshot | — | Every mapped membership is removed (soft delete, audited as `kailo-org-sync`), and every native session of the person is revoked. The account and its knowledge stay. |

- **Pre-provisioning**: for every identity whose `issuer` equals the configured OIDC issuer and has no account yet, an account is created with the same shape as a first OIDC login:
  - no personal space, OIDC-only login, random unusable password;
  - username = Kailo display name, then `<name> (<8 hex>)`, then `kailo-<digest>`;
  - avatar = directory `picture`.
  The directory carries no email (07 §4.7.4), so the unique, required native email column gets the reserved placeholder `kailo-<32 hex of sha256(iss\0sub)>@directory.kailo.invalid` (RFC 2606). The first login replaces it with the OIDC email only if `email_verified=true` (07 §4.7.3).
- **Other issuers**: identities of other issuers are ignored. An identity reserved by a deleted account is skipped with a warning rather than blocking the snapshot.
- **Role changes**: a role change (for example a demotion) takes effect on the next request, because `middleware/auth.go::resolveTenantRole` reads `tenant_members` every time. Only removals revoke sessions, which is the design's "移出时撤销该人全部组件会话".

## Rules

- **Read** (`internal/application/service/kailo_directory_sync.go`):
  - Runs on start and every interval, one read at a time, from the dig-started `KailoDirectorySyncRunner`.
  - Token: `POST` to the token URL with `grant_type=client_credentials` and HTTP Basic auth. The secret file is read per request (≤4 KiB, so rotation needs no restart). No proxy, no redirects, 10 s timeout. Only `200` with a Bearer `access_token` is accepted.
  - Directory: `GET <core>/service/v1/component-directory/bindings/<binding>/members` with a Bearer token, no redirects, 30 s timeout, response ≤16 MiB.
  - Any of the following changes nothing and keeps the last applied state, logging a category only (never a token, credential or body):
    - a non-200 status (503, 401, 403, 404);
    - a transport failure;
    - a JSON or contract mismatch (strict parse, unknown fields refused: `types.ParseKailoMemberDirectory`);
    - another `bindingId`;
    - a `tenant.tenantId` other than `KAILO_TENANT_ID`.
- **Apply** (`kailo_directory.go::ApplyDirectory`):
  - An unchanged `directoryVersion` for the same binding is a no-op.
  - Otherwise every membership is reconciled under the projection's mutex, with idempotent per-person transactions shared with the login path (`syncLocked`).
  - The snapshot row (`kailo_member_directory`: versioned migration 000110 / sqlite 000029) is written only after everything succeeded. A failure leaves the old version, and the next interval redoes the whole snapshot.
- **Login** (`user.go::LoginWithOIDC`):
  - With the directory configured and a snapshot recorded for that binding, the membership comes from the snapshot.
  - An identity outside it is refused with `Success=false` and the fixed message, before any account is created.
  - With no directory configured, or none applied yet, the login keeps the previous behaviour (contributor, no administrator).
  - The recorded snapshot survives restarts.
- **Deployment**:
  - The native env keys `KNOWLEDGE_DIRECTORY_{BINDING_ID,CLIENT_ID,CLIENT_SECRET_FILE,TOKEN_URL,CORE_URL}` (plus the optional `_INTERVAL_SECONDS`) must be given together; anything else is refused by `start.sh`.
  - When they are present, `start.sh` overlays `compose.member-directory.yaml`:
    - app joins `KNOWLEDGE_ADAPTER_PLATFORM_NETWORK` (Core's service listener);
    - the credential is a compose secret at `/run/secrets/kailo_directory_client_secret`.
  - `native_entrypoint.py` validates the in-container `KAILO_DIRECTORY_*` group: binding UUID, dedicated client id, URLs, interval, and a private non-empty regular file. The credential never enters the environment.
  - The release writes the credential file (0600, owner uid 1000 = the image's `appuser`).

## Verification (CI node 10.203.193.2, ubuntu, containers, no sudo)

The script is `~/dirsync/knowledge-test.sh <sha> [pkgs] [run]`. It does the following:

1. Takes a `git archive` of the pushed commit.
2. Runs in the builder image of `docker/Dockerfile.app`, `golang@sha256:a688600c…`. Like the Dockerfile, it installs `libsqlite3-dev`, then runs as uid 1000.
3. Runs `gofmt -d` on the changed Go files.
4. Runs `go vet` and `go test -count=1` for `./internal/application/service ./internal/config ./internal/types ./internal/database ./internal/container`.
5. Runs `python3 -B -m unittest test_native_entrypoint` in the CI check image, with no network.

Raw results at `db11af23a757e282d820325e87ad1b832f8273c5`:

- gofmt: no diff. `go vet`: exit 0.
- `go test`:
  - `internal/config`, `internal/types`, `internal/database` (SQLite migration version 29 with the new table) and `internal/container`: `ok`.
  - `internal/application/service`: one failure, `TestQueryEmbeddingConsumesManagedKBScope` (`knowledgebase_search_fanout_test.go:888`, the model-delivery embedding call). Baseline (2026-10-23, CI node NVMe `~/scratch/dirsync-knowledge`, same golang image, ubuntu, no sudo): run alone it passes on main `04e4665e` and on this branch `afe2408d`; in the full-package run it fails identically on both (main: 2710 PASS + this one FAIL; branch: 2716 PASS + this one FAIL). It is a pre-existing order-dependent failure of main, not introduced by this branch.
  - Every Kailo test passes: the new `kailo_directory_test.go` and the existing `kailo_org_test.go`.
- Python: `Ran 40 tests … OK`. This includes the new directory-group entrypoint test and the `start.sh` overlay test.

New tests:

- `TestKailoDirectoryPreProvisionsMembersRolesAndWorkspaces`: pre-provisioning, other issuer ignored, Tenant admin is admin of every Workspace space, member/Workspace-ADMIN mapping, no owner or system admin, organisation spaces, recorded version, an unchanged version is not reapplied.
- `TestKailoDirectoryFailuresKeepTheAppliedState`: 503, 401, broken JSON, unknown field, other binding, other Tenant, missing fields and a refused token all leave the version and roles unchanged.
- `TestKailoDirectoryRemovesDemotesAndRenames`: removal revokes sessions and keeps the account; demotion; Workspace rename.
- `TestKailoLoginFollowsTheAppliedDirectory`:
  - before delivery, the login is a contributor;
  - the first snapshot removes an earlier login that is not in it;
  - the admin keeps the role across logins, and the verified email replaces the placeholder;
  - a non-member is refused and no account is created;
  - a restarted projection follows the recorded snapshot;
  - a snapshot of another binding is ignored.
- `TestParseKailoMemberDirectoryIsStrict`, `TestKailoDirectoryDisabledRunnerDoesNothing`, `internal/config` `TestKailoDirectoryEnvIsOneGroup` / `TestKailoDirectoryUnsetIsNotDelivered`.

## Not accepted yet

None of the following has been done:

- image build;
- deployment;
- a real IdP directory client;
- a binding re-registered with `--directory-client-id`;
- a live Core read;
- three-person business acceptance (admin → native admin, removal → sessions gone).

Postgres migration 000110 has not been run against a real database in this batch.

## Production defect: pre-provisioning wrote tenant_id 0 (2026-10-23)

Deployed at `6c63b717` (binding `9830dc36-3ae2-5fa8-9054-f69f66029e03`,
`--directory-client-id kailo-knowledge-directory`): every directory read
succeeded, but every apply failed with
`pre-provision directory account: ... violates foreign key constraint "fk_users_tenant" (SQLSTATE 23503)`.
`directoryUser` inserted the new account with `db.Create`, so GORM wrote the
`uint64` zero into `users.tenant_id`; `repository.CreateUser` (the first-login
path) omits the column for exactly this reason. Because the snapshot is applied
whole, no member, role or Workspace space was reconciled while any directory
member had no WeKnora account yet. The fixture's SQLite does not enforce the
foreign key, so the existing tests passed.

Fix: insert with `Omit("tenant_id")` (SQL NULL), as the repository does;
`syncLocked` then sets the home space. New test
`TestKailoDirectoryPreProvisionInsertsNoZeroTenant` records the user inserts
and refuses any that writes `tenant_id`. Image build, deployment and the live
re-check are not part of this change.
