# Complete native GenBI integration

## Authority and impact

DD-12 and SS-WRN-IDENTITY / SS-WRN-GOVERNANCE use Wren GenBI
`c5f02a0391c87420dba78632dcd86073710deb72`, not the Python v2 backend.
The complete native tree is preserved, including the engine submodule source at
`47ca29ebba291100ba5d70ce1790f9887eaed7a0`. No original UI feature, database,
query engine or native task system is replaced by a Core implementation.

The first native change addresses the credential sink used by authentication:
`wren-ui/src/apollo/server/repositories/apiHistoryRepository.ts::ApiHistoryRepository`.
The original REST handlers, common response helpers and streaming handlers all
write request headers through this repository. Both create and update use the
same serialization boundary; reads feed the original API history drawer.

The repository now stores only Content-Type and Accept request metadata. It
does not use a credential-header denylist, does not mutate the live request,
and does not log malformed historical header JSON. Existing query, response,
project, duration and status data remain native. Unknown names, arrays, null
and malformed stored values cannot expose cookies, authorization tokens or
provider-specific credentials. No Core schema, platform authority, shared
client interface or workflow changes are introduced by this native change.

This candidate has never been deployed and has no existing native database.
Read filtering is not a credential-erasure migration for an imported database;
such a database cannot be reused as a verified release without separately
removing retained credentials and rotating exposed values.

## Native authentication change

The original Next request entry now verifies a component-specific JWT with the
existing locked JOSE library (4.15.5, promoted to a direct runtime dependency).
It does not implement OIDC login: the existing AgentGateway OIDC policy handles
the native service's dedicated client, and forwards its signed token only on
the server-to-server hop. The Wren backend verifies issuer, audience, subject,
expiry, signature and an explicit signed native instance entitlement. A valid
platform token or a token without that entitlement does not grant native access.
Identity is issuer/subject; email is neither required nor used for merging.

`WREN_NATIVE_IDENTITY_JSON` is server-only runtime configuration with required
`issuer`, `audience`, `jwksUrl`, `accessClaim`, `accessValue`, and `publicOrigin`.
The issuer's component client supplies the dedicated access claim. Its exact
value identifies access to this independently managed, dedicated native instance
and its current project, not a Kailo Tenant role or platform-admin grant. The
claim may be an exact string or a string array containing that exact value;
registered identity claims cannot be reused as the entitlement. No users are
automatically provisioned or assigned platform permissions by this middleware.

The policy covers original pages, GraphQL, REST, SSE, Next data and static
requests; there is no anonymous route exception or configuration fallback.
Mutation methods also require the configured native public Origin, including
server callers (Origin is a CSRF check, never an authentication substitute).
Incoming Authorization and Cookie headers are removed before native handlers;
the original API-history repository independently prevents credential retention.
Protected responses are not publicly cacheable. A failed authentication returns
401, missing instance access or bad Origin returns 403 (`DENIED`); missing or
invalid configuration and unavailable verification keys return 503
(`PRECONDITION`). These failures precede native dispatch and never invent a
business terminal result. Native in-flight tasks retain their original result
authority; public-service cancellation, quota, approval and reconciliation remain
the existing platform contracts, not JWT claims.

The native Compose input now requires a source-built UI image and identity
configuration; it cannot silently select the unmodified upstream UI image.
The AI service no longer publishes a host port around the authenticated native
UI. Engine, Ibis and AI service remain on the component's own native network.
No running service or actual deployment configuration was changed by this edit.

This is token-validity and dedicated-instance admission, not a claim of
instantaneous native session revocation. Expiry and the gateway's session policy
still bound native session validity. An active stream/task is not cancelled by
removing a frame. Public platform calls must perform their existing fresh
authorization independently. The complete native backend remains independently
managed; the platform does not acquire its database or business content.

## Delivery boundary

No image digest or ComponentRelease approval is asserted. Native authentication
has source changes but still requires runtime gateway/issuer wiring and actual
acceptance; public-service execution still requires its source adaptation and
acceptance. The source manifest records seams to
be reviewed, not completed certification. This candidate is not an enabled
binding, an original-image deployment, or proof that three external services
are integrated.

## Actual source verification (2026-10-05)

Against the pinned GenBI source above, seven native paths changed by +430/-4:
five production/configuration/dependency paths +168/-4 and two assertions files
+262/-0. This excludes the complete upstream import and expanded Engine tree;
those original files are not counted as newly implemented Kailo features.

