# Cells: Kailo authorization projection (DD-164)

Design: `.design` 69fb480e as amended at 1c803580 (coordinator ruling
2026-10-30: never delete user data, plain members must not regress) — DD-164 (1)(3)(4)(9), `07` §4.7.2 `share`,
§4.7.4 schema 2, 分享意图, 收敛回执, 撤员时的原生令牌, Cells mapping table and
"schema 2 角色派生"; V-SCN-205, V-SCN-273, V-SCN-274, V-SCN-276, V-SCN-277.

## What the instance does

| Kailo fact (directory schema 2) | Native projection | Code |
|---|---|---|
| `members[].tenantRole` | ADMIN → profile admin, else standard (unchanged) | `common/auth/native-oidc-directory.go` |
| `members[].workspaces[].create` | `kailo-ws-<id>` role (read+write ACL on the Workspace root) when true, `kailo-wsr-<id>` role (read ACL only) when false; both roles see the workspace | `ensureNativeOIDCWorkspace`, `membership` |
| TENANT `WRITE` (1c803580) | Tenant group role read+write on the shared folder | `nativeOIDCShareRoles` |
| `shares[]` (`folder`) | ROOM workspace `kailo-share-<resourceId>` (UUID derived from the slug) rooted on `uuid:<nativeId>`; READ → read ACL, WRITE → read+write ACL, for the member account role(s), both Workspace roles, or the Tenant group role; visible (READ policy) to exactly those roles; removed when the Resource leaves the snapshot | `common/auth/native-oidc-shares.go` |
| share whose folder does not exist natively | skipped, reported as receipt failure `SHARE/<resourceId>/NATIVE_OBJECT_MISSING`; the same version is applied again next period until it converges | `convergeNativeOIDCShares`, `SyncNativeOIDCDirectory` |
| member removed from the snapshot | lock + end native sessions (existing) + revoke every PAT of the login (personal and document) | `NativeOIDCRevokeAccountTokens` |
| `displayName`, identity `picture` | account display name and avatar; a later login keeps them (IdP `name` only before a directory exists) | `syncNativeOIDCUser` (existing behaviour, asserted by the tests) |

Owner semantics (DD-164(3), 1c803580): Cells has no node owner metadata.
The creator of a folder or file strictly below a Kailo Workspace root is
recorded at creation (`frontend/web/service/kailo-owner.go` follows the native
tree `CREATE` events and their acting user) as a read+write node ACL of the
creator's own account role, with no workspace id
(`auth.RecordNativeOIDCOwner`). Cells resolves the deepest node holding a mask
first, so the creator keeps editing, deleting and sharing that node and its
subtree with the read-only `kailo-wsr-<id>` role; the record is a node mask,
not a second workspace root, and no other account gains anything
(`TestNativeOIDCOwnerNodeMask`). The share-intent endpoint therefore accepts
the owner (the node is no longer read-only for it). Only Kailo accounts are
recorded; content created before the recorder ran has no record (with the
default Tenant policy `MEMBERS_CREATE` those members hold the read+write
Workspace role anyway).

Adoption (DD-164(4)⑧, 1c803580): before `shares[]` converge, every native Cell
(ROOM workspace other than `kailo-share-*`) rooted on one existing folder whose
owner (OWNER policy) and every grantee role map to Kailo — a member account
(PRINCIPAL), `kailo-ws-<id>`/`kailo-wsr-<id>` (WORKSPACE), the Tenant group role
(TENANT) — is posted to `POST .../share-adoptions` (read → READ, read+write →
WRITE, the owner implicit, Workspace from the folder path). An `adopted` answer
is read back against the request (owner principal and grant set). A 4xx is a
definite refusal (`ADOPTION_REFUSED`, Cell kept); transport/5xx/contract errors
are `ADOPTION_PENDING`: then `shares[]` do not converge and nothing native or
Kailo-managed is removed, and the same version is applied again next period.
Adoptions are persisted with the applied snapshot (`adopted`, Cell → Resource).
A Cell retires (its ACLs and workspace; never the folder or files) only when
its Resource is in the current snapshot, `kailo-share-<resource>` converged in
this run and its ACLs cover every native ACL of the Cell; otherwise
`NATIVE_SHARE_NOT_RETIRED` (Cell kept — e.g. when the owner narrowed the grants
in Kailo, an operator decides). Cells that cannot be mapped (other roles,
non-Kailo accounts, several roots, other ACL actions) report
`NATIVE_SHARE_UNMAPPABLE`/`NATIVE_OWNER_UNMAPPABLE`, public links
`NATIVE_LINK_UNMAPPABLE`; both stay untouched.