Checks ran in image
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`,
Node 24.21.0, user 1000, actual 4 CPU / 4 GiB / no extra swap, with source and
caches under the project Data directory. Original Yarn 4.5.3 immutable install
completed with its existing peer warnings after disk-writeback waiting. Adding
the already locked JOSE version as a direct dependency used the original Yarn
resolver offline; the resulting lockfile differs by +2/-1, not a package upgrade.

After implementation, the original Jest entry ran the two native files:

```text
Test Suites: 2 passed, 2 total
Tests:       40 passed, 40 total
exit: 0
```

JWT checks use real asymmetric signatures and a real local JWKS HTTP endpoint,
not a mocked verifier. They reject absent/expired/forged credentials, wrong
issuer/audience, missing subject/expiry, missing or wrong instance entitlement,
untrusted write Origin, invalid configuration and unavailable keys. API-history
checks call the real repository create/read methods with a Knex boundary mock;
they do not claim a live database migration or full native UI acceptance.

Removing the actual instance-access guard and metadata-only header filter
caused eight assertions to fail, with exit 1 (five unauthorized requests
incorrectly returned 200; three history assertions exposed synthetic credentials).
Both production changes were restored exactly; the same 40 assertions passed
again. Original `tsc --noEmit` exited 0, and original Next lint on the four changed
TypeScript files reported `No ESLint warnings or errors`, exit 0.

Raw receipts under `codex-wren-genbi-native-20261005.vUC6UO`:

| Receipt | SHA-256 |
|---|---|
| native-identity-dependency.log | `9e285f0053e7134f1a4faad2d39306b5884e193c6fce729403ea6d927dc15baf` |
| native-identity-tests-first.log | `03da846679a9c687e0aca09215e7da426cb2b8bab7341d0814137fc90241cf53` |
| native-identity-tests-mutation.log | `0be0dabaaffd348fe81881e1dd52c02783d2891046747dc56ca76bf69f5d12bd` |
| native-identity-tests-restored.log | `47e4c1ac32701c6df9f80319cc2d071466ae068bce407596a9f335cc57ef6b4c` |
| native-identity-types.log (empty successful output) | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| native-identity-lint.log | `03a52e2742a512fd0d6e3602e84627a5c8ad163a72c8b18fe33f29b055c62b89` |

No full platform check, native release image, production-Node execution,
Gateway browser login, component deployment or ComponentRelease approval is
claimed by these narrow source results. Next's actual production routing and
issuer delivery still need their release-level verification.

## Source delivery into the implementation workspace

The complete frozen candidate has now been imported into `apps/data-query/`,
including native UI, AI service, launcher, MDL and the pinned Engine source.
The import contains 1736 source paths, excluding installed dependencies,
compiler caches and runtime configuration. Four files ignored by the parent
repository are unchanged upstream development examples; each was compared
byte-for-byte with the fixed upstream commit before including it. They are not
deployment credentials. The original `upstream_manifest.py diff data-query
--check` reports zero undeclared source removals, exit 0.

This import implements ADR-15/16 source ownership only. It changes no running
service, native database, account, platform permission or binding. Git commit,
push, release image and business acceptance remain distinct delivery results;
none is inferred from these source files being present.

The registered native UI Dockerfile now fixes its original Node 18 Bookworm
base to registry index
`sha256:f9ab18e354e6855ae56ef2b290dd225c1e51a564f87584b9bd21dd651838830e`.
The original `docker buildx imagetools inspect node:18-bookworm-slim` returned
that digest with exit 0; no image was built or deployed. This is ADR-06/16
input pinning, not a toolchain upgrade. The upstream recipe still installs
`sharp` outside the committed lock; therefore no reproducible release-image
claim is made by this source import.

## Locked image dependency preparation (2026-10-05)

The original Dockerfile performed `yarn add sharp` after its immutable install.
That changed dependencies during image construction and bypassed the committed
lock. This preparation moves `sharp` into the original runtime dependencies at
exact version `0.34.5` and removes only that build-time add command. Original
Yarn 4.5.3 generated the lock mechanically: +337 lines, no existing resolution
removed or upgraded. Native image processing remains present. The upstream
[Sharp 0.34.5 package](https://github.com/lovell/sharp/blob/v0.34.5/package.json)
declares support for Node 18.17 and later within its stated engine ranges;
the Dockerfile's fixed Node 18 Bookworm digest is unchanged.

The private source was exported from assembly tree
`bdffa14ba82eb1c3f4eff07fd2295ad9220e1839`, only tracked `data-query` files.
No installed dependencies, private environment or runtime credentials were
imported. The native identity and API-history source is unchanged.

Original Yarn lock resolution exited 0 in the existing limited SDK (4 CPU,
4 GiB, equal memory-plus-swap limit, UID 1000, Data cache). The SDK is Node
24.21.0, not the image's Node 18. An attempted complete immutable install
exited 1: old DuckDB 0.10.1 had no Node ABI 137 prebuilt binary and its fallback
compile failed. The remaining unrelated old native dependency builds were
stopped; their exit 129 is retained. This is not a successful production-image
dependency installation.

The narrower original `yarn install --immutable --mode=skip-build` then exited
0 with network disabled. This mode is used only for lock verification in the
SDK: the product Dockerfile retains full `yarn install --immutable`, without
skipping scripts. Removing the actual sharp declaration in the execution copy
made the same immutable check fail with `YN0028`, exit 1. The declaration was
restored exactly, and the same immutable lock verification again exited 0.
A real Sharp call encoded and resized a PNG to 1 by 1 pixels
using Sharp 0.34.5 / libvips 8.17.3, exit 0; it is SDK-level image-processing
evidence, not a Node 18 image or browser acceptance result.

Raw logs and exits are retained under
`codex-wren-locked-image-20261005.yOqws2`: `lock.log`, `immutable.log`,
`duckdb-sdk.log`, `immutable-lock.log`, `lock-mutation.log`, `lock-restored.log`
and `sharp-smoke.log`. No product image was built, no service was deployed,
and no release digest, full reproducibility or completed native governance
integration is asserted. OS package resolution and the original complete
Node 18 image build still require their actual release execution.