Why two Workspace roles: a Cells ACL belongs to a role; giving members of one
workspace different rights needs either per-account ACLs on the root or one
role per right. Two roles keep the workspace's ACL set constant (no ACL churn
when a person gains or loses `create`) and change only the person's role list.

Receipts: after every apply (`APPLIED`, with failure items) or failed apply
(`FAILED`, one `TENANT` item `TENANT_MISMATCH` or `APPLY_FAILED`, never the
error text) the instance `PUT`s `/service/v1/component-directory/bindings/<binding>/receipt`
with the directory client token. An undelivered receipt is kept in memory and
retried at the next period; it never blocks or changes the sync.

Share entry: in Kailo mode `KailoCells.kailoShare(node)` replaces the native
share dialog (header action, context menu `share` callback). It posts
`{"nodeUuid"}` to `POST /auth/kailo/share-intent` with the user's Cells token;
the server reads the node through the user's own UUID router and accepts only
a folder the user can read and write (no readonly/write-only flag), derives
the Kailo Workspace from a `kailo-ws-<id>` appearance, and asks Core
`POST .../share-intents` with the directory client. The returned `intentId` is
handed to `KailoEmbed.requestShare` (client-kit runtime). The native endpoints
`PUT /a/share/cell`, `PUT /a/share/link`, `PUT /a/share/policies` and deleting
a `kailo-share-*` Cell answer 403 in Kailo mode for users (governed adapter
writers with a native proof keep their admitted path).

People search (V-SCN-205): Kailo Tenant admins have the native admin profile
but are Kailo accounts; `NativeOIDCPeopleScope` now narrows every caller that
is in the Tenant group, carries the Kailo identity link or is an explicitly
linked connector account (unknown → narrowed). Only local operator admins are
not narrowed. Production evidence of the defect: kailo-qa-1 (Tenant ADMIN)
listed 11 users including `kailo-platform-admin`.

## Deployment order

The instance reads `?schema=2` only and does not fall back to schema 1: Core
with member directory schema 2, share intents and receipts must be deployed
before this image.

## Verification

Run on the CI node from GitHub branch `feat/authz-cells` (golang image
`sha256:8ac98ca5…`, CGO off; vitest 4 + jsdom 24 in `node:22-alpine`); results
are recorded in the coordinator report for the tested commit.

- `common/auth`: `TestNativeOIDCMemberDirectory` (schema 2 read, read-only
  role, shares create/revoke/remove, missing folder failure and re-apply,
  receipts incl. retry after a refused delivery, PAT revocation of removed
  members, share intent request), `TestParseNativeOIDCDirectory` (schema 2
  strictness), `TestNativeOIDCPeopleScope` (Kailo admin narrowed).
- `common/auth` (1c803580 amendment): `TestNativeOIDCOwnerNodeMask`; subtests
  `schema2-adoption` (pending adoption keeps everything, retry, request
  mapping, retirement only when covered, unmappable Cell and link kept,
  TENANT WRITE) and `owner-record`.
- `frontend/web/service`: `TestKailoOwnerCreation`.
- `idm/share/rest`: `TestKailoModeRefusesNativeSharing`.
- `frontend/assets/kailo.embed/kailo-cells.test.js`: "Kailo share action (DD-164(4))".
