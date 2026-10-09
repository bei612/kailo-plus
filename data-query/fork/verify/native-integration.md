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

## Native browser session consumer (2026-10-05)

DD-87/DD-93 and SS-WRN-IDENTITY require an independently authenticated native
service, not a platform administrative token or an iframe-only access path.
The prior Compose published the Bearer-only Next backend directly. Its JOSE
middleware could reject requests correctly but no browser login consumer could
establish that credential. This change makes the original AgentGateway OIDC
policy the native public entry, using a dedicated client, cookie key and
read-only configuration. The original complete UI and Next middleware remain
unchanged. The backend has no public host port. Core's dynamic Tool/ModelRoute
projections do not own this separate native Gateway configuration.

The fixed AgentGateway source is
`1f7ebbf87cbdbe9517f6f181221879d04dc50692`:
`crates/agentgateway/src/http/oidc/mod.rs::OidcPolicy::apply` validates the
native browser session; `crates/agentgateway/src/http/auth/mod.rs::apply_backend_auth_kind`
forwards only its verified `Claims.jwt`; and
`crates/agentgateway/src/http/oidc/browser.rs::OidcPolicy::handle_logout`
requires a same-origin POST. Browser Authorization, Cookie and platform identity
headers are removed before restoring that verified component token. The
existing `wren-ui/src/middleware.ts::middleware` independently checks issuer,
audience, subject and signed instance grant, then strips credentials before
native handlers. Its write-origin rejection is unchanged.

New listener/admin ports are explicit deployment inputs. Private UI port 3000
comes from the original `wren-ui/Dockerfile` `PORT`/`EXPOSE` declarations.
The original Gateway requires a dedicated 32-byte hex `OIDC_COOKIE_SECRET` in
addition to its client secret. Both belong in the component's controlled
secret-delivery file, never in source, client bundles, platform configuration
reuse or rendered/logged Compose output. Missing keys fail startup.

Post-implementation verification runs the original Jest entry with
`WREN_TEST_GATEWAY_BINARY` pointing at an already-built, pinned Gateway binary:

```sh
node node_modules/jest/bin/jest.js --runInBand \
  src/nativeBrowserSession.test.ts src/middleware.test.ts
```

The binary was copied read-only from the existing source-built image with
RepoDigest `sha256:b7e3d559ffd7840d73e278de656879ebe12e925b3766536f9e9952d1fd7a4fff`;
binary SHA-256 is `f2009b6f653495646202a015dd48ca55acd7496a5ba927c84ec0e229daf7c439`.
No reference checkout was executed. The existing SDK has 4 CPU, 4 GiB and no
additional swap, UID 1000; tests use isolated loopback listeners, ephemeral
test keys and the actual production YAML. The local protocol issuer exercises
authorization code, PKCE, nonce, native audience and instance-grant rejection.
Cookie-only page/API/asset requests invoke the real Next middleware. A supplied
attacker Bearer cannot replace the verified identity; logout and post-logout
fetch rejection are checked. This is HTTP browser-protocol evidence, not a
Chromium DOM, real organizational IdP or production Node 18 image acceptance.

The first two runs exited 1 during Gateway startup/readiness; the actual
missing cookie-key input was corrected, not bypassed. The third exited 1
because Node fetch overwrote the fixture's navigation header with `cors`.
A direct readback confirmed that header; the fixture now uses original Node
HTTP requests to represent navigation without relaxing the production fetch
rejection. `browser-targeted-4.log` then recorded 37 passed, exit 0 (34 existing
middleware cases and 3 native session cases). Removing production backendAuth
only in the execution copy caused two actual failures, exit 1: authenticated
requests reached the backend without the verified native token. The production
YAML was restored byte-for-byte before the final same-target run.
`browser-restored.log` records all 37 passed again, actual exit 0.

Raw logs and exits are retained under `codex-wren-browser-20261005.vK7Equ`.
Normal unit runs without the explicit binary skip these three integration
cases and cannot be cited as their acceptance. No product image, deployment,
real account/grant change, model call or full platform check was performed.
NativePage uses the same origin and login chain; IdP frame policy and Lax-cookie
restrictions can still require opening the independent native address. Neither
embedded UI compatibility nor SS-WRN-GOVERNANCE's native query/workflow/approval
integration is declared complete by this authentication slice.

### Native browser CSRF correction (2026-10-05)

Cookie-authenticated writes now use the original AgentGateway CSRF policy on
the native UI catch-all route. Fixed revision
`1f7ebbf87cbdbe9517f6f181221879d04dc50692`,
`crates/agentgateway/src/http/csrf.rs::Csrf::apply` accepts safe methods,
checks Fetch Metadata for writes, then uses the request URI origin when
Fetch Metadata is absent. `additionalOrigins` remains empty: a same-site
sibling is not a trusted origin. No second Next CSRF implementation was added.
The pinned listener policy schema does not accept `csrf`; the actual failed
startup was retained, then the same original policy was placed on the route.
OIDC GET/callback and the original logout same-origin check are preserved.

The existing bounded SDK and original Jest consumers were reused, with the
same already-built Gateway binary and production YAML. Exact command:

```sh
sudo -n -H docker exec -w /work/browser-vK7Equ/wren-ui \
  -e WREN_TEST_GATEWAY_BINARY=/work/wren-test-agentgateway \
  kailo-wren-native-sdk-vuc6uo \
  node node_modules/jest/bin/jest.js --runInBand \
  src/nativeBrowserSession.test.ts src/middleware.test.ts
```

Evidence directory: `codex-wren-governance-20261005.Itgs2N`.
`csrf-targeted.log` and `csrf-targeted-2.log` are actual exit 1, not acceptance.
`csrf-targeted-3.log` is 38/38 passed, exit 0. The new real-Gateway case covers
POST/PUT/PATCH/DELETE to both GraphQL and run_sql: same-origin succeeds;
cross-site and same-site sibling requests return 403 without reaching the
backend. Origin fallback without Fetch Metadata is checked as well.
Removing the actual route `csrf` policy made this consumer fail (1 failed,
37 passed, exit 1): backend request count increased despite Next's existing
origin denial. Exact restoration had `cmp` exit 0 and `csrf-restored.log`
returned 38/38 passed, exit 0. No product build or deployment was performed.
The backend invokes real Next middleware but not real native SQL or business
mutations; fixture IdP sessions do not prove a live organizational login.

- Positive log SHA-256: `3f6d6d58b7bf8eeab045530d52a5c9d55ea900e77b1be90a0fee45f8f271da45`.
- Mutation log SHA-256: `7a5faad30c1e307d9bf1383a8fbe5d8795a12ffb3ac5fdd2a0efab5449c3d075`.
- Restored log SHA-256: `3c27f07a9e2e8abb04a0e0debbc4364187cc391d705930c3a92ff62d079dfbbd`.

## Native query admission consumer — 2026-10-05

This independent source slice follows SS-WRN-GOVERNANCE on the complete
`c5f02a0391c87420dba78632dcd86073710deb72` GenBI source. It does not substitute
the unrelated Python v2 MCP product or change the frozen browser/CSRF results.

The implemented inputs and consumers are:

1. `wren-ui/src/pages/api/platform-adapter/[operation].ts::handler` uses the
   official MCP TypeScript SDK 1.26.0 stateless HTTP transport. Its exact machine
   endpoints independently authenticate; no browser cookie or native UI token
   becomes a platform ActionToken. Original native UI routes retain their OIDC
   middleware. The original Next rewrite exposes only the matching observe path.
2. `wren-ui/src/apollo/server/services/nativeQueryAdmission.ts::authorizeQuery`
   validates the original signed ActionToken and exact parameter hash, then calls
   the existing Core adapter PEP using the dedicated binding service identity.
   Configuration and key files are controlled delivery inputs, not request fields.
   Service secrets and both tokens remain in memory, not native API history.
3. `wren-ui/src/apollo/server/services/nativeQueryService.ts::execute` pins the
   configured native project, its connection fingerprint and original successful
   deployment ID/hash. It calls the original `QueryService.preview`, not another
   SQL engine. Describe returns model/column metadata only. The native
   `ApiHistoryRepository.reserveGovernedQuery` commits intent before execution;
   exact binding/key and binding/ActionExecution uniqueness prevent repeat SQL.
4. Query exceptions preserve UNKNOWN. Absence is not a writer fence. Only a
   refusal before invoking QueryService establishes NOT_DISPATCHED. Completion
   is stored in the original native history; result disclosure still performs
   fresh Core authorization. `observe` returns original record metadata, never
   query contents or fabricated asynchronous job/cancellation evidence.

Implementation preceded these checks. The original resource-limited 10ad SDK
ran with UID 1000, 4 CPU, 4 GiB RAM and equal memory/swap limit. It shared only
the existing isolated test PostgreSQL network namespace and used a unique
`wren_query_itgs2n` database. The original 45 Wren migrations, including the
native history extension, were applied there; no business database was touched.

The original commands, from the native `wren-ui` directory, were:

```sh
node .yarn/releases/yarn-4.5.3.cjs check-types
node node_modules/jest/bin/jest.js --runInBand \
  src/nativeQuery.test.ts src/middleware.test.ts \
  src/apollo/server/repositories/apiHistoryRepository.test.ts \
  src/apollo/server/services/tests/queryService.test.ts
```

`WREN_QUERY_TEST_DATABASE_URL` selects the explicit isolated database. The test
uses the real Next handler, official MCP client/server, QueryService,
WrenEngineAdaptor and Knex repositories. Core PEP, OIDC and Engine HTTP are
bounded fixtures: this is not a deployed platform/Temporal/data-source E2E.
The original type check and all 52 tests passed (exit 0). Eight actual handler
cases cover scoped query/describe/dry-run, duplicate intent, changed key/SQL,
UNKNOWN observation, pre-dispatch refusal, changed deployment/credentials,
post-completion revocation and anonymous/browser-channel rejection.

Two production guards were removed together in the execution copy: the native
connection fingerprint and the last fresh check before result disclosure. The
real handler tests failed twice (exit 1), with a result returned where rejection
was required. Exact source restoration was checked with `cmp`, then the original
type check and all 52 tests passed again (exit 0).

Raw logs and exit files are in `codex-wren-governance-20261005.Itgs2N`:

- `query-combined.log`: SHA-256 `fc2c54a41cbca0e87c515a7e1efca424c38554789029ef14fc020536835399bf`.
- `query-mutation.log`: SHA-256 `cb1b6295c799d5f2dc7c1e7f5c6c38cf61dc80ee9e15c12f1a5e93c96d6ba0f3`.
- `query-restored.log`: SHA-256 `929a830daf9750d6e2074a7dda59bd46ff75f0e4c3bb82659484dfbda4a94ca1`.

Initial failures are retained: the original Jest configuration lacked the
existing TypeScript `@/` alias (zero tests ran); two subsequent negative cases
initially expected `isError` instead of the official SDK's rejected MCP protocol
error. Production authorization was not weakened. Yarn lock resolution exited
0; an online immutable install failed in Yarn's fetch cancellation, and the
same lock completed an offline immutable, script-disabled install using the
existing native Yarn cache. This does not establish product Node 18 native ABI
or image build acceptance.

Remaining boundary: this slice does not activate a Wren ApplicationBinding.
The normal lifecycle handshake/validation and SecretStore read receipts,
approved catalog contracts/usage declaration, reliable native read-only database
role evidence, and a real platform caller/configuration still need integration.
A connection fingerprint alone is not a read-only-role proof. No zero usage is
fabricated. Native UI internal queries are not claimed to acquire a Human
platform workflow simply because these machine handlers exist. No full check,
product build, live model call, live SQL, publication or deployment was performed.

### Original Agent file-delivery continuation

The optional `docker/query-governance.yaml` now wires the original OpenBao Agent
to the actual native query file consumers. Three original Agent templates read
explicit KV v2 paths/versions. AppRole bootstrap stays in a separate read-only
mount; the UI only receives the rendered directory read-only. The configuration
has no auto-auth token sink/listener and renders each consumed file as `0400`.
This is a runtime delivery overlay, not a new secret or binding authority.

Post-implementation `src/nativeQueryDelivery.test.ts` executed the existing
OpenBao binary from image config ID
`sha256:7d26314820a535ef346f1e63911809e4d356b48068fef00a9dcb3400bb9e11b6`
inside the same bounded SDK. Its reported revision is
`ccc04f0952a84846330def323da1db6f8416a79e`; binary SHA-256 is
`08cc9b8dcf33e54a57d21bfd004c636fcfd09bcacc5d79fc70f9d4831372ca9c`.
The image config ID is not represented as an OCI manifest digest.

The test loads the production HCL and templates, performs real Agent wrapping
lookup/unwrap/AppRole login and versioned KV rendering against a bounded HTTP
fixture, then runs actual `loadQueryDelivery`, Gateway JOSE verification and
`authorizeQuery` using the rendered files. It verifies file mode, exact namespace,
three distinct secret reads and absence of credential values in captured logs.
It does not contact the business OpenBao service or claim audited live reads.

The native Agent case passed. Changing the production service-credential
template to read the ActionToken JWKS secret instead produced a real failed
assertion (exit 1). After exact template restoration (`cmp` 0), original
`check-types` and all five Jest entries passed: 53/53, exit 0. The extra entry is
`src/nativeQueryDelivery.test.ts`, with `WREN_TEST_BAO_BINARY` selecting the
existing test executable and `WREN_QUERY_DELIVERY_SOURCE` selecting exact
production Docker source bytes. No toolchain or product image was rebuilt.

- Positive `query-delivery-3.log`: SHA-256 `e76d22f8592aef78283bae461e9722adee7250594f6831e7c72d0327a50d104b`.
- Mutation `query-delivery-mutation.log`: SHA-256 `784cd4552dca7d4e2f807a04207e0de70421e38732b70c8322d18bffcbd1d394`.
- Restored `query-delivery-restored.log`: SHA-256 `799d0c943d176b43011fd6292936a7f38050927e947d4ac86ff31b26806e8281`.

Earlier delivery attempts remain recorded: a test-only missing `NODE_ENV` type
field prevented execution, and incomplete fixture KV metadata omitted the native
`deletion_time` field, so Agent correctly refused rendering. Neither was hidden
or treated as a production success. The real data-source and lifecycle boundaries
listed above remain; this continuation closes credential file delivery only.

### Original binding lifecycle continuation

The next increment remains based on the frozen 18-path query/delivery patch,
not on the integration assembly. It implements the existing
`SS-WRN-GOVERNANCE` / DD-70/71/93 management caller: Core's original
`application_binding.create` ActionToken reaches the native Next
`/platform-adapter/v1/handshake` and `/validate_binding` handlers. The actual
`NativeBindingService.call` invokes the same JOSE/fresh Core PEP consumer,
matches the controlled frozen binding/release/project metadata, and returns
the existing `AdapterBindingObservation` shape. Other management actions,
wrong scopes, browser cookies and Origin requests do not acquire this path.
No Core, Worker, platform contract, permission or workflow authority changed.

The native project is read through the original `ProjectRepository`; its
decrypted PostgreSQL connection must equal the exact versioned SecretRef value
read through the original OpenBao Agent. This first validator supports a
PostgreSQL project `NAMESPACE` with one connection SecretRef. This historical
slice did not support `DEDICATED_INSTANCE`; the design-alignment correction
below supersedes that isolation-mode restriction. Existing native UI
datasource support is not removed, but unsupported platform validators cannot
activate a binding through this consumer.

Static rendered receipts cannot satisfy Core's lifecycle-time audit check.
The same Agent now exposes only its owner-mode Unix API proxy, using its original
AppRole in memory, without a token sink, cache or network listener. The exact
KV version is read afresh, and its actual request ID is returned for Core's
existing audit verification. Native source
`/volumes/kailo/.references/openbao/internal/command/agentproxyshared/cache/listener.go::StartListener`
at fixed commit `735723da5628148f232497a48a35a137b6512103`
requires socket mode, user and group together before constructing the Unix
permission configuration; the deployment now supplies all three from the same
explicit UID/GID. This is not a second secret broker.

Before successful validation, the existing `pg` driver reads the datasource's
roles and ACLs; before a native Postgres query dispatch the same check runs again.
It includes both `session_user` and `current_user` plus assumable roles, so an
initial SET ROLE cannot hide privileges recoverable with RESET ROLE. It rejects
database/schema creation, temporary objects, table/sequence writes/ownership,
privileged roles and executable non-system routines. The sole system-view
exception is `pg_catalog.pg_settings`: its UPDATE changes session parameters,
not stored business data, as documented by the
[PostgreSQL source documentation](https://www.postgresql.org/docs/current/view-pg-settings.html).
The component does not grant permissions or treat a `readOnly` config flag as
proof. The native database remains the permission authority; this is not a new
general SQL policy engine.

Post-implementation validation used the same fixed 10ad SDK at 4 CPU/4 GiB,
UID 1000, no extra swap, with the original Data dependency cache and isolated
PostgreSQL namespace. `check-types` exited 0. The five original Jest entry
points listed above passed 54/54, including the new actual Next management
handler with real project/repository access and native PostgreSQL ACL reads.
The case covers direct and inherited writes, resettable login roles, wrong
connection credentials, unsupported isolation, non-management actions and
fresh refusal after the native checks. Each case-created database/role belongs
only to the isolated fixture and was cleaned up; no business role was changed.
The actual OpenBao executable also authenticated, rendered files and proxied
a fresh Unix-socket request without a caller token, with socket mode 0600.
Its HTTP authority and Core PEP remain fixtures: this is not live OpenBao audit
verification, platform approval, a real datasource query or a Temporal E2E.

The first combined run had 52 passed / 2 failed, exit 1: the Agent fixture
reached its bounded rendering deadline and the first ACL implementation
mistook `pg_settings` for a business write. The next diagnostic exposed the
actual 0755 socket mode caused by incomplete original listener configuration.
All original outputs remain. After those fixes, the original combined command
passed. Removing the production writable-role refusal and making the actual
Agent socket 0666 produced two failed consumer assertions, exit 1. Both changes
were restored; the source/mirror comparison passed and the original typecheck
plus five Jest entries again passed 54/54. The final isolation fixture was then
separated from its wrong-secret condition; its actual handler target passed
again (one selected, eight unselected). No failed output was replaced.

Original files are under
`/volumes/data/kailo/tmp/codex-wren-governance-20261005.Itgs2N/`:

- `binding-targeted.log`, exit 1, SHA-256 `3b02753152e0e8698e8e0cfae67dea05e085fdd67037f2e5db43bde7bfbe4159`.
- `binding-targeted-2.log`, exit 0, SHA-256 `6f7fcc910b5fb106c270550ae1ebc6b373506eaed02d21b948d147733b49a36a`.
- `binding-mutation.log`, exit 1, SHA-256 `04b38fcb6355c244d29466e28f46a9fb48b5644e3788e9eb58d91ab6868e1b28`.
- `binding-restored.log`, exit 0, SHA-256 `d0c22c4d0d9629f34576a29d56e07651f265e9cf0fff8018c0ae5ffb0fc3d67d`.
- `binding-final-scope.log` and its `.exit` retain the final selected target.

No full check, product build, commit, push or deployment occurred. Real readonly
datasource/project/SecretRef facts, approved release/binding/resource/tool
configuration and a real AgentTask/usage invocation remain unverified. The new
lifecycle is no longer an unimplemented always-refusing endpoint, but these
fixture results do not prove a live binding ACTIVE. The native browser's own
query path still has no Human platform Action producer; the machine consumer
must not be represented as completion of that separate entry path.

## Standalone native startup and internal callback delivery (2026-10-05)

This independent slice starts from assembly tree
`9e1de0b71754f83516dbd41b714d5e29603181de`; it does not overwrite the
already integrated HUMAN ComponentTask producer. DD-87/DD-93 and
`08` SS-WRN-IDENTITY/SS-WRN-GOVERNANCE keep the original native UI, database
and service pipeline independent. No platform database is opened here.

Source facts are from fixed GenBI
`c5f02a0391c87420dba78632dcd86073710deb72`:
`wren-ui/src/apollo/server/config.ts::defaultConfig/getConfig` supplied public
encryption defaults; `wren-ui/Dockerfile::CMD` started native Knex then Next;
`docker/docker-compose.yaml::services` shared one volume between SQLite,
Engine and Qdrant. `wren-ai-service/src/providers/engine/wren.py::WrenUI.execute_sql`
and `wren-ai-service/src/force_deploy.py::force_deploy` called the original
GraphQL endpoint without authentication. With the previously delivered JOSE
middleware, that native callback was correctly refused, not a reason to exempt
GraphQL or send a platform user's token.

Four-step impact: (1) consume only component-specific controlled files and
explicit deployment metadata; (2) load the native DATA_KEY before the original
native Knex migration/Next process and separate native volumes; (3) use the issuer's
standard client-credentials grant in the two real native AI callback consumers,
with dedicated audience/instance authorization still checked by existing JOSE;
(4) missing credentials, mismatched endpoint, token denial or redirect do not
send an unauthenticated query, and a failed migration does not start Next.
No Action/Workflow/permission/schema/registry authority changes. The source
manifest only registers the actual changed AI-service image build target beside
the UI target; its artifact remains `none` until a real source build.

The original Compose entry now explicitly delivers required AI startup variables,
native OIDC registration and file paths. It cannot default to an unmodified UI
or AI image. The AI recipe now includes its existing committed Poetry lock.
Image digest provenance and the original Python base/OS dependency resolution
still need release preparation and a real build; no reproducibility claim is
made from this edit. Existing installations must preserve their database and
keys before the new volume names are adopted; no automatic migration, key
rotation or deletion was performed.

Post-implementation checks used the existing fixed 10ad SDK, UID 1000,
4 CPU / 8 GiB / equal memory+swap limit, a dedicated Data cache copy, and no
installation. Native startup Node tests passed 5/5; Python stdlib tests passed
6/6, including the actual WrenUI and force_deploy production consumers with
HTTP/config dependencies substituted. These are not real IdP, aiohttp network,
Knex migration, production Node 18/Python 3.12 image or model acceptance.
SDK versions are Node 24 / Python 3.13. No full or product build was started.

Removing the actual migration failure gate produced one failure/Node exit 1.
Removing the actual WrenUI Authorization/Origin dispatch produced one failure/
Python exit 1. Both production files were apply_patch restored, cmp 0; final
startup/provider checks passed 11/11, exit 0. Original Compose `config --quiet`
with synthetic metadata and empty fixture credential files exited 0 (only the
upstream obsolete-version warning); missing DATA_KEY directory configuration
exited 1. This parsing test never started services or read real credentials.

Receipts under `codex-wren-standalone-20261005.7HvM3h`:

- `mutation.log`: `ec20e9df0c1d76c278b9d7cf09bb9113f28713b4421d1e928f5af601e87ad282`.
- `final-targeted.log`: `55a5e66c98606072a92f01ce36ee0907d5139ece9ea187bec9bc782baf053b0b`.
- `compose-config.log`: `16f261ca7d0f12f7e4f12e6f1586fb78cf924239aaacc1d283a660e058a463de`.
- `compose-missing-key.log`: `8a1ee7c27f2153d4faa3841af20cfe36f8086215eeaf68fc3cdd5584f348a5ca`.

Required live facts remain explicit: source-built UI and AI images plus matching
Engine/Ibis/bootstrap/Qdrant digests; TLS native origin; real dedicated browser
and native service OIDC registrations with signed instance access; owner-only
retained DATA_KEY/client files; actual native model/embedding/data-source
configuration and database permissions. The optional governed-query overlay
still requires approved release/binding/SecretRef/resource facts. No such facts,
commit/push, deployment or working GenBI question-to-SQL E2E are asserted here.

### Native startup configuration correction

Review found unsupported restrictions in the new entrypoint: a fixed SQLite
path, database type, bind address, and input passphrase length range. These
restrictions were removed. At the same fixed upstream commit above,
`wren-ui/knexfile.js` selects `pg` with `PG_URL`, otherwise native SQLite with
`SQLITE_FILE`; `wren-ui/src/apollo/server/utils/encryptor.ts::Encryptor.createSecretKey`
derives the AES key with PBKDF2, without the invented input-length rule.
The entrypoint now preserves original database/network configuration; Compose
delivers the native settings explicitly. File permission, nonempty key and
control-character checks remain. The native OIDC requirement is unchanged.

The original `force_deploy` backoff could repeat a mutation after a lost reply.
It was removed; such a failure propagates from that invocation. This is not
cross-restart deduplication: the unchanged original AI entrypoint and Compose
restart policy can invoke the optional `SHOULD_FORCE_DEPLOY` startup operation
again. Native deployment state must be inspected before recovery. No platform
workflow or native receipt has been fabricated for this startup operation.

After these changes, the same idle 4 CPU/8 GiB fixed SDK ran the actual startup
and callback targets: Node 7/7 and Python 7/7, exit 0. Tests load the original
Knex config for PostgreSQL and a custom SQLite path, check configured address/
port preservation, and inject loss of the actual force_deploy response. They
do not connect to a real DB/issuer. Restoring the hardcoded address caused one
failure (exit 1); adding automatic re-entry after the lost response caused one
error (exit 1). Both production sources were apply_patch restored, cmp 0,
then all 14 tests passed again. Original Compose parsing with synthetic
metadata also exited 0; no service was started.

Correction receipts in the same private directory:

- `correction-config-mutation.log`: `42b2e012b4d7e3187bab919ed0d1dc0bd6d31fce732b71057d2ab8a3911d941e`.
- `correction-retry-mutation.log`: `8199c1294d0bb86e501b32bc08af688d3de9c357e40321bb4037f451d07ae6bc`.
- `correction-restored.log`: `8e5dfa7ae416aa82ad7c1f571c2c0787613738c08b25254987210575488a37d4`.
- `correction-compose.log`: `05f794ec465edad9ad943c7a7897023b243bcde0ad7337c5ebf570adb62c25cc`.

### Combined source consumer corrections (20:25 UTC)

The standalone delta was integrated with the HUMAN query producer without
replacing that producer or the shared native-page surface. The original UI
port is now consumed by the UI listener, native Gateway upstream and AI
callback together; previously only the listener changed, leaving two callers
on the old port. This changes deployment plumbing, not a new endpoint,
identity, workflow or database authority. Empty required port remains a
configuration failure rather than a default route to another instance.

At the same fixed GenBI commit above,
`wren-ui/src/apollo/server/services/deployService.ts::DeployService.deploy`
returns `{status, error}`, not a Boolean. The original force-deploy consumer
now requires an actual `SUCCESS` status without errors; HTTP 200, null data,
FAILED, IN_PROGRESS and unknown status do not print confirmation. The supplied
runtime template also leaves the original optional `SHOULD_FORCE_DEPLOY`
empty, preventing forced mutation replay on ordinary container restart while
preserving native UI deployment. Explicit operator recovery still requires
native-state inspection. These runtime defaults and retained encryption keys
are recorded in apps/07 section 1.2, not imposed as Core startup dependencies.

Actual combined checks in the same fixed 10ad SDK, 4 CPU/8 GiB, owner 1000,
Data-only execution copy: original Node target 7/7 and Python target 7/7,
including seven deployment-response subcases, exited 0. Removing the actual
SUCCESS guard in the execution copy produced three assertion failures and
exit 1; apply_patch restoration and cmp against the candidate exited 0, then
both targets passed again. Original Docker Compose JSON with a nondefault
fixture port confirmed all three consumers matched; restoring the hardcoded
Gateway port produced AssertionError/exit 1. Restored configuration cmp and
the same assertions, including empty startup force-deploy, exited 0. The
upstream obsolete Compose version warning remains. No real credentials,
services, native data, model calls or live deployment were involved.

Combined receipts under `codex-component-runtime-integration-20261005.lciVUS`:
`wren-startup-union-restored.log` SHA256
`949d83591f629452229640cba1177edba089c1cb0c63bc456412dca9a3aa1e4a`;
`wren-deploy-status-mutation.log` SHA256
`e3d4cd0b8200ff63575e88c0eeea78746f8e29f50aa3c2b27b94d3e62642b4a0`.
These checks do not replace whole-batch full, production-version builds,
native authentication/database/model E2E or actual source commit and push.

### Final native credential correction and HUMAN receipt (2026-10-05)

The native service credential reader no longer invents a 4096-byte maximum
for the issuer's owner-only delivered client secret. The approved native
identity delivery remains the only source; regular-file/no-symlink/owner-only,
nonempty and control-character rejection are unchanged. This aligns with the
same native DATA_KEY reader, which does not impose an unsupported length.
No new configuration knob, credential, account or permission was created.
The deployment guide now consistently describes WREN_UI_PORT rather than
claiming Docker EXPOSE overrides it. No database/schema migration is involved.

In the existing fixed 10ad SDK, owner 1000, 4 CPU/4 GiB/no extra swap,
the original Python entry ran 8 tests, exit 0. Reintroducing the removed
length check in the isolated execution copy caused exactly the new actual
credential-consumer case to fail, exit 1; byte restoration/cmp and the same
8 tests then exited 0. These are synthetic transport fixtures, not issuer
or native deployment acceptance. Receipts in the combined Data directory:
`wren-identity-config-mutation.log` SHA256
`22e49e244fd3e52bc8f548f32c0c43fafae506b3f67306d9450636a61cfc3c75`;
`wren-identity-config-restored.log` SHA256
`3d05864adaa7a067c6dd8f488b76741afad7cdf90e6cdbe6566339424de57b0f`.

The already-running original HUMAN query target also terminated exit 0:
four HUMAN cases passed, nine other cases were excluded by the HUMAN filter.
It covers the actual native handler's HUMAN reference and proven-unsent
refusals, not all 13 cases or a deployed datasource. Original receipt
`wren-human-union-restored.log` SHA256
`e3c371aa5f54c8317b6440f7a9d80fab4e3927b3ba46ff2c71c28025b2318f59`.

### Native release/runtime configuration projection (2026-10-05)

Four-step change record: (1) Fixed GenBI
`c5f02a0391c87420dba78632dcd86073710deb72` already supplies the native
Compose/AI Dockerfile and this fork's signed native UI/service identity readers.
The existing fork manifest already registers `data-query-ui` and
`data-query-ai-service` for the original `tools/build-upstream.sh`.
(2) The runtime example still instructed a second `component.env`, and generic
`PROJECT_DIR`, `PLATFORM`, `HOST_PORT`, `DB_TYPE` and telemetry inputs could
consume unrelated platform values. The AI Dockerfile's original Python 3.12.0
base tags were floating. These are delivery defects, not a missing native UI.
(3) Keep the original separate native Compose; its non-secret WREN-prefixed
inputs now come from the sole `deploy/local/.env`. Derive the native issuer
from `OIDC_ISSUER` and callback from `WREN_PUBLIC_ORIGIN`; retain dedicated
native client/cookie and instance authorization. The original PostgreSQL
`PG_URL` comes only from a component-specific credential file. Paths reject
implicit creation. Qdrant is on an internal data network with only its original
AI client. The optional existing query overlay consumes the same deployment
file and original binding/query metadata, not a new registry or grant producer.
(4) Preserve native UI, AI/Engine/Ibis/bootstrap pipeline, native databases,
keys and model configuration. No Core model/approval/schema or identity changes.

Compatibility: explicitly launch the original native Compose with
`--env-file deploy/local/.env` from apps, preserving the existing native Compose
project name and retained volumes for an established installation. Do not apply
this as an implicit database/storage migration. Wren is deliberately not included
in the platform Compose: required-variable interpolation runs even for disabled
profiles, so an include would make absent optional Wren block Core startup.
Native config/secret paths and actual source-built UI/AI/Gateway image references
are required for Wren launch only. This change neither creates default business
identities nor assigns instance/native database permissions.

Registry metadata was read using original `docker buildx imagetools inspect`,
each exit 0; no image build/pull or service startup occurred. Python remains
the exact original 3.12.0: bookworm index
`sha256:5eba34eb667213abb09a4c470365180d5706076f76945e49b963ac15d428a684`
and slim-bookworm index
`sha256:19a6235339a74eca01227b03629f63b6f5020abc21142436eced6ec3a9839a76`.
The sole example pins the original unchanged dependencies at Engine/Ibis
0.22.0, bootstrap 0.1.5 and Qdrant 1.11.0 using their actual registry indices;
these are dependencies, not source-built Kailo UI/AI acceptance. UI/AI manifest
source/artifact digests remain `none` until the original release builds complete.
OS/package downloads in the native recipe have not been proven reproducible.

Postimplementation checks used the existing fixed 10ad SDK, owner 1000,
4 CPU/8 GiB/no extra swap, Python 3.13 for JSON assertions, plus the original
Docker Compose parser. No dependencies were downloaded or new runner installed.
Synthetic non-secret metadata confirmed 18/18 actual native configuration
consumers, a nondefault UI port shared by listener/Gateway/AI callback, isolation
from conflicting generic platform variables, preserved private data and no
extra host ports. Replacing the production Qdrant network with the general
native network produced exit 1; apply_patch restored the exact bytes and all
18 passed again, exit 0. Original PostgreSQL credential-file projection and
seven existing query-overlay assertions passed, exit 0. Missing UI image,
native config directory, controlled DB credential file or public port each
failed config, exit 1, rather than selecting an original image/default identity.
The first assertion run incorrectly treated the parser's omitted default-false
`create_host_path` JSON field as true; that exit 1 is preserved separately.
Correcting that representation assertion required no production workaround.
The upstream obsolete Compose version warning is retained.

Receipts are under `codex-web-protocol-surface-20261005.Sv3Qhy/apps/`
`wren-release.OtFNCI/`. Restored `compose-restored.log` SHA256
`b77dfcf5f4dcb6af209b640f4e3fb26eba29c877342c20d2558c526438e594cd`;
production `compose-network-mutation.log` SHA256
`1146746a80c78e7d0071367b7fd7215f2e024357f6f6612ea9ac2eb58873e617`.
Config parsing is not native login, datasource readonly-role evidence, model
execution, Temporal/business termination, governed disclosure or deployment
acceptance. No heavybuild, full, live configuration/DB/permission change,
model call, product deployment or GitNexus execution was performed.

## Dedicated native instance/project alignment (2026-10-06)

DD-12 and design `08` section 6 require `DEDICATED_INSTANCE`. The previously
implemented binding validator instead accepted only `NAMESPACE` and its test
explicitly required the design's mode to fail. That was an implementation
mismatch, not an upstream limitation or a reason to change the design.

At fixed GenBI `c5f02a0391c87420dba78632dcd86073710deb72`,
`wren-ui/src/apollo/server/repositories/projectRepository.ts::ProjectRepository.getCurrentProject`
selects the first project ordered by ID. The original UI's current-project
service delegates to it; an adapter-only `findOneBy(id)` did not establish that
the binding and the visible native UI used the same project. The validator now
accepts the frozen dedicated-instance mode and compares that original current
project's ID with its controlled project ID before reading the connection
credential or issuing any datasource ACL query.

Impact and boundaries: native identity remains the existing dedicated Gateway
OIDC and independently verified JOSE instance grant; every original UI route
and feature is retained. The existing Core binding document, fresh PEP,
OpenBao receipt and actual PostgreSQL readonly-role checks remain unchanged.
No new binding registry, project selector, schema, secret or API is introduced.
An absent/current-project mismatch cannot activate the binding; unsupported
isolation modes remain refused. Existing NAMESPACE metadata is not silently
migrated or grandfathered: an operator must supply the approved dedicated
instance facts through the normal binding lifecycle. Matching a native project
is not proof that deployment storage or credentials are physically dedicated;
that remains actual deployment evidence. No live binding or database is changed.

The existing post-implementation `nativeQuery.test.ts` route case now checks
DEDICATED_INSTANCE in the actual observation, refuses NAMESPACE and rejects a
different project returned by the original current-project consumer. It retains
the original secret receipt, writable-role, wrong-credential and fresh-PEP checks.

Actual verification reused `kailo-wren-query-sdk-itgs2n`, image
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`,
UID 1000:1000, 4 CPU / 4 GiB / equal memory+swap limit and the existing isolated
test database. It was idle before execution; host available memory was 38 GiB.
The current native source and migrations were synchronized, not the reference
checkout. No dependencies were installed and no product build was run.

```sh
sudo -n docker exec -w /work kailo-wren-query-sdk-itgs2n \
  node node_modules/jest/bin/jest.js --runInBand src/nativeQuery.test.ts \
  -t 'validates the actual binding route'
```

The actual result was 1 passed / 12 excluded, exit 0; this is not acceptance of
the excluded queries. Removing only `project.id !== this.config.projectId`
from the SDK copy produced exactly one failure, exit 1: expected HTTP 403,
received HTTP 200. Restoration from the formal source and `cmp` both succeeded;
the same target then passed 1/1 again, exit 0. The native current-project
mismatch in this route case is injected at its repository boundary; native
PostgreSQL credential/role checks use the existing real isolated fixture.

Raw logs are under
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/`:
`wren-dedicated-binding.log`, `wren-dedicated-binding-mutation.log` and
`wren-dedicated-binding-restored.log`. First startup spent 383 seconds mostly
waiting for source/dependency disk reads; the restored run took 8.7 seconds.
The original `node .yarn/releases/yarn-4.5.3.cjs check-types` also exited 0
in the same restored SDK (`wren-dedicated-types.log`, no diagnostics).
Upstream `status data-query` reports no newer reference commit. No live login,
ApplicationBinding activation, release approval, model call or deployed
question-to-SQL flow is proved by this isolated source verification.

## 2026-10-07 Exact native frame ancestors

Four-step impact: the latest native-page host requirement changes framing, not
Wren's dedicated-instance identity authority. The existing Next middleware and
Compose delivery are the only production seams here. Original JWT verification,
signed instance grant, unsafe-method Origin checks and machine-route exemptions
remain unchanged; no business state, user registry or audit authority is added.
Empty configuration keeps self, malformed origins fail closed with 503, and
framing permission never grants API access. Runtime `KAILO_FRAME_ANCESTORS`
accepts explicit HTTP(S)/tauri parent origins, rejecting wildcard, credentials,
paths, queries, fragments, invalid ports and header injection.

Existing SDK `kailo-wren-query-sdk-itgs2n` (UID 1000, 4 CPU/4 GiB) ran
`node node_modules/jest/bin/jest.js --runInBand src/middleware.test.ts`:
47 passed, exit 0. The cases include exact CSP, native tauri parent, absent JWT,
foreign unsafe-method Origin and invalid configuration. SDK-only replacement of
the response policy with `frame-ancestors *` made the selected check fail (1
failed, exit 1). Original bytes restored with cmp 0; all 47 then passed, exit 0.
Logs: `/volumes/data/kailo/tmp/gateway-locale-repair-20261007.iwRGvX/`
`wren-frame-final.log`, `wren-frame-mutation.log`, `wren-frame-restored.log`.
No dependencies were installed and no image, full check or deployment was run.

This does not prove cross-site cookie delivery or first iframe login. Existing
Gateway Lax cookies are unchanged. A popup can complete the original OIDC flow
but does not by itself make cookies available in a cross-site iframe; Desktop
tauri/LAN HTTP remains an explicit unaccepted boundary, not a reason to weaken
SameSite, JWT or CSRF checks.

Identity follow-up is also distinct from framing: pinned upstream
`c5f02a0391c87420dba78632dcd86073710deb72`,
`WrenAI-ui-0.32.2/wren-ui/src/pages/api/graphql.ts::bootstrapServer` supplies
service-only context, and
`WrenAI-ui-0.32.2/wren-ui/src/apollo/server/repositories/projectRepository.ts::ProjectRepository.getCurrentProject`
selects the first project. Current middleware checks the dedicated instance
grant but does not yet give native GraphQL Query/Deploy/Asking an authorized
business actor. Existing `nativeQueryAdmission.ts::authorizeQuery` serves the
ActionToken plus SERVICE PEP path; a HUMAN OIDC subject cannot be treated as an
admin or substituted for that token. This batch claims neither that missing
native HUMAN admission integration nor full business identity isolation.

## Saved-view native HUMAN Query consumer, 2026-10-07

The next code slice addresses that specific saved-view Query gap, not Deploy,
Asking, arbitrary SQL previews or complete multi-user Wren isolation. Wren stays
DEDICATED_INSTANCE with its own database and QueryService. The fixed upstream
`c5f02a0391c87420dba78632dcd86073710deb72` was checked using `git grep`:
`WrenAI-ui-0.32.2/wren-ui/src/components/pages/modeling/metadata/ViewMetadata.tsx::ViewMetadata`,
`WrenAI-ui-0.32.2/wren-ui/src/apollo/server/resolvers/modelResolver.ts::ModelResolver.previewViewData`
and `WrenAI-ui-0.32.2/wren-ui/src/apollo/server/services/queryService.ts::QueryService`.

The original preview button/mutation now consumes NativeHumanQuery, retaining
the original saved view and QueryService execution through the existing
NativeQueryService. Middleware removes caller-supplied identity forwarding
headers and forwards only the independently verified native JWT on the private
GraphQL hop. Core verifies that JWT again using the operator-controlled binding
directory and existing IdentityProvider, not a caller-supplied issuer/JWKS/sub.
The binding SERVICE credential is only transport identity. No native admin role
is inferred from JWT subject and no second user or audit table is created.

The controlled query delivery optionally selects an existing Resource version
and ResultExposurePolicy version in `humanAction`. Missing delivery closes this
query action. ViewMetadata retains only an opaque retry key in sessionStorage;
failure to persist it prevents submission. The original saved-view reference
is frozen once and submitted via the original HUMAN application action. Reload
and retry observe that AE first; unknown or denied observation keeps the same
intent. Terminal status is accepted only from Core's reconciled terminal audit.
Native results come from the original api_history with exact project, binding,
AE, operation and SUCCEEDED state, then Core is checked again before disclosure.
Neither query SQL nor rows are copied to Core. A changed selected view cannot
render the preceding view's receipt. The existing explicit reference-export
interaction remains available.

Actual checks used the existing `kailo-wren-query-sdk-itgs2n` (4 CPU/4 GiB), with
no installation/build. Original GraphQL codegen read the real local schema and
generated only the optional PreviewViewDataInput idempotencyKey change. The
first shell invocation had an escaping SyntaxError; the corrected invocation
exited 0. Existing middleware, native query and new HUMAN consumer tests passed
67/67. TypeScript check exited 0. Removing the post-history Core recheck in the
private execution copy caused 1 failed/5 passed (exit 1); original bytes were
restored with cmp 0 before the 67-case final run. This consumer test mocks the
Core HTTP boundary; its success is not a production SSO→approval→SQL→usage E2E.

Logs under
`/volumes/data/kailo/tmp/gateway-locale-repair-20261007.iwRGvX/`:
`wren-human-codegen.log`, `wren-human-initial.log`, `wren-human-restored.log`,
`wren-human-mutation.log`, `wren-human-final.log`, `wren-human-types-final.log`.
Deploying this slice still requires the actual approved binding/resource/policy,
native identity trust projection and original credentials. Browser SSO cookie
delivery inside the iframe remains a separate acceptance boundary. No running
configuration, image or business record was changed here.

## Native Deploy terminal evidence, 2026-10-07

This independent increment is based on the frozen HUMAN-query tree
`e9d6256bb6f0bb9ebcccde744d959c028397f522`. It does not implement Asking model
admission, a new platform Deploy Action, or immutable version publication.
The original pages, layout, controls and GraphQL response states are unchanged.

Four-step impact review:

- Authority: `.design/08` §6, `SS-WRN-GOVERNANCE`, `SF-WRN-08/09` retain the
  original native modeling workflow; `data_query.publish_version@v1` remains
  unavailable. Wren owns its mutable deployment and `deploy_log`; Core gains no
  model content or alternative executor. Reference commit
  `c5f02a0391c87420dba78632dcd86073710deb72` in
  `WrenAI-ui-0.32.2/wren-ui/src/apollo/server/services/deployService.ts::DeployService.deploy`,
  `wren-ui/src/apollo/server/repositories/deployLogRepository.ts::findLastProjectDeployLog`,
  `wren-ui/src/apollo/server/adaptors/wrenAIAdaptor.ts::waitDeployFinished`, and
  `wren-ai-service/src/web/v1/services/semantics_preparation.py::get_prepare_semantics_status`.
  The initial suspicion about cached successful hashes was incorrect:
  `findLastProjectDeployLog` already selects only `SUCCESS`. That behavior stays.
- Writers/readers: both explicit and onboarding Deploy callers retain the same
  service. Its existing project row is locked while checking the original pending
  log and committing a new log; HTTP follows commit. Concurrent and forced calls
  observe the same pending log instead of dispatching again. Existing
  `ModelResolver.checkModelSync` polling observes native status, persists a proven
  terminal result, then reads the updated successful deployment. No new timer,
  outbox, database, migration or platform contract is introduced.
- Side effects: AI request/status response optionally carry `execution_id`, the
  existing native `deploy_log.id`, while manifest hash stays unchanged. This
  prevents a previous forced attempt with the same hash supplying the new
  attempt's result. Only matching `finished`/`failed` evidence is terminal.
  Original recommendation generation follows confirmed success, never a pending
  or failed Deploy. Automatic recommendation generation after a later read-only
  reconciliation is not added or claimed restored by this batch.
- Exceptions: dispatch disconnect, unknown enum, foreign/absent execution
  reference, response contradiction, timeout and terminal-persistence failure
  retain the original `IN_PROGRESS` log (`UNKNOWN`, not success/failure). Native
  cache expiry/restart returns HTTP 404 instead of fabricated indexing failure.
  The existing bounded initial polling window is unchanged; subsequent original
  page polling only observes. Missing terminal evidence is not expired/replayed;
  it needs native operator evidence before any recovery. Authentication,
  permissions, quota and approvals are not bypassed or redefined. Before-intent
  database errors still reject; project contention is a `CONFLICT`. Other error
  classes and application admission remain outside this native-terminal slice.

Compatibility/release boundary: deploy the matching AI service before the new UI
writer. Old peers without execution references cannot complete new attempts.
Old in-progress logs without such evidence remain unresolved, and previously
misclassified `FAILED` timeout logs require operational review; this batch does
not rewrite/replay that history. Mixed old/new UI writers are not covered by the
new project-lock proof. Existing successful hashes and native MDL references are
preserved. SQLite concurrency is not verified; the actual transaction test uses
PostgreSQL, matching this deployment's database.

Implementation-first checks used existing `kailo-wren-query-sdk-itgs2n`, UID 1000,
4 CPU / 4 GiB, existing dependencies and no install. Data free was 3.2 GiB,
memory pressure avg10 was zero; no Cargo/build task ran. Final commands:

```sh
./node_modules/.bin/jest --runInBand \
  src/apollo/server/services/tests/deployService.test.ts \
  src/apollo/server/adaptors/tests/wrenAIAdaptor.test.ts \
  -t 'DeployService|original deployment transaction|deployment terminal evidence'
./node_modules/.bin/tsc --noEmit
python3 -B native-deployment/tests/pytest/services/test_deployment_evidence.py
```

Final result: Jest 15 passed / 4 out-of-scope skipped, TypeScript exit 0,
Python 1 passed, combined exit 0. PostgreSQL uses the existing isolated test URL
and a newly created random schema with the original two native table migrations;
the test removes only that schema. Concurrent first/force requests committed one
intent; known failure permits a new attempt, successful same hash avoids another
dispatch. Native Python control-flow checks execute production functions with
framework/cache/pipeline boundaries substituted; they do not verify installed
FastAPI/Pydantic wire serialization or a live AI deployment.

Failures retained: the SDK's original Jest typings lack `runAllTimersAsync`
(fixed only the new fixture); an initial reused SQL fixture had a pre-existing
explicit-ID/sequence collision (moved this test into its own schema, no sequence
repair); two original recommendation tests mismatch original URL/body behavior
and remain out of scope, not silently marked passed. SDK-only mutations disabled
the execution fence and mapped unknown enums to failure: two actual assertions
failed, exit 1. Returning fabricated native `failed` on cache miss caused the
Python assertion to fail, exit 1. All mutated files restored byte-for-byte
(`cmp` exit 0); final 15 + 1 checks and TypeScript passed again.

Logs under `/volumes/data/kailo/tmp/gateway-locale-repair-20261007.iwRGvX/`:
`wren-deployment-initial.log`, `wren-deployment-restored.log`,
`wren-deployment-final.log`, `wren-deployment-mutation.log`,
`wren-deployment-native-mutation.log`, `wren-deployment-mutation-restored.log`.
No image, full check, deployment, online approval/quota acceptance or complete
Deploy/Asking governance is claimed by these results.

## Native saved-view preview language and identity partition, 2026-10-07

This increment corrects the HUMAN preview consumer, without changing the native
page layout, query execution authority or the Deploy candidate above.

Four-step impact review:

- Authority: `SS-WRN-IDENTITY` and `SS-WRN-GOVERNANCE` keep the verified HUMAN
  and current binding authoritative; the user-required Chinese default and
  selectable English replace simultaneous bilingual notices. The existing
  Next locale mechanism supplies `zh-CN` by default and the explicit `en` route.
  Wren's existing `ProjectLanguage` still controls AI answer language, not UI
  authorization or this UI locale. Only the preview/governance guidance is
  localized here; other original native Wren text is not claimed translated.
- Writers/readers: middleware verifies the original JWT and instance entitlement,
  strips forged private headers, then derives a non-authorizing opaque partition.
  The existing `/api/config` combines it with the controlled native binding and
  returns no token, issuer or raw subject. ViewMetadata uses that partition plus
  the view ID for its original sessionStorage retry key. The actual GraphQL
  resolver recomputes it before calling NativeHumanQuery, closing an identity
  change between configuration read and submission. Original Core admission,
  current config generation, result-history correlation and post-read permission
  recheck remain unchanged. No user registry, epoch, permission or audit store is
  introduced.
- Side effects: another HUMAN receives a different retry partition, while the
  first HUMAN's UNKNOWN key remains available on return. Credential rotation
  does not change that partition. Only a matching scope and actual corresponding
  terminal receipt release its key; a later 403 or transport failure does not.
  The original Preview button, Alert and PreviewData presentation remain in
  place. No SQL content or credentials enter browser persistence.
- Exceptions: unavailable configuration, malformed partition, storage failure
  and superseded/unmounted preparation refuse a new submission. Focus and
  visibility refresh clear stale displayed scope before rereading; results are
  also fenced by the original view ID. A forged or prior-person GraphQL scope
  is refused before any Core/native query call. These are PRECONDITION or
  REJECTED preparation outcomes, not terminal evidence about a previous UNKNOWN
  operation. No background polling or global cookie/storage deletion is added.

Compatibility: the new optional GraphQL `idempotencyScope` is generated by the
original codegen entry. The governed native resolver requires it; old HUMAN
preview clients fail closed. The preceding HUMAN candidate has not been deployed,
so there is no claimed production migration of its unscoped preview keys. This
increment does not adopt or delete an old unscoped key on behalf of another user.

Implementation preceded checks. The existing `kailo-wren-query-sdk-itgs2n`
container (4 CPU / 4 GiB, UID 1000) had no active child process; Data had 2.8 GiB
available. Original dependencies were reused without install, Cargo, image or
full build. Original GraphQL codegen exited 0. Final commands:

```sh
./node_modules/.bin/jest --runInBand src/middleware.test.ts \
  src/nativeHumanQuery.test.ts src/viewMetadata.test.ts
./node_modules/.bin/tsc --noEmit
```

Final result: 3 suites, **62 passed**, TypeScript exit 0, combined exit 0
(session 20746). Real local JWKS signatures cover forged header rejection and
the English Next route. The original ViewMetadata component is executed with
React SSR; its presentation children and network/storage boundaries are isolated.
Actual click callbacks cover first-person UNKNOWN, refused observation, a second
person's distinct key and return to the original key. This is not a browser SSO,
cross-site-cookie or deployed billing acceptance result.

SDK-only mutations removed the user partition from the key and disabled the
resolver partition comparison. Both checks actually failed (2 failed, exit 1):
the second user reused the first key, and the forged-scope call entered the native
query path instead of refusing at the identity guard. Both files were restored
from formal source with `cmp` exit 0 before the final 62-pass run. The initial
61-pass run predates the English-route test and is not substituted for the final
input. Logs under
`/volumes/data/kailo/tmp/gateway-locale-repair-20261007.iwRGvX/`:
`wren-preview-scope-initial.log`, `wren-preview-scope-format.log`,
`wren-preview-scope-mutation.log`, `wren-preview-scope-restored.log`.

## Persisted native recommendation observation, 2026-10-07

The delayed Deploy-to-recommendation dispatch gap is not declared closed. The
original recommendation POST allocates a new native UUID on every call; only
after receiving that response does ProjectService persist `project.query_id`.
The AI side holds its task in TTLCache, without a durable dispatch intent or an
idempotent POST protocol. Calling it from `modelSync` would therefore risk a
second model invocation after a lost response/crash. The existing LLM provider
also reads an environment API key/base URL; the binding SERVICE model-admission
and durable Gateway usage delivery seam is not established by this batch.
No substitute grant, fabricated model invocation or new dispatcher is added.

Pinned evidence is commit `c5f02a0391c87420dba78632dcd86073710deb72`:

- `WrenAI-ui-0.32.2/wren-ui/src/apollo/server/services/projectService.ts::ProjectService.generateProjectRecommendationQuestions`
- `WrenAI-ui-0.32.2/wren-ui/src/apollo/server/backgrounds/recommend-question.ts::ProjectRecommendQuestionBackgroundTracker.initialize`
- `WrenAI-ui-0.32.2/wren-ai-service/src/web/v1/routers/question_recommendation.py::recommend`
- `WrenAI-ui-0.32.2/wren-ai-service/src/web/v1/services/question_recommendation.py::QuestionRecommendation.__getitem__`
- `WrenAI-ui-0.32.2/wren-ai-service/src/providers/llm/litellm.py::LitellmLLMProvider`

Four-step impact review and implemented consumer:

- Authority: SS-WRN-GOVERNANCE retains the original native project/query and
  recommendation task; `.design/07` distinguishes native internal operations
  from calls to platform public services. This change only GETs an already
  persisted native query. It does not admit or POST any model operation, change
  Deploy success evidence, or introduce a Core task/permission authority.
- Callers: the existing ProjectService owns the original project tracker.
  Its constructor now actually calls the already-present `initialize`, which
  previously had no consumer. The original recommendation page read also
  reattaches a persisted pending query after startup storage failure. The
  existing timer observes it; no second timer/worker is created. An explicit
  native regeneration attaches its new query rather than leaving the old
  in-memory task behind. Thread tracker execution is not rewritten.
- Side effects: repository writes compare the exact project ID, native query ID
  and original nonterminal state in one database update. A late old result cannot
  replace a new query or regress a terminal result. Each observation first checks
  that its original project/query is still present. A late completion also cannot
  remove the newly attached in-memory task. Equal-length changed partial results
  are persisted rather than silently discarded.
- Boundaries: original native response ID must match, status must be one of the
  three original values, and the response must be coherent. Cache-miss
  `RESOURCE_NOT_FOUND`, foreign IDs, unknown enums and contradictory success
  remain unresolved instead of becoming FAILED. GET/database failures release
  only the in-memory running marker, retaining the original persisted query for
  its next observation. Deleted/replaced/already-terminal queries leave the
  tracker without new side effects. Proven FINISHED/FAILED persists and removes
  the matching observation; process restart reattaches pending native records.

There is no automatic deadline that can turn missing native terminal evidence
into a business outcome. The original observation interval is retained, failures
use its existing logger without raw error/credential payloads, and cache-expired
queries remain for native operator evidence/reconciliation. They are not replayed
by this consumer. Restoring the pre-query-ID dispatch gap and binding-governed
model calls remains required; this is not a complete recommendation/Asking
delivery claim. No schema migration or platform four-language contract changed.

Implementation-first verification reused `kailo-wren-query-sdk-itgs2n`, 4 CPU /
4 GiB, UID 1000, existing dependencies. Data had 2.8 GiB free, memory PSI avg10
was zero and that container had no competing process. Commands:

```sh
./node_modules/.bin/jest --runInBand \
  src/apollo/server/services/tests/projectRecommendation.test.ts \
  src/apollo/server/adaptors/tests/wrenAIAdaptor.test.ts \
  -t 'persisted project|recommendation receipt|getRecommendationQuestionsResult'
./node_modules/.bin/tsc --noEmit
```

Final restored result: **12 passed, 7 out-of-scope skipped**, TypeScript exit 0,
combined exit 0 (session 1316). The SQL case uses a fresh random schema in the
existing isolated PostgreSQL fixture, with original project/recommendation
migrations; it removes only that schema. It proves project/query isolation and
terminal monotonicity against real SQL. Timer/service cases execute the actual
tracker callback and ProjectService read with native HTTP/repository boundaries
isolated; no live model or production business state is used.

Three private SDK mutations removed the query-ID SQL predicate, kept the running
marker after failure, and accepted native cache-miss failure. All three actual
assertions failed, exit 1. Original bytes were restored (`cmp` exit 0 for all
three files), then the final 12 checks and TypeScript passed again. The first
overbroad test filter also selected the previously documented unrelated original
generation-body `project_id` expectation and failed that one assertion; it was
not changed or counted as passed. The existing observation response fixture was
corrected to the original native `id`, lowercase status and actual GET path.

Logs in `/volumes/data/kailo/tmp/gateway-locale-repair-20261007.iwRGvX/`:
`wren-recommendation-initial.log`, `wren-recommendation-narrow.log`,
`wren-recommendation-mutation.log`, `wren-recommendation-restored.log`.
No full check, image build, deployment or live recommendation acceptance ran.

## Bound native project and modeling references (2026-10-07)

Authority: `.design/08` §6, `SS-WRN-IDENTITY` and
`SS-WRN-GOVERNANCE`. Wren remains an independently stored and operated business
system. This change makes its original native business consumers use the
already-delivered binding project; it neither establishes a new permission
authority nor claims that instance isolation provides user authorization.

The pinned source is `.references/WrenAI-ui-0.32.2` commit
`c5f02a0391c87420dba78632dcd86073710deb72`. Verified paths and symbols:

- `wren-ui/src/apollo/server/repositories/projectRepository.ts`,
  `ProjectRepository.getCurrentProject`: original first-row selection.
- `wren-ui/src/apollo/server/resolvers/modelResolver.ts`,
  `ModelResolver.getModel`, `getView`, `updateModelMetadata`,
  `createCalculatedField`, `previewSql`, `createView`: original business
  callers and supplied native IDs.
- `wren-ui/src/apollo/server/services/modelService.ts`,
  `ModelService.getCalculatedFieldByRelation`: lineage consists of relation
  IDs followed by the input column ID, not only a terminal column.
- `wren-ui/src/apollo/server/services/askingService.ts`,
  `AskingService.getResponse`, `previewData`, `previewBreakdownData`: response
  lookup and its actual query consumers.
- `wren-ui/src/apollo/server/resolvers/dashboardResolver.ts`,
  `DashboardResolver.createDashboardItem`: existing response-to-dashboard
  consumer.

The existing `tools/upstream_manifest.py status data-query` and full
`diff data-query --stat` both exited 0 in a read-only SDK container. The pinned
HEAD still matches the manifest. Baseline full-tree output was 965 changed
files, 130606 insertions and 314 deletions; the expanded `wren-engine` upstream
gitlink accounts for most of that tree, so this is not a count of missing UI
pages. This batch's differences are authorized binding enforcement and its
evidence; it changes no native page, layout, menu or GraphQL field. The full
tree count is not evidence that all unrelated differences are classified or
that the whole product is restored.

Implementation impact and boundaries:

1. `common.ts` supplies the existing `loadQueryDelivery().projectId` to the
   actual `ProjectRepository` used by native services. A configured but empty,
   invalid, unreadable or removed delivery does not select the first database
   row. Missing bound projects are refused. An independently started native
   instance without this binding configuration retains its original setup.
2. Model/view read, edit, deletion and preview use the current project's ID.
   Metadata checks all supplied column, nested-column, calculated-field and
   relation IDs before its first write. Relation endpoints and every relation
   in a calculated-field lineage must belong to that project. An MDL hash must
   identify a deployment of that project. Original in-project implementations
   continue to perform the operations; no second model store is created.
3. `AskingService.getResponse` follows the real response-to-thread-to-project
   ownership chain. Saved-view creation, native SQL and the two answer previews
   reuse their already-selected project object. Dashboard creation also checks
   that its current dashboard belongs to that object before reading a response
   or querying data. Other direct `getResponse` consumers were checked:
   `AskingResolver.getResponse` may return null; `streaming_answer.ts` already
   rejects null before calling its native stream. Existing callers therefore do
   not disclose a foreign response after this read returns null.
4. The AI `previewSql` endpoint still supports its original explicit project
   argument in independent mode. With controlled delivery present it uses the
   verified current project object and rejects a foreign explicit ID. It does
   not re-fetch a requested project after checking the binding. The existing
   saved-view HUMAN Action, Gateway and PEP chain is unchanged.

Missing IDs and foreign native references are refused through original native
not-found errors (not a fabricated successful empty write). Delivery failure is
an unavailable dependency, never an alternate scope. No business terminal
state, retry, new Action, workflow, database column or platform contract is
introduced. Existing native mutation atomicity/idempotency is not upgraded by
these reference checks, and no new retry of native side effects is added.

Remaining release boundary: this is project-binding enforcement, **not**
complete instance-internal user/resource authorization or complete native
governance. The original Asking thread mutation/list/recommendation paths,
dashboard item-by-ID operations and other native business action admission
still need their actual consumer-level `SS-WRN-IDENTITY` /
`SS-WRN-GOVERNANCE` closure. A valid OIDC token or this project check cannot
be used as evidence that those paths are ready for unrestricted multi-user
release. Binding/generation changes across separate native service operations
are not made transactionally atomic by this batch.

Verification reused `kailo-wren-query-sdk-itgs2n` (4 CPU / 4 GiB, existing
immutable SDK image, dependencies and `/volumes/data` cache). Before execution
there was no competing compiler in that container, available host memory was
27 GiB and its OOM flag was false. No dependency install or image build ran.

```sh
./node_modules/.bin/jest --runInBand src/nativeProjectScope.test.ts \
  src/apollo/server/services/tests/projectRecommendation.test.ts
./node_modules/.bin/tsc --noEmit
```

The initial resolver test fixture omitted native required metadata fields and
failed TypeScript compilation; the next attempt expected properties without
the original persisted display name and had 1 failure / 24 passes. Both logs
are retained, not counted as successful verification. Corrected native
expectations then produced 27 passes and TypeScript exit 0. Cross-review found
the original nullable GraphQL `columnId` input; the guard now accepts null and
omission, with two actual resolver cases instead of changing the schema.

Four mutations in the private SDK removed bound-project selection, view scope,
lineage-prefix validation, and nullable-input handling. They produced **5
failed / 24 passed**, exit 1, including the real PostgreSQL first-row mismatch.
All seven implementation/test inputs were restored from formal source and
`cmp` returned 0 for each. The SQL test creates a fresh randomly named schema
in the existing isolated fixture and removes only that schema; it does not
touch a live Wren business project. In-project view read/edit/delete still use
their original repository operations.

Logs are under
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/`:
`native-project-scope-tests.log`, `native-project-scope-tests-corrected.log`,
`native-project-scope-tests-final.log`, `native-project-scope-types.log`,
`native-project-scope-mutation.log`, `native-project-scope-restored.log`, and
`native-project-scope-types-restored.log`.
Final restored result: **29 passed, 0 failed, 0 skipped**, two suites passed;
the complete Wren `tsc --noEmit` then exited 0, combined session 82068 exit 0.
This batch runs no full check, live browser/screenshot acceptance, image
publication, deployment or desktop/mobile acceptance; none is inferred from
these native backend checks.

## Native thread and dashboard reference consumers (2026-10-07)

This continues the preceding binding-project change under the same
`SS-WRN-IDENTITY` / `SS-WRN-GOVERNANCE` authority. The pinned upstream remains
`c5f02a0391c87420dba78632dcd86073710deb72`; the original
`wren-ui/src/apollo/server/services/askingService.ts` (`AskingService`),
`wren-ui/src/apollo/server/services/dashboardService.ts` (`DashboardService`),
`wren-ui/src/apollo/server/resolvers/dashboardResolver.ts`
(`DashboardResolver.previewItemSQL`), and
`wren-ui/src/apollo/server/services/mdlService.ts`
(`MDLService.makeCurrentModelMDL`) are extended in place. The native UI,
GraphQL fields, original background trackers, SQL/MDL implementations and
business repositories remain the original implementations.

Authority/impact review before implementation identified the following actual
consumers, not only GraphQL entrypoint names:

- Thread list already filters by native project. Thread read, update, delete,
  recommendation read/generation, follow-up history and response creation now
  resolve the thread and current project together. A foreign thread cannot
  supply history to `askingTaskTracker.createAskingTask`. Its existing last
  deployment and history use the same selected project.
- Every bare response-ID consumer in `AskingService` now calls the existing
  project-aware `getResponse`: rerun, SQL edits, breakdown, text answer, chart,
  chart adjustment, streamed-answer status, SQL clone and reasoning adjustment.
  The adjustment's existing supplied project ID must match the project used
  for the response. No second task table or registration authority is added.
- Dashboard item read/edit/delete, item listing and creation, layout changes
  and scheduling follow the item's actual dashboard-to-project ownership.
  All IDs in a layout batch are checked before the first write. Native SQL
  preview carries one selected project through the item, dashboard/cache
  setting and original query service. The original native scheduling behavior
  and its tests remain intact.
- Thread recommendation carries the same selected project into the real MDL
  service, so that service does not silently reload another current project
  while constructing the request. Its optional internal parameter preserves
  all original callers; it is not a new public API or binding field.

Foreign/missing native references are refused before external generation or
local mutation, using original not-found failure paths. Empty allowed threads
retain their original empty history, while a foreign thread is not disguised
as an empty allowed one. Invalid layouts still fail original validation; a
mixed-project batch cannot partially write its allowed prefix. Original
database failures and external UNKNOWN/retry semantics are unchanged: no
automatic replay or success receipt is introduced. Concurrent deletion,
native mutation atomicity and binding-generation revocation are not upgraded
to transactional platform authorization by these reads. Storage stays in Wren;
no schema migration or platform contract changes in this batch.

The previous section's thread/dashboard-by-ID gap is narrowed by these real
consumers, not declared universally resolved. Initial `asking_task` records
before thread binding have no durable native project field in the pinned
`wren-ui/src/apollo/server/repositories/askingTaskRepository.ts::AskingTask`.
Task-ID-only reads/cancel and attaching a first result therefore still need
proper native project attribution; this batch neither guesses that ownership
nor invents a platform task authority. Per-user resource authorization, model
dispatch admission, unbound recommendation/task IDs, and generation-aware
revocation remain release gaps. Retaining native screens does not prove those
missing governance consumers complete.

The existing upstream status and full-tree stat commands both exited 0 in the
read-only 1 CPU / 1 GiB SDK invocation; the pinned HEAD is unchanged. The
in-batch full-tree stat is recorded in `native-thread-dashboard-upstream.log`
(972 files, 131238 additions, 413 deletions at that point). As above, expanded
engine source accounts for most of the tree; this is not a page restoration
count. This batch only contains authorized project-binding adaptations and
post-implementation evidence, not invented replacement pages.

Verification reused the existing Wren SDK, 4 CPU / 4 GiB, UID 1000 and cached
dependencies. There was no competing SDK compiler, 23 GiB host memory was
available and the container's OOM flag was false. Commands after implementation:

```sh
./node_modules/.bin/jest --runInBand src/nativeProjectScope.test.ts \
  src/apollo/server/services/tests/askingService.test.ts \
  src/apollo/server/services/tests/dashboardService.test.ts
./node_modules/.bin/tsc --noEmit
```

The first 95 cases passed. The final input adds two real recommendation/MDL
consumer checks. Removing the thread and dashboard project predicates and
making the real MDL service ignore its selected project produced **12 failed /
85 passed**, exit 1. This included a wrong catalog from the real MDL builder,
not only a mocked entrypoint. All six source/test inputs were restored and
byte-compared with formal source (`cmp` exit 0). Final restored result:
**97 passed, 0 failed, 0 skipped**, three suites; full Wren TypeScript exit 0,
combined session 84262 exit 0. Original schedule/CTE cases passed unchanged
except that their existing project fixture now returns its actual project ID.
Original negative scheduling cases intentionally log their simulated errors.

Logs in the same private SDK directory as the preceding section:
`native-thread-dashboard-upstream.log`, `native-thread-dashboard-tests.log`,
`native-thread-dashboard-mutation.log`,
`native-thread-dashboard-restored.log`, `native-thread-dashboard-types.log`.
No full check, live model call, browser screenshot, deployment, image build or
new schema generation ran in this batch. Native service tests do not prove the
remaining task attribution, user authorization or release boundary complete.

## Native asking/adjustment task ownership (2026-10-07)

This closes the preceding unbound asking/adjustment task-ID reference gap in
Wren's own persistence, under `SS-WRN-IDENTITY` and `SS-WRN-GOVERNANCE`. The
fixed upstream is still `c5f02a0391c87420dba78632dcd86073710deb72`. Source
consumers rechecked at that commit include
`wren-ui/src/apollo/server/repositories/askingTaskRepository.ts::AskingTask`,
`wren-ui/src/apollo/server/services/askingTaskTracker.ts::AskingTaskTracker`,
`wren-ui/src/apollo/server/backgrounds/adjustmentBackgroundTracker.ts::AdjustmentBackgroundTaskTracker`,
`wren-ui/src/apollo/server/services/askingService.ts::AskingService`,
`wren-ui/src/apollo/server/resolvers/askingResolver.ts::AskingResolver`, and
`wren-ai-service/src/web/v1/routers/ask.py::ask` (the native server assigns
the query UUID). No platform registry, workflow authority, public GraphQL
field, shared contract or replacement screen is introduced.

Authority, impact, side effects and exception review led to these actual
changes after checking the original callers:

- The original `asking_task` gains required native `project_id`, not copied
  platform identity or content. Asking persists it immediately after an
  actual upstream query-ID acknowledgement; adjustment uses one native
  transaction for its task and response. `query_id` remains non-null and
  unique. No pre-dispatch placeholder, invented query ID or new task status
  is introduced.
- `AskingService` checks current project and original task type before both
  query-ID and record-ID reads, cancellation or attaching a result. A record-ID
  read follows its current persisted query rather than a stale memory index.
  Actual nested result view/SQL-pair reads also check native project; the
  existing response-view resolver validates the owned response and view.
- First thread/response creation and result binding use the original Knex
  transaction. Conditional binding on task ID, query ID, project and current
  binding prevents concurrent duplicate attachment; a losing transaction
  rolls back its speculative native thread/response. A repeat after a
  committed binding returns the existing entity, and a different target is
  refused. No speculative UI success or second task authority is added.
- Both original trackers persist updates against the same task/query/project.
  Final result and native answer SQL are committed in the same transaction
  after locking the current query; an old rerun result cannot overwrite the
  new query or resurrect a deleted task. Adjustment memory indexing now uses
  the actual task ID, not the response ID. Native reads after restart reattach
  the acknowledged query to the original polling loop; they never re-POST.
  Persistence failure retains observation eligibility instead of silently
  finalizing only the memory record. Unknown native statuses are not mapped
  to success or failure.

Migration `wren-ui/migrations/20261007000000_asking_task_project.js` executes
an expand/backfill/contract sequence in the normal Knex migration transaction.
Database joins find the first unprovable or contradictory thread/response
reference and report its task ID before schema writes. An operator must
reconcile that reference from evidence and rerun; there is no guessed default
project or deletion of old tasks. Backfill is set-based inside the database,
not an unbounded JavaScript array or per-task update loop. The same transaction
then enforces non-null ownership and its project foreign key. Old binaries
that omit project ownership cannot keep writing after this migration: stop
old writers before migration and deploy the corresponding native code as one
release. Down refuses to discard the ownership column while any task evidence
exists; rollback with records is not an approved compatibility window.

Deletion review at the task-ownership batch (the follow-up below changes this
nonterminal deletion behavior): pinned `wren-ui/src/components/settings/ProjectSettings.tsx::ProjectSettings`
confirms native reset and warns that settings and records are deleted.
`wren-ui/src/apollo/server/resolvers/projectResolver.ts::resetCurrentProject`
first calls `AskingService.deleteAllByProjectId` to delete native threads;
the original `20250509000000_create_asking_task.js::up` already cascades their
bound tasks. It then calls `ProjectService.deleteProject`. The new project FK
extends that native cleanup to acknowledged tasks not yet bound to a thread;
it is an additional deletion effect, not an identical old database constraint.
The existing `ProjectResolver.saveDataSource` failure cleanup also directly
deletes its newly created project; any concurrently created tasks would now
cascade too. No upstream-task cancellation is added by either deletion.
Native destructive reset is distinct from component offboarding, which must
not delete external business data, and from platform audit retention. This
batch does not demonstrate governed reset admission or retention acceptance
and remains undeployed. The rollback guard above prevents dropping the
ownership column with records; it does not claim native records are immortal.

This is still not complete fine-grained user authorization or model-execution
governance. Pre-ACK disconnection, a failure between upstream acknowledgement
and native persistence, and competing rerun dispatches have no original
client intent lookup/UNKNOWN reconciliation contract. This batch does not
pretend to recover their native side effect or automatically replay it. Those
remain `SS-WRN-GOVERNANCE` release gaps, alongside generation-aware revocation
and other unbound recommendation tasks. Existing native polling timing and
retention are reused; this is not a new platform expiry/reconciliation policy
or evidence that those remaining lifecycle gaps are production-ready.

Existing full-tree upstream status/diff commands exited 0 with the pinned
HEAD unchanged (`native-task-ownership-upstream.log`: 978 files, 132598
additions, 619 deletions at that point, including the already expanded engine
source). This batch's differences are authorized project-binding adaptations
and implementation evidence, not original page replacements. The full-tree
stat is not a claim that every other upstream difference has been restored.

Verification reused `kailo-wren-query-sdk-itgs2n`, 4 CPU / 4 GiB, UID 1000,
the existing immutable SDK image and cached dependencies. Before execution
there was no competing compiler in that SDK, host available memory was about
31 GiB, and its OOM flag was false. After implementation:

```sh
./node_modules/.bin/jest --runInBand --runTestsByPath \
  src/nativeTaskOwnership.test.ts src/nativeProjectScope.test.ts \
  src/apollo/server/services/tests/askingService.test.ts \
  src/apollo/server/services/tests/dashboardService.test.ts
./node_modules/.bin/tsc --noEmit
```

The first targeted run had **2 failed / 63 passed** because the new test
fixture used the wrong cancellation method name; it was corrected to the
existing `cancelAdjustThreadResponseAnswer`, not a new production API.
The PostgreSQL cases use the existing isolated test database and fresh random
schemas, run original table migrations plus this real migration, and exercise
legacy-refusal/retention, backfill, non-null/FK enforcement, concurrent
conditional binding, rollback of speculative entities and empty down/up.
They do not use a production database.

An additional actual SQLite attempt failed **5 cases** because this cached SDK
has the JavaScript `better-sqlite3` package but lacks its Node v137 native
`better_sqlite3.node` binary. The same run's **24 non-SQLite cases passed**.
That failure is retained in `native-task-ownership-databases.log`; SQLite
migration compatibility is not accepted by this batch, and no dependency or
image rebuild was performed to disguise that gap. Final checked-in database
cases target the deployed PostgreSQL path.

Removing the project predicate and conditional first-binding predicate only
in the private SDK copy produced **6 failed / 18 passed**, exit 1, including
actual double-binding and transaction rollback failures in PostgreSQL.
All eight production/test/migration inputs were restored and byte-compared
with formal source (`cmp` exit 0). Final restored outcome: **121 passed,
0 failed, 0 skipped**, four suites; whole-Wren `tsc --noEmit` exit 0 (combined
session 6419 exit 0). Logs in the same private SDK directory as above:
`native-task-ownership-tests.log`, `native-task-ownership-corrected.log`,
`native-task-ownership-regression.log`, `native-task-ownership-types.log`,
`native-task-ownership-databases.log`, `native-task-ownership-mutation.log`,
`native-task-ownership-restored.log`, `native-task-ownership-types-final.log`
and `native-task-ownership-upstream.log`. `git diff --check` passed.
No full check, production migration, live model call, browser/desktop/mobile
acceptance, image build or deployment ran in this batch.

## Preserve native task observation during destructive reset (2026-10-07)

Under SS-WRN-GOVERNANCE, this follow-up prevents deletion from erasing the
previous batch's acknowledged, nonterminal asking/adjustment evidence. The
fixed upstream remains `c5f02a0391c87420dba78632dcd86073710deb72`, rechecked
with read-only Git. At that commit,
`wren-ui/src/apollo/server/resolvers/projectResolver.ts::resetCurrentProject`
performs separate native deletes before calling the AI service;
`wren-ui/src/apollo/server/services/askingTaskTracker.ts::isTaskFinalized`
recognizes FINISHED, FAILED and STOPPED. These are asking-task states, not
proof that a database query has been cancelled (GAP-WRN-01).

The actual implementation and impact are:

- New original-Knex migration
  `wren-ui/migrations/20261007010000_preserve_running_asking_tasks.js::up`
  protects every direct or cascading `asking_task` delete. Only a persisted
  native terminal state permits deletion; missing, null and unknown states
  retain the record. This includes original thread/response cascades and
  `saveDataSource`'s direct project cleanup, not merely the reset button.
  PostgreSQL and SQLite use their native row triggers. No task table, status,
  platform authority or cancellation promise is added. Down refuses while
  any native task evidence remains; it does not silently remove protection.
- `AskingTaskRepository.findUnsettled` selects the first unresolved task of
  the exact project in the database. It does not load an unbounded task list.
  Before reset touches business data, `AskingService.assertProjectTasksSettled`
  reattaches that acknowledged query to its existing asking/adjustment polling
  loop and reports the task ID. It never re-POSTs or treats cancel acceptance
  as termination. Retry uses fresh persisted observation; original polling
  interval and retention remain unchanged. If upstream observation cannot
  establish a terminal state, reset remains refused and the reported query
  must be reconciled through the existing native result/operations path.
- All original reset database deletes now share one existing Knex transaction:
  schema changes, deployments, threads, views, relations/models and project.
  The four original service methods accept that transaction and pass it to
  the existing repositories. If a concurrent task makes a later cascading
  delete fail, earlier native deletions roll back. The final external AI
  cleanup is still outside the local database transaction; this change does
  not claim distributed atomicity or external cleanup reconciliation.
- Original screens and terminal-task reset remain available. This is an
  authorized execution-safety adaptation, not a removed reset feature or
  new workflow. Acknowledgement-before-persistence and pre-ACK concurrent
  project deletion still lack a native intent/lookup contract and remain
  release gaps. Other recommendation/native jobs, complete user authorization,
  component offboarding and audit-retention acceptance are not covered.

Implementation preceded verification in the existing cached Wren SDK
`kailo-wren-query-sdk-itgs2n`, 4 CPU / 4 GiB, no competing SDK compiler,
OOM false, about 30 GiB host memory available. No new snapshot or image was
created. The first run reported a new union-narrowing error and two incomplete
test fixtures; these were corrected without weakening types, and original
failure logs remain `native-task-deletion-tests.log` and
`native-task-deletion-types.log`.

Final commands used original Prettier, Jest and TypeScript:

```sh
./node_modules/.bin/jest --runInBand src/nativeTaskOwnership.test.ts \
  src/nativeProjectScope.test.ts \
  src/apollo/server/services/tests/askingService.test.ts \
  src/apollo/server/services/tests/dashboardService.test.ts
./node_modules/.bin/tsc --noEmit
```

Results: **127 passed, 0 failed, 0 skipped**, four suites; formatting check
and whole-Wren TypeScript both exit 0 (combined session 74245 exit 0).
Actual PostgreSQL checks cover direct task deletion, response/thread/project
cascades, null/unknown statuses, terminal-state deletion, competing state
updates, rollback of earlier native deletes, evidence-preserving down and
empty down/up. The resolver consumer checks the same transaction at each
original service and ensures external cleanup is not called after refusal.
Changing only the private PostgreSQL trigger to `IF FALSE` produced
**1 failed / 29 passed**, exit 1: the actual delete incorrectly succeeded.
All eight implementation/test/migration inputs were restored with bytewise
`cmp` exit 0 before the final run.

The SQLite migration SQL was also executed against the SDK's real in-memory
`node:sqlite` database: five nonterminal/null/malformed JSON cases rejected
both direct and project-cascade deletes; all three observed terminal states
permitted cascade (exit 0). This validates the new trigger SQL, not the missing
`better-sqlite3` ABI or a complete SQLite release migration run.

Logs are under
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/`:
`native-task-deletion-corrected.log`, `native-task-deletion-mutation.log`,
`native-task-deletion-restored.log`, `native-task-deletion-format.log`,
`native-task-deletion-types-corrected.log`, and
`native-task-deletion-types-final.log`. This SDK lacks the repository tools
and reference mounts: invoking `/workspace/apps/tools/upstream_manifest.py`
failed with file-not-found, so no new full-tree manifest result is claimed.
The fixed source reads and complete in-batch diff were reviewed instead.
No full check, production migration, live model dispatch, screenshot,
installation package, deployment or production-ready acceptance ran here.

## Original model preview through exact-resource HUMAN admission (2026-10-07)

This slice connects the existing model preview, not a replacement Wren UI and
not complete Wren authorization. Fixed source
`c5f02a0391c87420dba78632dcd86073710deb72` was reread at these full paths/symbols:

- `WrenAI-ui-0.32.2/wren-ui/src/components/pages/modeling/metadata/ModelMetadata.tsx::ModelMetadata`;
- `WrenAI-ui-0.32.2/wren-ui/src/components/pages/modeling/metadata/ViewMetadata.tsx::ViewMetadata`;
- `WrenAI-ui-0.32.2/wren-ui/src/apollo/server/resolvers/modelResolver.ts::ModelResolver.previewModelData`;
- `WrenAI-ui-0.32.2/wren-ui/src/apollo/server/services/queryService.ts::QueryService.preview`;
- `WrenAI-ui-0.32.2/wren-ui/src/apollo/server/utils/model.ts::getPreviewColumnsStr`.

Before this slice, the tracked ModelMetadata and QueryService blobs exactly
matched upstream (`bee2f1dd9991e7e453717abe01a8390e0857bef1` and
`08c78d61329690ebdaafe3b80560a5e037c07088` respectively). The proven missing
consumer was the model resolver's direct engine preview: unlike saved views,
it did not use HUMAN admission at all. The complete related UI/resolver/query
chain was compared; this is not a claim of a complete Wren repository diff.

### Authority, impact, side effects and boundaries

1. Authority: `.design/08` section 6 and DD-98 require model Resource `execute`,
   exact native references and one frozen native deployment. Wren owns model,
   columns, SQL, query engine and result history. No Core SQL/result table,
   native account registry, engine or parallel quota authority is introduced.
2. Impact: original ModelMetadata preview → generated GraphQL operation →
   ModelResolver → existing NativeHumanQuery → existing HUMAN action → existing
   adapter/NativeQueryService → original QueryService and api_history.
   The model operation now accepts the already-existing PreviewViewDataInput
   (id, optional limit, identity scope and retry key). Original local GraphQL
   codegen regenerated model.generated.ts and __types__.ts; other generated
   files did not change. Old model clients without admission fields fail closed;
   there is no old direct-query compatibility fallback. No database migration
   is needed. No platform contract is owned by this slice: the parent change
   supplies `AdapterPepCheckResponse.targetResource` through the existing PEP.
3. Side effects: the existing controlled humanAction Resource selection is not
   treated as proof that every native model belongs to it. For reference-based
   execution, the current PEP facts must exactly match resourceId, nativeType
   (`model`/`view`), nativeRef (canonical original integer id), nativeInstanceRef
   and nativeScopeRef (original project id). JWT extension fields cannot
   substitute these Core-returned facts. Missing/mismatched facts refuse before
   SQL. The same checks run immediately before SQL and before result disclosure,
   including replay of an already-completed request. A proven pre-SQL refusal
   uses the original history FAILED transition; result-time refusal preserves
   the true SUCCEEDED history without disclosing rows.
4. Boundaries: foreign-project ids, unknown identity, failed local retry-key
   persistence, missing delivery, absent target evidence and changed native
   content are refused. The original projection/generation/SpiceDB check stays
   in Core. Model columns and SQL are rebuilt with the original helper, hashed
   together with binding/project/connection/selection, and checked at execution;
   selection freezes the existing deployment id/hash, never silently latest.
   Changed/removed models refuse instead of running another query. UNKNOWN keeps
   one opaque sessionStorage key across remount; model/view with the same id and
   different people have distinct slots. SQL/results/credentials are not stored
   in browser retry state. A failed observation cannot mint a replacement key.

Difference classification for this chain:

- Original unchanged: model names, aliases, field/calculated/relation tables,
  preview placement, original result table/alias transformation and QueryService.
- Shared migration: saved-view identity/retry/result selection logic now lives
  in useGovernedPreview and is consumed by both original metadata components;
  the old inline implementation is removed.
- Authorized governance changes: preview dispatch and exact target verification,
  required original admission scope/key, existing Chinese/English query status
  messages, and frozen admitted deployment instead of unadmitted mutable MDL.
- Remaining gaps: arbitrary SQL/describe, Asking/dashboard/other native actions
  and per-user metadata reads are not closed by this slice. The single controlled
  humanAction Resource does not automatically register every model/view; only
  an actually matching registered object can execute. General resource discovery
  and native creation-to-registration must use the existing platform mechanism.
  Old saved-view records created before exact-target checks are not evidence of
  exact-object authorization. Full native UI release and production acceptance
  remain open; these limitations must not be reported as integrated completion.

### Actual verification and deliberate failure

Used the existing `kailo-wren-query-sdk-itgs2n`, 4 CPU / 4 GiB, its existing
dependencies/cache and isolated PostgreSQL fixture; no installation, new tree,
image build or deployment. Resource/process checks showed no competing command
inside this SDK and no cgroup OOM events. Initial cold dependency reading made
the first 74-case run take 226 seconds; it passed. The intermediate exact-target
run passed 80 cases. Final restored commands were:

```text
./node_modules/.bin/jest --runInBand src/nativeHumanQuery.test.ts src/nativeQuery.test.ts src/nativeProjectScope.test.ts src/viewMetadata.test.ts
Test Suites: 4 passed, 4 total
Tests:       82 passed, 82 total
Time:        18.026 s
exit 0

./node_modules/.bin/tsc --noEmit
no diagnostics; exit 0
```

The native query suite exercises the actual API handler, signed token, original
repositories/history and QueryService with a local HTTP engine/PEP fixture. The
engine fixture does not establish production database privileges or a live Core
SSO/approval/usage E2E. Original component-consumer tests exercise real preview
handlers with controlled GraphQL/config/storage boundaries, not a new screenshot
or deployed visual acceptance.

Two private mutations were actually rejected, then restored byte-for-byte:

- Collapsing the model/view retry slot caused 1 failed / 3 passed, exit 1; the
  model remount consumer observed a view stealing its original retry key.
- Removing nativeRef comparison caused 3 failed / 5 passed (14 intentionally
  filtered-out cases), exit 1: wrong-object execution, changed target before SQL
  and changed target before disclosure all became detectable failures.
- Both candidate files were restored; `cmp` against formal sources returned 0,
  then the final 82-case run and typecheck above passed.

Logs under the existing
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/`:
`model-preview-tests.log`, `model-preview-target-tests.log`,
`model-preview-mutation.log`, `model-preview-target-mutation.log`,
`model-preview-final-tests.log`, and `model-preview-final-types.log`.
The original GraphQL generator read the actual local schema via its existing
codegen configuration and exited 0. `git diff --check -- data-query` also exited
0. Full platform check, browser screenshot, published image and deployment are
not performed or claimed by this component slice.

## Registered native model/view selection without a global Resource (2026-10-07)

This slice supersedes the previous single-Resource `humanAction` selection,
not the historical commands/results above. The original UI still selects its
native model/view; Core resolves an existing platform reference rather than
asking an operator to configure one global Resource for all native objects.

### Authority, impact, side effects and boundaries

1. Authority: DD-98 keeps `catalog.resource` as the existing native-reference
   authorization directory. Wren's original model/view identifiers and business
   data remain in its own database. The fixed original source remains
   `c5f02a0391c87420dba78632dcd86073710deb72` in
   `/volumes/kailo/.references/WrenAI-ui-0.32.2`, particularly
   `wren-ui/src/apollo/server/resolvers/modelResolver.ts::ModelResolver` and
   `wren-ui/src/apollo/server/services/queryService.ts::QueryService`. No new
   frontend, directory, user table or resource-registration authority was added.
2. Impact: the existing service-authenticated `/service/v1/adapter/human-action`
   handler now accepts the mutually exclusive `resolveResource` request. The
   original independently verified HUMAN identity is retained. Core joins the
   exact active tenant/binding/runtime generation/native type/native reference,
   applies the original resource action catalog and scope facts, then evaluates
   the existing governance permission. The response carries the actual Resource
   id/version and bound native instance/scope. Existing submit/observe response
   shape is unchanged. Four generated languages and the existing native HUMAN
   sample/roundtrip checks include the new request and separate result.
3. Side effects: lookup does not create an AE, reserve quota, execute SQL or
   register a native object. The original submission rechecks permission,
   binding and Resource version and performs the existing governance chain.
   The returned reference is not an admission ticket. Wren rejects absent or
   mismatched id/version/type/ref/instance/scope before freezing or submitting.
   HTTP 404 is nullable only for a genuine original-idempotency-key observation,
   not for resource resolution.
4. Boundaries: zero or ambiguous directory matches fail closed; the SQL reads
   at most two rows to prove uniqueness, never chooses a first arbitrary match.
   Tenant/workspace mismatch, paused or changed binding/runtime generation,
   inactive resource, missing action and permission denial retain the existing
   INVALID_ARGUMENT/PERMISSION_DENIED/TARGET_STATE_CONFLICT/UNAVAILABLE paths.
   Concurrent changes are fenced again by original submission. Existing UNKNOWN
   actions are observed before any lookup and retain the exact frozen Resource,
   native object, limit and key even if directory mappings subsequently change.
   No new persistent intermediate state or cleanup lifecycle is introduced.

The controlled `humanAction` delivery now contains only
`resultExposurePolicyId` and `resultExposurePolicyVersion`. The retired
`resourceId`/`resourceVersion` keys are explicitly rejected rather than silently
used as a fallback. Release coordination must update the existing controlled
delivery with the new consumer; this is not a claim that an old running delivery
is compatible. Historical AE observation needs no fresh Resource selection.

### Implementation and real checks

The actual original model/view preview resolver still calls
`NativeHumanQuery.preview`; it observes the existing key, resolves only a new
intent, freezes the original native reference, and submits the original command
with the returned Resource version. Checks exercise two distinct registered
objects/keys, exact output facts, denied lookup, wrong submission Resource, and
UNKNOWN observation with no repeat resolution or native freeze. The existing
native handler/history/SQL fixture suite remains included.

Existing SDK `kailo-wren-query-sdk-itgs2n` retained its 4 CPU / 4 GiB cgroup and
local dependencies/cache. No install, new tree, build or deploy was performed.

```text
./node_modules/.bin/jest --runInBand src/nativeHumanQuery.test.ts src/nativeQuery.test.ts src/nativeProjectScope.test.ts src/viewMetadata.test.ts
Test Suites: 4 passed, 4 total
Tests:       92 passed, 92 total
Time:        20.825 s
exit 0 (final restored run)

./node_modules/.bin/tsc --noEmit
no diagnostics; exit 0
```

Private mutation removed the Wren resolved `nativeRef` comparison. The existing
invalid-facts group failed with 1 failed / 6 passed / 13 deliberately filtered
cases, exit 1: the changed native object incorrectly reached the later receipt
path. The comparison was restored; all four candidate source/test files matched
the formal files (`cmp` exit 0), followed by the 92-case restored run above.
Logs reside in the existing
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/`:
`resource-selection-tests.log`, `resource-selection-types.log`,
`resource-selection-mutation.log`, and `resource-selection-restored.log`.

Core's new
`application_native_human::tests::native_resource_selection_uses_exact_registered_scope_and_original_action_facts`
uses the existing migrated isolated database: base and dispatch fixtures execute
inside one outer transaction and roll back. Mainline actually ran it with
`--ignored`: 1 passed. It rejects foreign type/ref/action, workspace, tenant,
binding, runtime generation and native scope while retaining the original
resource version and permission. Mainline owns the centralized Core/four-side
verification and its logs; this component receipt does not claim a live
SSO/SpiceDB/Temporal/engine/usage E2E from local handler fixtures.

Mainline also removed the exact native-reference SQL condition in its private
candidate and ran this same isolated test: it failed at the `nativeRef`
assertion, exit 101. After restoring the condition, the test again reported
1 passed. The check therefore detects cross-object lookup, not only valid
fixture acceptance. The existing resource-limited SDK ran `rustfmt`, `gofmt`
and `dart format` successfully; only the added native-human roundtrip snippets
were transferred back, with a separate current-index patch so unrelated dirty
tests are not included in this batch.

### Explicit remaining delivery gaps

Registered, authorized models/views can now select their own existing Resource;
unregistered native objects still cannot execute. Native object creation to
Resource registration, arbitrary SQL/describe, Asking/dashboard governance,
per-user native metadata reads, full iframe deployment and browser acceptance
remain separate open work. No original page or menu was removed/reordered, and
no screenshot or production release is claimed for this source-only slice.

## 2026-10-08 — original model/view metadata readers consume Resource read authorization

### Authority, complete module comparison and impact

1. Authority: DD-98 and `.design/08` §6 keep Resource/SpiceDB authorization
   authoritative. The registered `data_query.describe@v1` action uses `read`;
   query execution permission cannot substitute for metadata read. The fixed
   official source remains `c5f02a0391c87420dba78632dcd86073710deb72`,
   `wren-ui/src/apollo/server/resolvers/modelResolver.ts::ModelResolver`.
   The complete module was compared, not only this batch's changed methods.
   Original serialization, repositories, columns, nested columns, display names
   and relation representation remain; previously authorized query/project
   admission changes remain. The previously missing object authorization is
   now added to `listModels`, `getModel`, `listViews`, and `getView`, without
   changing GraphQL schema, pages, layout or adding another object registry.
2. Impact: those four original readers call the existing HUMAN resource-selection
   path through `canReadNativeMetadata`. `NativeHumanQuery.preview` reuses the
   same exact-object resolver with its original query action, retaining receipt
   observation before selection and the existing UNKNOWN retry intent. Native
   model/view tables remain the business authority; Core returns only registered
   reference facts. No new schema, storage, execution state or public endpoint
   was introduced by this Wren slice.
3. Side effects: this metadata path does not run SQL, submit an ActionExecution,
   copy business bodies into Core, cache another user's authorization or reuse
   a global configured Resource. Both relationship endpoint models must be
   readable in the current native project. Assembled model/list metadata is
   rechecked before return rather than relying only on an earlier authorization.
4. Boundaries: missing HUMAN identity, stale/mismatched exact object facts,
   service authentication failure, binding/scope refusal and transport failure
   fail closed. Zero authorized models and zero columns do not reach the
   original repositories' empty-filter/all-rows behavior. Only a complete valid
   `contracts/domain/error.schema.json` response with `DENIED` and
   `PERMISSION_DENIED` filters an object from a list. Direct detail denial is an
   error. Bounded body reading also applies to unsuccessful Core responses;
   malformed/empty bodies cannot be mistaken for a successful empty list.

The full original module diff is preserved as `native-metadata-original-module.diff`
in the existing candidate evidence directory below. Upstream-manifest status
confirmed the fixed Wren source; it did not replace source with a newer version.

### Actual verification and corrective review

The existing `kailo-wren-query-sdk-itgs2n` SDK was inspected before use:
4 CPU / 4 GiB cgroup, no other process besides its idle supervisor, with existing
dependencies/cache. No dependency install, new snapshot, image build or release
was performed. Implementation preceded the added consumer checks.

The first four-suite run passed 98 tests and TypeScript passed. Cross-review
then found a real error-classification defect: HTTP 403 from the SERVICE-token
endpoint or from a Core scope/binding failure could be misclassified as an
object permission denial and silently hide the list. The transport now marks
only the validated Core ErrorBody permission denial; SERVICE token failure is
unavailable authorization, not denied-object evidence. The new HTTP test calls
the real metadata helper and actual token/Core HTTP transport, not a mocked
`bindingServiceCall`. It exercises permission denial, scope failure, blocked
binding, empty/malformed/extra-field bodies, invalid optional operationId,
SERVICE-token failure, service unavailability and valid resource facts.

Final restored command, inside that SDK at `/work`:

```text
./node_modules/.bin/jest --runInBand src/nativeHumanQuery.test.ts src/nativeQuery.test.ts src/nativeProjectScope.test.ts src/viewMetadata.test.ts
Test Suites: 4 passed, 4 total
Tests:       99 passed, 99 total
Time:        13.949 s
exit 0

./node_modules/.bin/tsc --noEmit
no diagnostics; exit 0
```

Private candidate mutations were actually executed and restored:

- Replacing metadata authorization with unconditional acceptance caused six
  resolver consumer failures (6 failed / 45 passed), exit 1.
- Treating token endpoint 403 as an object refusal caused the real HTTP test
  to resolve `false` instead of reject, exit 1.
- Removing the structured permission-denial condition from the metadata
  consumer caused the Core scope-failure case to resolve `false` instead of
  reject (1 failed / 23 deliberately filtered), exit 1.

All five changed TypeScript source/test files were compared between formal and
candidate trees after restoration (`cmp`, each exit 0). Existing Prettier ran
on the modified service helpers and project-scope consumer tests. Evidence:
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/`
contains `native-metadata-tests.log`, `native-metadata-mutation.log`,
`native-metadata-transport-tests.log`, `native-metadata-transport-mutation.log`,
`native-metadata-errorbody-tests.log`, `native-metadata-errorbody-mutation.log`,
`native-metadata-restored-tests.log`, and `native-metadata-final-types.log`.

Mainline separately corrected Core's existing resource-selection path to use
the registered action's Governance read evaluation rather than require a
TEMPORAL execution action. Its PROTOCOL/read isolated SQL check passed;
privately restoring the old execution-only restriction failed (exit 101), then
restoring the correction passed. Submit/fresh execution retains its existing
execution-specific conditions. Mainline owns that Core verification evidence.
Mainline's centralized original `./tools/check-docs.sh` also exited 0 in the
existing local-image, offline-cache 2 CPU / 2 GiB checking container. The full
`./tools/check.sh --full` was not run for this batch; no release was deployed.

### Remaining delivery limits

Only these four original metadata readers now consume per-user Resource read
authorization. Native creation-to-Resource registration for REMOTE_ADAPTER is
still incomplete; unregistered objects remain refused, not auto-approved.
Deployment/MDL, Asking/dashboard, native management writes, arbitrary SQL and
complete live iframe/SSO acceptance are not proved by this batch. The original
pages remain intact. This is source and consumer verification, not a production
deployment, screenshot acceptance or a claim that Wren is fully integrated.

## 2026-10-08 — original modeling diagram consumes complete Resource read grants

### Authority and complete consumer impact

1. DD-98, SS-WRN-IDENTITY / SS-WRN-GOVERNANCE and `.design/08` §6 keep
   native model/view data in Wren and map metadata read to the existing
   `data_query.describe@v1` Resource permission. Fixed official baseline:
   `c5f02a0391c87420dba78632dcd86073710deb72`,
   `wren-ui/src/apollo/server/resolvers/diagramResolver.ts::DiagramResolver.getDiagram`.
   Before this batch that entire resolver file was byte-identical to the fixed
   official file; its complete query/transform/return chain was reviewed. The
   original graph builder and all field/relation/view transformations remain
   unchanged. Only necessary admission, source-scope checks and empty-filter
   protections were added; no node, field, relation or page was removed.
2. The real original consumer is `wren-ui/src/pages/modeling.tsx::Modeling`,
   `useDiagramQuery` from `wren-ui/src/apollo/client/graphql/diagram.generated.ts`,
   mapped by `wren-ui/src/apollo/server/resolvers.ts::Query.diagram`. The resolver
   captures native model/view integer IDs from the selected project once,
   authorizes every constituent with the existing exact Resource resolver,
   reads the original column/nested-column/relation dependencies, then repeats
   authorization immediately before its original synchronous MDL/diagram
   build. No name-based mapping or second model/view read substitutes for the
   captured objects. No Core contract, table, ResourceType or ActionDefinition
   changes are needed.
3. This remains a complete graph, not a filtered replacement: if any constituent
   model/view is denied, unavailable or has mismatched facts, the whole graph
   read fails. Trimming nodes would invalidate original relationship and
   calculated-field dependencies. Source model/view project, column ownership,
   nested-column ownership and both relation endpoints must match the captured
   scope. No AI service, engine call, business SQL execution, action submission
   or extra persistence is added. All business bodies stay in the native service.
4. Empty original model sets skip column and relation calls whose empty filters
   otherwise read all rows. A genuinely empty authorized native dataset keeps
   its original empty graph; refusal is never converted to that result. Missing
   identity/token, mixed project/model/view/column/relation scope and revocation
   during awaited dependency reads have explicit rejecting consumer evidence.

The original modeling page previously consumed only Apollo `data` with
`cache-and-network`. An error could retain a previously cached graph or leave
an initial refusal loading forever. It now consumes `error`, uses `no-cache`
for fresh object admission, and shows its existing `ErrorCollapse` in the
original `SiderLayout`. Failed reads do not render the old graph/sidebar data
or metadata drawer, and clearing diagram data closes that drawer's old state.
Successful rendering retains the original page/graph/dialog implementation;
there is no new summary page, custom error wording or simplified graph.

### Evidence

Existing SDK `kailo-wren-query-sdk-itgs2n` was inspected idle at 4 CPU / 4 GiB
cgroup before checks; existing dependencies/cache were reused without install,
new snapshot or build. Implementation preceded consumer tests. An initial test
compile caught four accesses to a transport payload typed `unknown`; these
test assertions were corrected to compare complete actual request values.
The real original MDL builder then passed the complete 63-case project-scope
suite; actual `Modeling` component rendering passed three success/error cases.

Restored combined run before the subsequent page-host correction below, inside `/work`:

```text
./node_modules/.bin/jest --runInBand src/nativeHumanQuery.test.ts src/nativeQuery.test.ts src/nativeProjectScope.test.ts src/viewMetadata.test.ts src/modeling.test.ts
Test Suites: 5 passed, 5 total
Tests:       114 passed, 114 total
Time:        13.81 s
exit 0

./node_modules/.bin/tsc --noEmit
no diagnostics; exit 0
```

Private mutation removed the final `authorizeDiagram` call: the original
complete-data test and revocation test both failed (2 failed / 10 passed /
51 deliberately filtered), exit 1. After restoring it, disabling the page's
error branch failed both refusal-rendering cases (2 failed / 1 passed), exit 1,
showing the old metadata drawer and permanent loading instead of the existing
error component. Both private mutations were restored before the final 114-case
run; all four changed TS/TSX files matched the formal tree (`cmp`, exit 0).
Prettier was applied to the new/modified tests and resolver; `git diff --check`
also exited 0. Evidence is in the existing
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/`:
`native-diagram-format.log`, `native-diagram-tests.log`,
`native-diagram-mutation.log`, `native-diagram-page-tests.log`,
`native-diagram-page-mutation.log`, `native-diagram-restored.log`,
`native-diagram-types.log`.

### Precise remaining boundary

`ModelResolver.getMDL` / `DeployService.getMDLByHash` historical manifest read
is not fixed by this change. In the same fixed official source,
`wren-ui/src/apollo/server/mdl/mdlBuilder.ts::MDLBuilder.addModel` stores model
referenceName/display properties but no model integer ID, whereas `addView`
stores `properties.viewId`. `Deploy` in
`wren-ui/src/apollo/server/repositories/deployLogRepository.ts` stores the
original manifest/hash/project, not a historical model-to-Resource map.
Current same-name models therefore do not prove historical source ownership.
Historical metadata reading is not equivalent to immutable-version query
execution; no current-only restriction was invented, and no unsupported grant
was inferred. That exact provenance/authorization gap remains recorded rather
than being reported as solved. Original management writes, AI/Asking, live
iframe integration and first Resource registration also remain outside this
slice. No screenshot, full global check, release build or deployment is claimed;
the component-rendering evidence is not browser/device acceptance.

### Cross-review correction: preserve the original creation host on read failure

Mainline review found that the first page error implementation returned early
with a separate `SiderLayout`. It kept the sidebar's `onOpenModelDrawer` callback
but unmounted the original `ModelDrawer`, producing a dead create button when
diagram reads failed. That implementation is removed. The original single
DeployStatus Provider / SiderLayout and all original modal/drawer hosts remain;
only the graph content changes to the existing ErrorCollapse on read failure.
Old graph-dependent drawers/dialogs are not visible without readable graph data,
while the original model CREATE drawer still receives the original sidebar
callback and submits through the original mutation. Clearing graph data closes
the old model EDIT drawer rather than reusing its prior default value.

The actual Modeling component check now follows sidebar open → mounted
ModelDrawer visibility → original onSubmit → useCreateModelMutation, even with
a diagram error. A private mutation unmounted only that ModelDrawer during
error: the new consumer failed with `mockModelDrawer` undefined (1 failed /
3 passed), exit 1. The host was restored before the final narrow rerun. Evidence:
`native-diagram-host-tests.log`, `native-diagram-host-mutation.log`,
`native-diagram-host-restored.log`, and `native-diagram-host-types.log` in the
same existing candidate directory. Backend code did not change after its
combined 114-case run; this page correction is verified separately rather than
misreporting the earlier combined result as a later page check.

Final correction verification: `jest --runInBand src/modeling.test.ts` reported
1 suite / 4 tests passed, 6.543 s, exit 0; `tsc --noEmit` produced no diagnostics
and exited 0. The four changed TS/TSX files again matched their restored
candidate copies (`cmp`, exit 0), and `git diff --check` exited 0.

## 2026-10-08 Original modeling schema-change read integration

### Authority, complete same-page impact and unchanged ownership

The fixed official baseline remains Wren
`c5f02a0391c87420dba78632dcd86073710deb72`, full paths
`wren-ui/src/apollo/server/resolvers/projectResolver.ts::ProjectResolver.getSchemaChange`,
`wren-ui/src/apollo/server/managers/dataSourceSchemaDetector.ts::DataSourceSchemaDetector.getAffectedResources`
and `wren-ui/src/components/sidebar/modeling/ModelTree.tsx::ModelTree`.
The original detector and complete returned impact structure are retained;
only the original reader's admission and its real sidebar failure consumer
change. This is an authorized SS-WRN-IDENTITY / SS-WRN-GOVERNANCE seam under
`.design/07` §4.6 and `.design/08` §6 (`data_query.describe@v1` / `read`), not
a replacement modeling page or an additional ActionDefinition.

The full two-module diff against that commit was reviewed, not only the current
working diff: ProjectResolver is +79/-13, ModelTree +23/-6. Unchanged original
functions, detector computation and UI nodes are original-preserved. This
batch's exact read checks and failed-read UI handling are authorized governance
adaptation; there is no shared migration in these native Wren files. The two
earlier ProjectResolver differences remain: original project reset now checks
settled tasks and shares a native transaction, and recommendation generation
requires confirmed deployment SUCCESS. They are existing side-effect/terminal
evidence protections, not omitted functions or new UI. Missing native write
authorization and historical MDL provenance remain explicitly unrestored below.

The whole same-page call inventory was checked before this edit: diagram,
model/view list and detail readers already consume exact native Resource read
facts. `ModelTree` additionally consumes `getSchemaChange`, which reads an
existing native schema-change record and uses the synchronous original impact
detector. By contrast `ModelResolver.checkModelSync` reaches
`DeployService.getInProgressDeployment` / `observe`, which contacts the
original external deployment adaptor and may update native deployment logs;
`ModelForm`'s `listDataSourceTables` reaches the data source. Neither is relabeled
as a pure metadata read or claimed covered by this batch. Historical
`getMDL(hash)` retains the distinct provenance gap described above; no
current-only restriction was introduced.

Four-step change boundary:

1. Authority: original Wren repositories own schema changes, models, columns
   and relationships. Existing Core Resource selection and SpiceDB decide
   per-user read permission. Login/instance entitlement is not this permission.
2. Impact: only the existing GraphQL schema-change reader and its original
   sidebar consumer change. No schema, table, generated contract, platform
   permission, write path, workflow or second resource directory is introduced.
   Web/Desktop component hosts render this same native page; Mobile remains
   non-host. The GraphQL result and original detector inputs keep their shape.
3. Side effects: no new SQL execution, AI request or mutation. The complete
   captured model set must pass describe read before dependent rows are loaded
   and again before the original synchronous result computation. Permission
   denial is not converted to a partial apparently complete impact report.
4. Boundaries: missing identity/token, foreign configured project or snapshot
   rows, unavailable/unknown authorization and revocation fail closed. Empty
   model sets do not call the original unbounded empty-filter repositories.
   Cross-model columns and relations with foreign endpoints are refused.
   No-change keeps the original null fields. On client read error the original
   ErrorCollapse replaces stale review data; the native tree, create/detection
   callbacks and modal host remain mounted. No new persistent intermediate
   state or reconciliation obligation is introduced.

### Native management permission gap (not a new restriction)

`.design/03` §5 already defines `create/update/delete/manage`; a nonexistent
top-level Resource is created under Workspace.create (or Tenant.create), not
by checking the nonexistent Resource. `.design/04` §7 and `.design/08` §6
also explicitly preserve native management and do not turn every internal
modeling API into a platform Action. Therefore the missing implementation is
not an absent permission vocabulary: `middleware.ts` only verifies instance
entitlement, and `pages/api/graphql.ts` passes the verified human token plus a
non-authorizing identity-storage partition. Original `ModelResolver.createModel`
and `createView` still lack a complete native user/project management permission
consumer. Query execute or model describe cannot stand in for that grant.
The separate platform `resource.create` path registers a verified existing
native reference and is not authorization to create the native model itself.
This batch neither adds a role database nor claims those write chains complete.

### Implementation-following verification

Validation used only the existing Wren SDK and installed cache, checked at
4 CPU / 4 GiB before execution; no new snapshot, dependency installation or
image build. The first combined invocation was stopped with exit 143 after
XFS reads stalled while loading unrelated icon packages. The consumer test
now isolates only the unused node-type icon renderer, retaining the real
ModelTree/query/error/modal/button consumers. This is a test-harness change,
not a production behavior change or a successful first run.

`jest --runInBand src/nativeSchemaChange.test.ts src/modelTree.test.ts` then
passed 2 suites / 16 tests, 75.86 s, exit 0. The original detector is executed
for column, relationship and calculated-field impacts. Cases also include
resource denial, read-time revocation, foreign model/column/relation/change
rows, empty directories, missing token/scope, wrong project, original no-change
shape, and the actual sidebar's stale-data rejection with creation/detection
callbacks still usable.

Private fault injection deleted the final model-read recheck and restored
unconditional stale query data forwarding. The same consumers failed: 4 failed
/ 12 passed, exit 1, 100.513 s. In particular, revocation incorrectly resolved
with the old impact result and the modal received private old data. Both faults
were restored, and all four TS/TSX files matched formal source with `cmp` before
the combined restored regression/type check. Logs are in the same existing
candidate directory: `native-schema-format.log`, `native-schema-tests.log`,
`native-schema-mutation.log`, `native-schema-restored.log`, and
`native-schema-types.log`. This evidence is not a browser screenshot, native
management-write acceptance, full global check, release or deployment.

The final restored command
`jest --runInBand src/nativeSchemaChange.test.ts src/modelTree.test.ts src/nativeProjectScope.test.ts src/modeling.test.ts`
passed 4 suites / 83 tests in 68.151 s, exit 0. The following `tsc --noEmit`
produced no diagnostics and exited 0. `git diff --check` also exited 0.

## Binding wire versions and actually consumed SERVICE credential (2026-10-08)

This batch repairs the existing `NativeBindingService.call` and original
Next platform-adapter/MCP consumers, not a new binding service or a replacement
Wren UI. The pinned upstream remains
`c5f02a0391c87420dba78632dcd86073710deb72`:
`wren-ui/src/apollo/server/repositories/projectRepository.ts::ProjectRepository.getCurrentProject`
is the original current-project selector, and
`wren-ui/src/apollo/server/dataSource.ts::encryptConnectionInfo` /
`toIbisConnectionInfo` are the original credential transformations. Their actual
consumers are retained. The adapter files are authorized Kailo lifecycle and
query-governance seams, not upstream-provided platform behavior.

Four-step implementation boundary:

1. Authority: the existing ComponentRelease / ApplicationBinding documents,
   action catalog and OpenBao audit receipts remain authoritative. Core compares
   handshake/validation `artifactDigest` to `adapterBuildRef`; this value is the
   existing bare lowercase SHA-256 digest, not an OCI-prefixed string. Registered
   Wren action keys include `@v1`; the original MCP tool names do not. Native
   project and encrypted connection data remain in Wren's own database.
2. Impact: the controlled binding delivery now selects its two exact SecretRefs
   with `connectionSecretKey` and `serviceSecretKey`, plus their KV paths. The
   same immediate Agent Unix API reader consumes each fixed version and returns
   its real request ID. The existing SERVICE credential file used by PEP must
   equal the SERVICE KV value. Old incomplete binding delivery is refused; no
   secret, credential body, new table or new contract is persisted in Core.
   Machine execute now consumes the registered versioned action keys; the MCP
   route maps its existing fixed tool names to those same keys. Signed token
   action equality remains exact rather than stripping a version.
3. Side effects: handshake performs no secret or database read. Validation
   performs the original read-only native role inspection and immediate secret
   reads; it does not create/alter native users, grants or data. After fresh Core
   PEP, project connection fingerprint, controlled binding delivery and the
   actually consumed SERVICE file are checked again. Audit role/path/version/
   audience and AE-time freshness remain Core's checks, not locally fabricated
   evidence. There is no added SecretStore client, template cache or authority.
4. Boundaries: wrong isolation/project, missing or mismatched SERVICE value,
   duplicate request IDs, malformed/deleted/destroyed/version-mismatched KV
   data, native write privilege, fresh PEP denial or changed delivery are
   refused. Existing query UNKNOWN/no-replay and result reauthorization are
   preserved. Web/Desktop show the original component UI; Mobile is unchanged.
   This adds no durable intermediate state or reconciliation queue.

The native project-management gap above remains: Workspace.create for a new
platform Resource is not established authorization for every native Wren
project write, data-source read or another human's thread response. No new
permission mapping, create endpoint or role store was invented in this batch.
The complete native creation target remains open, separately from this binding
validation correction.

Implementation-following validation uses the existing 4 CPU / 4 GiB Wren SDK,
installed dependencies and isolated PostgreSQL fixture; no new snapshot,
package installation, frontend build or image build. The actual Next handler,
MCP SDK and native QueryService suite `jest --runInBand src/nativeQuery.test.ts`
passed 24 tests / 1 suite, exit 0, 106.678 s. It includes the Unix Agent API
fixture and real native role checks, actual HUMAN model/view execution, exact
target refusal, repeat/UNKNOWN behavior and result revocation. This does not
claim a production OpenBao audit or production binding activation.

Private fault injection removed the SERVICE file equality check and regressed
signed action matching to an unversioned action. The two targeted actual
consumers failed (2 failed / 22 intentionally skipped, exit 1, 90.869 s): the
wrong credential returned HTTP 200 instead of 403, and the original valid MCP
query returned QUERY_SCOPE_DENIED. Both faults were restored; all four candidate
TS files matched formal source via `cmp` before the final regression.
Logs: `native-binding-wire-format.log`, `native-binding-wire-tests.log`,
`native-binding-wire-mutation.log`, `native-binding-wire-restored.log`, and
`native-binding-wire-types.log` in the existing Wren SDK candidate directory.
This batch is not full global validation, a browser screenshot, release,
deployment or complete native management acceptance.

The final restored `jest --runInBand src/nativeQuery.test.ts` passed 24 tests /
1 suite in 104.214 s, exit 0; the immediately following `tsc --noEmit` produced
no diagnostics and exited 0. `git diff --check -- data-query` exited 0. The
parent's already completed documentation check is separate shared-batch
evidence; this agent did not rerun the global check or claim `--full` passed.

## Saved-view query-reference HUMAN authorization (2026-10-08)

The deployment-input pass found no additional producer to update: the optional
query overlay already mounts controlled `query.json` / `binding.json` and uses
the original Agent's immediate Unix proxy. It does not manufacture those
authoritative lifecycle documents. The actual remaining consumer defect was
the existing `/api/platform-query-reference` handler: instance middleware did
not propagate a verified human token there, and the handler froze a view with
the browser's arbitrary Resource ID without consuming per-object authorization.

The fixed upstream is Wren
`c5f02a0391c87420dba78632dcd86073710deb72`, full path
`wren-ui/src/components/pages/modeling/metadata/ViewMetadata.tsx::ViewMetadata`
and its `onPreviewData` callback. The complete native metadata/preview layout
was compared: name, description, columns, SQL statement and original preview
remain. The pre-existing query-reference export is a Kailo governance addition,
not an upstream control. This batch preserves that real function but removes
its obsolete manually entered platform-ID field and its two dead translations;
the row-limit, export action and frozen-reference result remain unchanged.
No unrelated original page or action was removed, redesigned or reordered.

Four-step implementation boundary:

1. Authority: Resource identity and query permission come from the existing
   Core `human-action.resolveResource` consumer for `data_query.query@v1`.
   This reuses DD-98 native-reference correspondence and the already established
   HUMAN query selection, not a new permission or resource directory. The
   original native view/deployment remain owners of the frozen query reference.
2. Impact: only the existing reference API is added to the middleware's private
   verified-token forwarding set; it is not exempted from authentication.
   That API and existing preview consumer share `resolveNativeResource`.
   The export request now accepts only view ID and row limit. Existing requests
   carrying a guessed Resource ID fail rather than using a compatibility bypass.
   No contract/table/Core/Worker/AgentGateway registration changes are needed.
3. Side effects: object selection runs before native reference construction and
   again before disclosure. Both observations must identify the exact same
   current Resource/version/instance/scope. This is a read/export only: no SQL,
   native mutation or ActionExecution is submitted. Real execution still passes
   through the existing permission, approval, quota and terminal-evidence chain.
4. Boundaries: absent trusted token, malformed IDs/limit, injected Resource ID,
   unregistered object, denial, unavailable authorization, revocation or changed
   Resource/version refuse the export. The original UI retains its pending,
   error and selection-change response fence. The API keeps no identity or
   permission cache and adds no persistent state. Native project management
   write authorization remains an independent open gap, not implicitly granted
   by this export or by instance login.

Checks added after implementation exercise the real Next reference handler and
the real shared resource resolver, with the native freeze operation isolated;
the existing native query suite separately covers actual native repository
reference construction. Middleware consumers use signed tokens and a real JWKS
HTTP endpoint. The original ViewMetadata consumer verifies that the obsolete
platform-ID field is absent while preview remains. These are not browser,
production database, deployment or full-global-check acceptance claims.

The existing 4 CPU / 4 GiB Wren SDK was idle before validation, with no new
tree or dependency installation. After implementation,
`jest --runInBand src/nativeHumanQuery.test.ts src/middleware.test.ts src/viewMetadata.test.ts`
passed 3 suites / 83 tests, exit 0, 171.856 s (cold source/dependency reads).
The following `tsc --noEmit` produced no diagnostics and exited 0.

Private mutation removed the final Resource/version comparison and the new
verified-token forwarding. The real consumers failed: 3 failed / 76 targeted
skips, exit 1, 7.009 s; changed-resource and changed-version exports returned
HTTP 200 instead of 409, and the reference route received no verified human
token. Both changes were restored, and all eight changed source/test files
matched formal source via `cmp`. The same full three-suite command then passed
83/83 in 7.384 s, exit 0. `git diff --check -- data-query` exited 0.
Logs are `native-reference-access-tests.log`, `native-reference-access-types.log`,
`native-reference-access-mutation.log` and `native-reference-access-restored.log`
in the existing Wren SDK candidate directory. No new release was built or
deployed; this does not claim full-global-check or browser acceptance.

## Historical MDL captured-object authorization (2026-10-08)

This slice closes the actual historical `getMDL(hash)` consumer rather than
adding another login check or replacing a native page. The fixed official
source was rechecked read-only at
`c5f02a0391c87420dba78632dcd86073710deb72`:
`wren-ui/src/apollo/server/services/mdlService.ts::MDLService.makeCurrentModelMDL`,
`wren-ui/src/apollo/server/repositories/deployLogRepository.ts::DeployLogRepository`,
`wren-ui/src/apollo/server/services/deployService.ts::DeployService.getMDLByHash`
and `wren-ui/src/apollo/server/resolvers/modelResolver.ts::ModelResolver.getMDL`.
The original manifest has model names, not model IDs; a historical name cannot
prove which present-day native model a person is allowed to read. The original
second unscoped hash lookup could also select a deployment other than the
project-scoped row already checked by the resolver.

Four-step implementation boundary:

1. Authority: DD-12 and SS-WRN-IDENTITY/SS-WRN-GOVERNANCE retain native project,
   model, deployment and business-content authority in Wren. Object read
   permission reuses Core's existing HUMAN `resolveResource` consumer for
   `data_query.describe@v1`, its exact binding/native-instance/project reference
   and the verified current human. There is no second resource registry,
   permission engine, identity store or copy of manifest content in Core.
2. Impact: the original MDL builder returns native model/view IDs and names
   from the same rows used to build its unchanged manifest. Both existing
   explicit and onboarding deployment callers pass that capture into the
   original deployment transaction. The native-only migration adds nullable
   `deploy_log.native_object_refs`; the original repository serializes that
   JSON array explicitly for PostgreSQL and decodes it alongside the original
   manifest. The MDL/hash, GraphQL schema, generated client types, pages and
   model/AI/Engine interfaces keep their original shape. No platform contract
   or four-language generation changes are required. The unscoped
   `getMDLByHash` implementation and its only old call path are removed.
3. Side effects: deployment validates the capture before durable intent or
   native dispatch and stores it in the same original transaction. Historical
   reads validate exact names/IDs, object counts and native view ID evidence,
   authorize every captured object, reread the exact project/hash/deployment,
   then reauthorize every Resource/version before encoding that same manifest.
   No SQL, new ActionExecution, Temporal workflow or external write is invoked
   by the history read. Existing deployment UNKNOWN observation, idempotency
   and successful-hash reuse remain; a reused hash keeps its original capture.
4. Boundaries: absent verified human/binding, unregistered objects, denied or
   unavailable authorization remain errors. Missing/legacy/malformed captures
   return `QUERY_EVIDENCE_UNAVAILABLE`, never same-name inference; revocation
   and changed Resource/version or persisted evidence refuse disclosure.
   Empty native model sets do not read unfiltered column tables. The migration
   deliberately leaves historical rows unmapped and does not erase their
   original native status/content. It cannot manufacture missing historical
   identity evidence. Down migration refuses to discard any recorded capture;
   empty rollback remains possible. No new persistent execution state or
   retry/expiry policy is introduced. Native write/deploy admission, Asking,
   dashboard authorization and real production instance activation remain
   separate acceptance gaps.

Difference classification for these affected original modules: the native
MDL builder, hash, manifest encoding, GraphQL schema and complete page source
are retained; captured native identity, scoped lookup and fresh authorization
are the authorized governance adaptation. There is no shared-page migration
or newly invented UI in this slice. This module comparison does not claim the
entire Wren/source tree or every browser state has reached original parity.

Implementation preceded the checks. Validation reused the existing
`kailo-wren-query-sdk-itgs2n`, UID 1000, 4 CPU / 4 GiB, its cached dependencies
and already configured isolated PostgreSQL database/network namespace. Each
database case uses its own random schema, original project/deploy migrations,
this native migration and real `DeployLogRepository`; cleanup affects only
that case-owned schema, not production business data.

The first attempt accidentally used the older `/work/apps` snapshot in the
existing native SDK: Jest exited 1 with no tests and tsc exited 2 because that
snapshot lacked previously integrated native consumers. It was not a result
for the current source. The correct existing `governance-Itgs2N` snapshot then
passed all native consumers and tsc, but an additional SQLite attempt failed
two cases because the cached Node 24 SDK lacks `better_sqlite3.node` (82 passed,
1 PostgreSQL skip, exit 1). That failure is retained; no dependency/image
rebuild or SQLite-compatibility acceptance is claimed. Final database cases
use the existing isolated PostgreSQL path, as the earlier native receipts do.

From the original `wren-ui` working directory:

```sh
./node_modules/.bin/jest --runInBand src/nativeProjectScope.test.ts \
  src/apollo/server/services/tests/deployService.test.ts
./node_modules/.bin/tsc --noEmit
```

The restored PostgreSQL run passed 85 tests / 2 suites, 0 skipped, exit 0,
14.123 s. Whole-Wren `tsc --noEmit` produced no diagnostics and exited 0.
Checks cover unchanged builder output and actual capture, legacy refusal,
incomplete/conflicting mappings, foreign project, denial, return-time
revocation, Resource/version change, native record mutation, real JSONB
persistence, original concurrent deployment behavior and lossless rollback.

Private fault injection removed the final history authorization comparison:
the two targeted consumers failed, exit 1 (2 failed / 71 targeted skips,
9.372 s), because revoked and changed-version resources still returned the
encoded manifest. Removing the migration's retained-evidence guard separately
failed the actual PostgreSQL rollback consumer, exit 1 (1 failed / 11 targeted
skips, 6.209 s), because recorded capture could be discarded. Both faults
were restored and all eight code/test/migration inputs byte-compared against
formal source with `cmp`, exit 0.

After both faults were restored, the same two-suite PostgreSQL command passed
85/85 again with no skips in 8.110 s, exit 0. `git diff --check -- data-query`
also exited 0. The remaining global release checks belong to the shared batch;
these scoped results do not substitute for them.

Logs are `native-mdl-object-tests.log`, `native-mdl-object-types.log`,
`native-mdl-object-mutation.log`, `native-mdl-object-restored.log`,
`native-mdl-object-types-final.log`,
`native-mdl-object-migration-mutation.log` and
`native-mdl-object-restored-final.log` in the existing Wren candidate directory.
The initial stale-snapshot failures remain in its parent directory's
`native-mdl-object-tests.log` / `native-mdl-object-types.log`.
This batch is not full-global-check, SQLite migration acceptance, complete
native write governance, live datasource/model/identity/binding acceptance,
browser screenshot, Windows/Mobile verification, image build or deployment.

## 2026-10-08: Original Asking saved-view read consumers

### Four-step impact record

1. Authority and status: `.design/08` §6, `SS-WRN-IDENTITY`,
   `SS-WRN-GOVERNANCE`, `DD-12` and `DD-98` require current native user/project
   and exact object authorization. The existing `data_query.describe@v1`
   Resource `read` contract applies to native saved views; no thread resource
   type, second permission system or private platform action is introduced.
   Full native Asking execution remains adapter-required and is not accepted
   by this read-only batch.
2. Retrieved impact: GraphQL `askingTask`, `thread`, `threadResponse`,
   `ThreadResponse.view/askingTask` and `ResultCandidate.view` are wired to
   `AskingResolver` in `wren-ui/src/apollo/server/resolvers.ts`. The fixed
   official baseline is `c5f02a0391c87420dba78632dcd86073710deb72`,
   `wren-ui/src/apollo/server/resolvers/askingResolver.ts`, resolvable symbols
   `AskingResolver.transformAskingTask`,
   `AskingResolver.getThreadResponseNestedResolver` and
   `AskingResolver.getResultCandidateNestedResolver`. This baseline is available
   in the read-only `WrenAI-ui-0.32.2` evidence repository. It loaded views by
   globally scoped native ID; prior Kailo project filters alone did not consume
   object authorization. The original native service/repository remains the
   body writer/reader. No database, public schema, contract generation or data
   format changes are made; original pages and result fields remain unchanged.
   Web/Desktop use the same native page; Mobile gains no component host.
3. Side effects: existing cached and native consumers now resolve each distinct
   view with the current request's trusted HUMAN token, identity scope,
   configured binding/project and exact native ID. They read only
   `{id, projectId}`, re-read native facts and resolve the same Resource/version
   before returning. A forged parent view body is replaced by the authorized
   native row, not merged into the response. Task project mismatches refuse
   before native view lookup; nested responses keep their original thread
   ownership check. Candidate telemetry runs only after the guarded transform,
   so refused content is not first exported via a finished-task event. There
   is no cross-user authorization cache, SQL execution, new task, reservation,
   workflow or Core body storage in this batch.
4. Boundaries and error classes (`apps/06` §4): missing/malformed HUMAN identity,
   native task/project mismatch, denied or revoked resources are `DENIED`;
   unavailable delivery/binding/registered object evidence is `PRECONDITION`;
   changed native rows or Resource/version refuse with the existing
   `QUERY_EVIDENCE_UNAVAILABLE` conflict rather than returning stale success.
   Original missing views remain errors. Empty tasks/threads preserve their
   original shapes but still require trusted current identity; null responses
   and absent nested views preserve the original null behavior. Duplicate view
   IDs are deduplicated and authorization reads are sequential, without
   unbounded request fan-out. Native mutation/deletion, out-of-scope parents,
   cached permission and read-time revocation refuse the complete result,
   never silently hide part of an answer. No external write or result-unknown
   state is added; existing transport failures propagate without a fallback or
   repeat of native execution.

### Actual scoped evidence

The existing `kailo-wren-query-sdk-itgs2n` was verified idle and retained its
4 CPU / 4 GiB cgroup, cached dependencies and isolated PostgreSQL delivery.
No dependency install, image rebuild or extra SDK/database was started.
From its existing original Wren working directory:

```sh
./node_modules/.bin/jest --runInBand src/nativeAskingView.test.ts \
  src/nativeTaskOwnership.test.ts src/nativeHumanQuery.test.ts
./node_modules/.bin/tsc --noEmit
```

The first run passed 86/86 tests, 3/3 suites, 0 skipped, exit 0, 108.419 s.
The new module's initial read/compile took 101.165 s; this was not an image
build. Tests exercise the actual resolver and existing native Resource
consumer with an explicit Core boundary fixture; the existing native task
migration/conditional-binding cases use real PostgreSQL. This does not prove
live Wren-to-Core-to-SpiceDB user acceptance. Whole-Wren `tsc --noEmit` emitted
no diagnostics and exited 0.

Private fault injection replaced the final fresh Resource selection with its
initial captured fact. The same actual readers incorrectly disclosed revoked
or changed-version bodies, and the six targeted checks failed, exit 1:

```text
Received promise resolved instead of rejected
Test Suites: 1 failed, 1 total
Tests:       6 failed, 23 skipped, 29 total
Time:        6.469 s
```

These skips are the deliberate mutation name filter, not unexecuted scoped
acceptance. The fault was restored and `cmp` confirmed all three source/test
inputs equal formal source, exit 0. Re-running the original three-suite command
passed 86/86 again, 0 skipped, exit 0, 9.608 s. Logs are
`native-asking-view-tests.log`, `native-asking-view-types.log`,
`native-asking-view-mutation.log` and `native-asking-view-restored.log` in the
existing Wren candidate directory.

Remaining integration boundaries are arbitrary generated-SQL resource
provenance/execution admission, native AI task usage/terminal evidence, other
native writes and actual datasource/identity/catalog/binding delivery. This
batch adds no release, binding or platform entry and is not full-global-check,
browser screenshot, Windows/Mobile verification, component image build or
deployment. Those boundaries must not be reported as completed Asking or
production Wren acceptance.

## 2026-10-08 exact model describe and execution observation consumer

### Authority and impact established before implementation

1. `.design/08` §6 maps native model describe to the exact model Resource's
   `read` permission and the existing `data_query.describe@v1` action. `.design/07`
   and the frozen `execution_response` contract determine the native observation
   envelope. These are existing supported/adapted seams, not a new permission,
   output contract, UI or registry. Official baseline remains
   `c5f02a0391c87420dba78632dcd86073710deb72`; original consumers are
   `wren-ui/src/apollo/server/repositories/modelRepository.ts::ModelRepository`
   and `wren-ui/src/apollo/server/services/queryService.ts::QueryService.preview`.
   Their fixed-source symbols were read with `git show` before editing.
2. Full references of the touched consumers were searched: the original native
   MCP and HTTP adapter both call `NativeQueryService.execute`; the HTTP handler
   and existing native-history checks call `observe`. Core's existing
   `application_execution` observation consumer and Worker conformance expect
   the frozen response envelope; their changes are owned by the parent batch.
   No database/contract field, migration, GraphQL schema, page, setting, locale
   or Web/Desktop/Mobile presentation changes here. Current `deploymentObjects`
   and the builder's persisted capture are reused, not replaced by a second
   name-to-object mapping. There is no new state to migrate or lifecycle to own.
3. The prior describe consumer disclosed the whole deployment's model metadata
   under one model Resource ticket. It now selects the exact fresh Core target,
   matches its native ID against the original deployment's capture and the
   original model row in the controlled project, and exposes only that model's
   original name/columns. SQL, connection credentials and unrelated models stay
   native. The HTTP consumer now accepts the declared describe operation and
   actually consumes its submitted target in the authenticated parameter hash;
   it cannot substitute the token target for a changed request target. Final
   authorization and native evidence are checked before body disclosure.
4. Missing/foreign target facts are denied; absent legacy capture is unavailable;
   a same-name replacement, changed native row/captured manifest or frozen
   deployment is a precondition refusal. Empty input remains the existing
   describe shape; it is not authority to describe an empty/all-model project.
   A denied pre-native recheck records the existing proven unsent failure;
   native query uncertainty stays `UNKNOWN`. An existing description replays
   only its original native history/deployment after fresh authorization, never
   a newer current deployment or a second native call. Observe returns the
   contract's `execution` envelope with original history ID/status/time; absent
   history remains `UNKNOWN`, with no claimed writer fence, result body or
   unsupported cancellation. Existing six-class error boundaries are retained;
   this batch does not redefine Core transport classification. Web's BFF and
   Desktop/Mobile's existing credential/transport paths remain unchanged; no
   mobile component-host entry is added.

### Actual isolated validation and negative controls

Only the existing isolated PostgreSQL and SDK container were used. Before the
batch, `free -h` showed 26 GiB available; `docker top` showed only its idle
keeper, and `docker inspect` confirmed the existing cgroup allocation of
4 CPU / 4 GiB. Commands run at its existing `/work` candidate, reusing installed
dependencies and cache; there was no image build, package download, database
provisioning or source execution under `.references`.

```sh
./node_modules/.bin/jest --runInBand src/nativeQuery.test.ts src/nativeHumanQuery.test.ts
./node_modules/.bin/tsc --noEmit
```

The first implementation run reported 63 passed / 4 failed. Three old direct
observe assertions still expected the superseded bare response; the new replay
assertion compared JSON strings despite native PostgreSQL JSONB key ordering.
The assertions were corrected to the existing response envelope and parsed
business value, not by reverting production behavior. The concentrated rerun
passed, exit 0:

```text
Test Suites: 2 passed, 2 total
Tests:       67 passed, 67 total
Snapshots:   0 total
Time:        15.165 s
```

The same native HTTP/MCP consumers, original repositories and real PostgreSQL
history exercised exact model selection, forged token-side native facts, all
five foreign target dimensions, absent facts, legacy capture, same-name ID
replacement, request-target mismatch, final permission/target/manifest/model
changes, replay after a newer deployment, uncertain engine history and missing
history. The existing original QueryService transport fixture still exercised
query/dry-run and real HTTP admission; it is not a deployed datasource claim.
Whole Wren `tsc --noEmit` emitted no diagnostics, exit 0.

Private-candidate faults were applied only after implementation and acceptance:

- Removing final fresh reauthorization caused all four real describe disclosure
  checks to fail (`Received promise resolved instead of rejected`), exit 1,
  8.290 s. The 36 skips were the explicit mutation name filter.
- Returning all captured models and reverting known-history observe to a bare
  response caused five real MCP/history checks to fail, exit 1, 7.952 s; 35 other
  tests were intentionally outside that mutation filter.
- Ignoring the submitted HTTP target caused its real rejection check to fail
  (`Expected: 403`, `Received: 200`), exit 1, 7.066 s; 39 other tests were outside
  that filter.

All faults were restored. `cmp` of each of the three source/test inputs against
formal source returned 0; the original complete two-suite command then passed
67/67 again, 0 skipped, exit 0, 18.232 s. `git diff --check` for these files
returned 0. Logs in the existing candidate are
`native-query-describe-tests.log`, `native-query-describe-types.log`,
`native-query-describe-mutation.log`, `native-query-scope-wire-mutation.log`,
`native-query-submitted-target-mutation.log` and
`native-query-describe-restored.log`.

This is the precise describe/HTTP execute/observe consumer batch, not complete
Wren release acceptance. Arbitrary generated-SQL resource provenance and AI
task admission/usage/terminal evidence, other native writes, real datasource
and identity/catalog/binding delivery remain integration work. No deployment,
release, binding, image build, screenshot, Windows/Mobile acceptance or global
check is claimed here; the parent owns consolidated checks and publication.

### 2026-10-08 original Asking native terminal observation

Authority and fixed source: DD-98 and `.design/08` §6 keep the original Asking
task as native authority. The restored upstream consumer is WrenUI
`c5f02a0391c87420dba78632dcd86073710deb72`,
`wren-ui/src/apollo/server/services/askingTaskTracker.ts::AskingTaskTracker.pollTasks`.
Classification `GENERAL` or `MISLEADING_QUERY` is not terminal evidence: the
original async AI task can still be `GENERATING`. The same acknowledged query
ID now remains polled until native `FINISHED`, `FAILED` or `STOPPED`. Original
SQL-rerun non-SQL failure presentation is retained only after native FINISHED;
native failure and cancellation details are no longer overwritten by that
presentation. Unknown status is not finalized or remapped to success/failure.

Impact: native ACK → existing project-owned task row → original poll/result
consumers and reset-settled check. There is no new task registry, schema field,
migration, public action, quota/audit authority or page/layout change. A DB
persistence failure still retries observation of the original native query,
not redispatch. Empty/unknown results stay nonterminal, and a classification
does not permit an in-flight task to be treated as settled. Existing request
authentication, scope/project ownership and resource authorization remain in
their original consumers; this batch does not claim to complete AI admission
or usage association.

Implementation preceded the evidence. The existing SDK had no active build
child and its actual cgroup was 4 CPU / 4 GiB; original dependencies and the
existing isolated PostgreSQL were reused without image/package rebuild. The
three original suites `nativeTaskOwnership.test.ts`, `nativeAskingView.test.ts`
and `nativeHumanQuery.test.ts` passed 94/94, no skips, exit 0 (93.547 s). Replacing
the two real guards with the former wrong behavior in the private SDK copy
made all eight targeted cases fail, exit 1 (7.204 s); 30 other cases were
explicitly filtered, not missing database checks. Both source/test copies were
restored with `cmp` exit 0. The original complete three-suite command then
passed 94/94 again, no skips, exit 0 (10.091 s). `tsc --noEmit` exited 0 with no
diagnostics; Prettier passed both changed inputs. The actual tool-output
excerpts are archived, explicitly not another invocation, at
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/native-asking-polling-receipt.log`.

This is the two-file original polling consumer fix. No Wren business instance,
catalog release/binding, live LLM/datasource, image, deployment or screenshot
is claimed. The separate saved-view browser/GraphQL integration in progress
and generated-SQL multi-resource authorization/LLM usage gaps are not included
in this 94-case receipt.

### 2026-10-08 original Asking saved-view submission and result consumers

Implementation authority and impact, recorded after the source changes:

1. DD-98 and `.design/08` §6 retain Wren's original answer, saved view,
   deployment and ApiHistory as business authority. The existing HUMAN
   `data_query.query@v1` action owns admission, approval, quota, audit and
   reconciliation. The official comparison remains WrenUI
   `c5f02a0391c87420dba78632dcd86073710deb72`, specifically
   `wren-ui/src/apollo/server/resolvers/askingResolver.ts::AskingResolver.previewData`,
   `wren-ui/src/apollo/server/services/askingService.ts::AskingService.previewData`
   and the original `ViewSQLTabContent`, `TextBasedAnswer` and `ChartAnswer`
   components under `wren-ui/src/components/pages/home/promptThread/`.
   Their original pages, styles, chart properties, adjustment/pinning controls,
   SQL display and automatic preview triggers remain; the authorized difference
   is their query submission/result consumption and necessary governance states.
2. Searches covered original GraphQL registrations, generated consumers,
   service callers and all three live preview controls. `previewData` and
   `previewBreakdownData` now reuse the existing
   `ModelResolver.previewViewSnapshotData` → `NativeHumanQuery.preview` chain. The former
   unmanaged `AskingService` preview implementations had only those resolver
   callers and were removed, rather than retained as a second execution path.
   Two optional original GraphQL input fields carry the existing opaque retry
   key and verified scope. The original cached GraphQL generator ran against
   the actual local schema: only `__types__.ts` gained the two fields; all
   `*.generated.ts` files compared byte-identical with formal source. There is
   no platform contract, native database field/migration, task, public Action,
   native page or deployment change. Clients that omit/forge the current scope
   are refused; there is no old unauthenticated fallback.
3. The actual original response is loaded through project/thread ownership;
   its exact saved view is freshly described as the current HUMAN. Its SQL
   must equal the native saved-view statement, not merely an LLM candidate
   table list. That first native statement snapshot is passed to the actual
   reference reader before command submission; a different statement under the
   same view ID is refused before a Core command exists. Existing-key observation
   must match that snapshot's original native revision as well. The existing
   frozen view/deployment reference then submits or observes the same Core
   ActionExecution. Core receives no SQL/body. Results
   are read only from the original completed native ApiHistory after fresh
   authorization. Response intent and current native view facts are checked
   again before disclosure. Unrelated answer-stream content changes are not
   query-intent changes. No new execution state or cleanup lifecycle is added.
4. Missing native response/view evidence, changed SQL/CTE, scope mismatch,
   permission denial, revocation, native-object changes and unavailable
   authorization refuse submission/disclosure. The existing six-class
   boundary remains: authentication/scope/permission are DENIED; unavailable
   admission/reference facts are PRECONDITION; changed identities/intents or
   evidence are CONFLICT/PRECONDITION, not a completed business failure. The
   existing Core LIMIT/approval decisions are consumed, never replaced by
   client counters. An unverified external result remains UNKNOWN with its
   original key, not success/failure or a fresh native query. Native references
   and retry keys remain separated by trusted user/binding/scope and native
   selection. Wrong-object/malformed terminal receipts cannot clear the key.
   Missing browser storage refuses submission. Original Web/Desktop host
   boundaries and the Mobile non-component-host boundary are unchanged.

The original SQL/text result controls and chart data consumer use the same
existing `useGovernedPreview` hook, extended for a response native ID. Only
verified receipt data renders native rows/charts; pending/UNKNOWN cannot render
an empty chart as success. Necessary guidance uses the existing Chinese-default
and English helper, not an alternate page or language authority. This is not
complete Wren i18n or visual parity acceptance.

Actual validation reused the existing 4 CPU / 4 GiB SDK, installed dependencies
and isolated PostgreSQL. `docker top` showed only its keeper before each run;
available host memory was above the actual budget. No image, package or
database provisioning occurred. Initial implementation acceptance reported
109/109 in four original suites, but its combined type-check command failed:
eight mistaken isolated source copies under `/work/data-query/wren-ui/src`
were also scanned by tsconfig, producing 23 missing-module errors; a wrongly
escaped shell `PIPESTATUS` then returned exit 2. Formal source never contained
those copies. The eight known temporary copies were explicitly removed and
the command corrected; no production check was weakened to accommodate them.

After the final intent and retry-receipt changes, the same concentrated run
passed 115/115, no skips, exit 0 (105.238 s), followed by whole UI
`tsc --noEmit`, exit 0 with no diagnostics. Actual command:

```sh
./node_modules/.bin/jest --runInBand src/nativeTaskOwnership.test.ts src/nativeHumanQuery.test.ts src/nativeAskingView.test.ts src/viewMetadata.test.ts
./node_modules/.bin/tsc --noEmit
```

The real resolver/service path exercised pending and completed queries,
original deployment/reference replay without native redispatch, refusal before
command submission, changed response/view/revoked permission before rows,
partial-CTE refusal, unrelated answer streaming and same-user retry identity.
The existing native preview-control harness additionally exercised original-key
retention across remount, another user/selection, and wrong response/native
selection/scope or malformed terminal evidence. These are execution/control
checks, not browser screenshots.

Post-implementation negative control changed only the private SDK copy: removed
the actual response-SQL/view equality and final response-intent checks, and
replaced the hook's actual selection-aware key clearing with its former
scope-only behavior. All five targeted checks failed, exit 1 (130.441 s): two
resolved queries that should have been refused, and three erased retry keys
after wrong/malformed terminal evidence. The 43 other cases were explicit
name-filter skips. Faults were restored with `apply_patch`; all 11 source,
generated and evidence inputs compared byte-identical to formal source.

The original complete four-suite command then passed again:

```text
Test Suites: 4 passed, 4 total
Tests:       115 passed, 115 total
Snapshots:   0 total
Time:        149.022 s
```

Whole UI `tsc --noEmit` emitted no diagnostics, exit 0; Prettier passed all ten
hand-edited inputs (the eleventh is original codegen output), and formal
`git diff --check` returned 0. Full stdout/stderr evidence is in the existing
Data candidate:

- `/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/native-asking-preview-restored.log`
- `/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/native-asking-preview-mutation.log`
- `/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/native-asking-preview-final.log`

No Wren business instance, catalog release/binding, LLM/datasource end-to-end
run, browser screenshot, Windows/Mobile validation or deployment is claimed.
Arbitrary generated SQL and partial CTEs still need exact native source-object
provenance and multi-resource final authorization; original AI generation and
other native mutations still need their existing admission/usage/terminal
association. The Agent raw-SQL branch is not proven resource-scoped by these
saved-view consumers and must not be activated on that assumption. Existing
platform task-status enum consumption beyond the exercised preview receipts
also remains outside this acceptance; the parent owns consolidated review,
checks and publication.

#### Same-batch cross-review correction: bind the first Asking statement before dispatch

Cross-review found a concrete pre-dispatch race in the initial saved-view
implementation: Asking checked statement S1 but passed only the view ID to the
reference reader. That reader could freeze S2 and submit it before the final
read refused disclosure; S1 → S2 → S1 could even conceal the change entirely.
The initial 115-case receipt above did not cover this race and is not evidence
that the original implementation was safe against it.

The actual internal `ModelResolver.previewViewSnapshotData` consumer now passes
the first checked native statement to `NativeHumanQuery.preview` and the
existing `NativeQueryService.reference`. The reference reader must match it
before submitting a Core command, then uses the existing ContentReference
`nativeRevision` over the original selection and statement. Existing-key
observation must also match that revision, preventing an older S2 intent from
being adopted as the current S1 intent. Execution still consumes the original
revision checks immediately before native SQL; no parser, Action, task, SQL
copy in Core, browser argument, database field or migration was introduced.
The optional arguments are internal native-service calls, not a new public
GraphQL contract or an additional authorization authority.

Three actual Asking → ModelResolver → NativeHumanQuery → NativeQueryService
consumer scenarios now cover persistent statement changes, S1 → S2 → S1 and
an existing key frozen for a different statement. The first two assert refusal
before any command or native history read, not merely failure after dispatch.
The retained original native-query suite uses real PostgreSQL history and the
actual HTTP/MCP execution/observation handlers; its original engine HTTP peer
is an isolated fixture, not a claim that a live Wren datasource ran.

The same existing 4 CPU / 4 GiB SDK and isolated PostgreSQL were reused.
Before both positive runs and the fault run, the SDK had only its keeper;
actual host memory exceeded its limit. Data free space was approximately
292 MiB, so only the changed inputs and small logs were copied; no image,
dependency, toolchain or database was provisioned. Initial full acceptance was
5 suites, 158/158, zero skips (128.998 s), followed by whole UI
`tsc --noEmit` with no diagnostics, combined exit 0.

Only the private SDK copy was then damaged: removed the actual pre-command
statement comparison and the existing-key revision comparison. All three
targeted checks failed, exit 1 (6.629 s); 39 other cases were explicit
name-filter skips. The ABA case returned completed native rows that should
have been refused; the prior-statement case returned the old receipt; the
persistent change was caught only after the command, with the wrong evidence
error. This demonstrates why a final read is not a pre-dispatch guard.

Both guards were restored with `apply_patch`. All 14 implementation/generated
inputs compared byte-identical to formal source before the final full run:

```sh
./node_modules/.bin/jest --runInBand src/nativeTaskOwnership.test.ts src/nativeHumanQuery.test.ts src/nativeAskingView.test.ts src/viewMetadata.test.ts src/nativeQuery.test.ts
./node_modules/.bin/tsc --noEmit
```

```text
Test Suites: 5 passed, 5 total
Tests:       158 passed, 158 total
Snapshots:   0 total
Time:        20.249 s
```

Whole UI type checking emitted no diagnostics; all 13 hand-edited inputs
passed Prettier (the fourteenth is original codegen output), combined exit 0.
The full stdout/stderr logs are in the same existing Data candidate:

- `/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/native-asking-snapshot-restored.log`
- `/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/native-asking-snapshot-mutation.log`
- `/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/native-asking-snapshot-final.log`

This correction is part of the saved-view source batch, not a deployed
business instance or complete Wren integration. The release/binding,
datasource/LLM end-to-end, multi-resource authorization, task-status consumer
and three-client visual acceptance gaps stated above remain open.

### 2026-10-08 original query controls consume the existing closed task statuses

This follow-up addresses the actual saved-view/model/Asking preview consumers,
not arbitrary generated SQL or a second task-state authority.

1. Authority: `.design/08` section 6, SS-WRN-GOVERNANCE and DD-98 preserve
   the original native query, Resource and evidence chain. The existing
   `contracts/enums/task_status.schema.json` has RUNNING and five close values;
   `contracts/api/native_human_action_result.schema.json` explicitly derives
   terminalStatus from the reconciled original component-action audit, never
   HTTP acceptance or a Temporal close alone. ActionGateState and
   ActionDispatchState remain the existing independent closed enums.
2. Impact: original Core HUMAN receipt -> NativeHumanQuery ->
   useGovernedPreview -> ModelMetadata, ViewMetadata and original Asking SQL,
   text-answer and chart controls. The helper is consumed by the backend and
   hook, not an unused alternate type/registry. No schema, migration, public
   field, native task, workflow, database or result-storage change is made.
   Existing receipts gain no new fields; their already contracted statuses
   are now consumed completely. Original JSX, classes, styles, controls and
   layout remain, apart from formatting and the necessary existing-result
   conditions. This is an authorized governance difference, not a new UI.
3. Side effects: no query is dispatched by this classifier. Native rows still
   require the original COMPLETED audit and native history plus fresh read
   checks. Non-completed or malformed observations cannot retain old rows.
   A failed observation cannot show a previous success. RUNNING, unknown
   status values, contradictory completion evidence or an external dispatch
   still UNKNOWN preserve the original intent/key and cannot become success
   or failure. Known reconciled close values include TERMINATED and TIMED_OUT,
   so those intents no longer remain stranded by the former three-value key
   clearing condition.
4. Boundaries: absent terminalStatus remains pending; unknown enums/nulls/
   malformed gate/dispatch evidence refuse in the backend with the existing
   QUERY_EVIDENCE_UNAVAILABLE (`PRECONDITION`) and render an unresolved
   observation (`UNKNOWN`), not a new execution. Existing wrong-person/scope/
   selection, revoked permission, native revision and durable-key checks are
   retained (`DENIED`/`CONFLICT`/`PRECONDITION`). Existing LIMIT, approvals and
   capacity decisions remain Core's authority; this read-only consumer cannot
   bypass them. Empty successful rows preserve the original result shape.
   No new persistent state or convergence process is introduced; unresolved
   observations continue the existing original action and reconciliation.

Pinned original frontend evidence remains WrenAI
`c5f02a0391c87420dba78632dcd86073710deb72`:

- `wren-ui/src/components/pages/modeling/metadata/ModelMetadata.tsx::ModelMetadata`
- `wren-ui/src/components/pages/modeling/metadata/ViewMetadata.tsx::ViewMetadata`
- `wren-ui/src/components/pages/home/promptThread/ViewSQLTabContent.tsx::ViewSQLTabContent`
- `wren-ui/src/components/pages/home/promptThread/TextBasedAnswer.tsx::TextBasedAnswer`
- `wren-ui/src/components/pages/home/promptThread/ChartAnswer.tsx::ChartAnswer`

All five original symbols were resolved with `git grep` at that exact commit;
the batch diff changes their existing query conditions, not their original
business pages. Complete upstream parity and visual acceptance are separate
and are not asserted by these condition checks.

The existing non-root 4 CPU / 4 GiB SDK, Data cache and private source snapshot
were reused. Before each toolchain run its actual limits, keeper-only process
list and host CPU/memory pressure were checked; available memory exceeded the
limit, and Data had approximately 296 MiB free. No image, dependency, database
or new verification infrastructure was provisioned. Initial 79-case and then
83-case runs passed while the actual UNKNOWN-dispatch boundary was completed.
The final input set passed 87/87, no skips (6.203 s), before fault injection.

The private SDK copy alone was deliberately damaged after implementation:
removed the real closed-status and UNKNOWN-dispatch validation, treated
RUNNING as closed, and restored the hook's former three-close-value clearing.
The actual original backend/page/hook checks then failed as required:

```text
Test Suites: 2 failed, 2 total
Tests:       16 failed, 61 skipped, 10 passed, 87 total
Time:        7.263 s
```

The 61 skips are explicit test-name filtering for this negative control, not
final acceptance skips. Unknown statuses wrongly resolved, RUNNING rendered
as ended, UNKNOWN-dispatch receipts cleared retry keys, and TERMINATED/
TIMED_OUT failed to clear genuinely closed intents. Both source protections
were restored with `apply_patch`; all ten modified implementation/check inputs
compared byte-identical with formal source before the final full narrow run:

```sh
./node_modules/.bin/jest --runInBand src/nativeHumanQuery.test.ts src/viewMetadata.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/prettier --check src/apollo/server/services/nativeHumanQuery.ts src/hooks/useGovernedPreview.ts src/utils/queryReceipt.ts src/components/pages/home/promptThread/ChartAnswer.tsx src/components/pages/home/promptThread/TextBasedAnswer.tsx src/components/pages/home/promptThread/ViewSQLTabContent.tsx src/components/pages/modeling/metadata/ModelMetadata.tsx src/components/pages/modeling/metadata/ViewMetadata.tsx src/nativeHumanQuery.test.ts src/viewMetadata.test.ts
```

```text
Test Suites: 2 passed, 2 total
Tests:       87 passed, 87 total
Snapshots:   0 total
Time:        7.232 s
All matched files use Prettier code style!
```

Whole UI type checking emitted no diagnostics; combined exit 0. A separate
one-off SDK check piped the three actual authoritative JSON enum arrays to the
real helper: all 6 TaskStatus, 6 ActionGateState, 4 ActionDispatchState and 24
completion gate/dispatch combinations matched, unknown values refused, and
UNKNOWN dispatch never settled an external side effect; exit 0. No duplicate
enum type or permanent check script was generated. Formal `git diff --check`
also returned 0. Complete stdout/stderr is in the existing Data candidate:

- `/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/native-query-task-status-positive-final-inputs.log`
- `/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/native-query-task-status-mutation-final-inputs.log`
- `/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/native-query-task-status-final.log`
- `/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/native-query-task-status-contract-parity.log`

The two original metadata pages are exercised through their actual SSR/control
consumers; this is not a browser screenshot. The three original Asking result
pages consume the same actual hook and pass whole-UI typing, but this run is
not their browser/visual acceptance. No business instance, live datasource/
LLM end-to-end, release/binding, full check, Windows/Mobile package or deployment
is claimed. This batch also does not prove that the Core producer emits every
close value; it must retain the original reconciled component-audit evidence.
Arbitrary generated SQL provenance, multi-resource authorization and the
remaining native side-effect/usage consumers still prevent claiming complete
Wren integration.

### 2026-10-08 original planner sources and historical native-object consumption

This source batch extends the existing real QueryService/NativeQueryService
chain. It does not claim that a single Resource grant authorizes multi-model
SQL, and is not a deployed business instance.

1. Authority is `.design/08` section 6, SS-WRN-GOVERNANCE and DD-98. SQL,
   manifests, model/view bodies and results remain in Wren's independent
   original storage. Core Resource and fresh authorization remain authoritative;
   neither explanatory retrievedTables nor current-name matching supplies
   permission or historical native identity.
2. The actual impact is the original registered AnalysisResourceV2 -> existing
   WrenEngineAdaptor -> QueryService -> NativeQueryService execute/retry/result
   path. Analysis.getTables and QueryDescriptor.getRequiredObjects recursively
   collect original semantic dependencies. ViewInfo's actual query is analyzed
   as well because its dependency names omit direct physical tables. Five
   original Analyzer omissions are corrected in place: Query-level ORDER BY,
   subscript index/non-name base, count(*) FILTER/window, VALUES rows, and
   UNNEST expressions without a parent scope. The planner itself consumes those
   same Analyzer methods; no second SQL parser is introduced. Existing original
   analysis endpoints and pages remain; the internal source endpoint is additive.
3. Side effects: the native source HTTP read uses the already delivered timeout
   and response bound; malformed/absent source evidence cannot become an empty
   allowed set. All source FQNs must uniquely map to the historical deploy_log
   native_object_refs captured by MdlService.build. Current native rows are
   re-read by captured ID plus project; a renamed/replaced model, changed view
   statement, duplicate source or model/view name collision refuses rather than
   selecting the first match. Analysis is followed by the original fresh PEP and
   frozen deployment/target revalidation before QueryService dispatch. A proven
   pre-query refusal settles the original reserved history as NOT_DISPATCHED;
   a query transport failure retains UNKNOWN and never replays.
4. Boundaries: the existing PEP contract authorizes one targetResource. Until
   the same authoritative execution and result-disclosure chain consumes all
   source Resource grants, arbitrary SQL remains limited to a provable single
   captured model; hidden dependencies, foreign namespaces and unregistered
   physical sources refuse (`DENIED`). Historical/native mutation is CONFLICT;
   missing/malformed analysis is PRECONDITION. Native table/path functions and
   scalar calls without authoritative hidden-read evidence remain unavailable,
   not newly declared safe. Those restrictions are remaining delivery gaps,
   not a reduction of the full Wren target. Existing view-reference consumers
   still need the same complete source authorization at execution and HUMAN
   result disclosure. No new persistent state, task, migration or authority is
   added; existing UNKNOWN/history reconciliation remains the convergence path.

Fixed upstream source evidence was re-resolved, read-only, at Engine commit
`47ca29ebba291100ba5d70ce1790f9887eaed7a0` inside the UI pin
`c5f02a0391c87420dba78632dcd86073710deb72`:

- `wren-core-legacy/wren-main/src/main/java/io/wren/main/web/AnalysisResourceV2.java::getSqlAnalysis`
- `wren-core-legacy/wren-base/src/main/java/io/wren/base/sqlrewrite/analyzer/Analysis.java::getTables`
- `wren-core-legacy/wren-base/src/main/java/io/wren/base/sqlrewrite/analyzer/StatementAnalyzer.java::analyze`
- `wren-core-legacy/wren-base/src/main/java/io/wren/base/sqlrewrite/analyzer/ExpressionAnalyzer.java::visitFunctionCall`
- `wren-core-legacy/wren-base/src/main/java/io/wren/base/sqlrewrite/QueryDescriptor.java::of`
- `wren-core-legacy/wren-base/src/main/java/io/wren/base/sqlrewrite/ViewInfo.java::get`
- `wren-core-legacy/wren-base/src/main/java/io/wren/base/sqlrewrite/WrenSqlRewrite.java::addSqlDescriptorToGraph`
- `wren-core-legacy/trino-parser/src/main/java/io/trino/sql/tree/Values.java::getRows`
- `wren-core-legacy/trino-parser/src/main/java/io/trino/sql/tree/SubscriptExpression.java::getIndex`

The diffs are authorized governance changes to the original planner/adapter
consumers, not replacement frontend pages. Complete official-source parity,
Java runtime and visual acceptance are not asserted.

The earlier six-file candidate reused the existing non-root 4 CPU / 4 GiB SDK
and original nativeQuery HTTP/MCP handler plus isolated PostgreSQL history:

```text
Test Suites: 1 passed, 1 total
Tests:       59 passed, 59 total
Time:        24.153 s
```

Its whole-UI type check also exited 0. The actual log remains
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/native-query-provenance-positive.log`.
After adding a response-bound check, the next 60-case run failed while Data
was full: 38 failed, 22 passed. The first native database error was
`could not create directory "base/96457": No space left on device`; log tee
creation also failed. That run is not a functional negative control or final
acceptance. No success log for it is claimed. The Engine endpoint was an
HTTP evidence peer in the TypeScript check, not the real Java Engine.

The subsequent original Analyzer and complete native-ID mapping changes have
not been recompiled or rerun: source development continued under the explicit
shared Data-space restriction, without another PG/database, image or build.
No JDK/Maven runner is available for the new original Java checks. Their source
exists, but Java compilation, actual Engine HTTP acceptance, the final complete
narrow positive run and deliberate-fault/restore run remain unverified. A
formal `git diff --check` passed; that is not runtime evidence. No full check,
business instance/release/binding, datasource/LLM end-to-end, screenshots,
Windows/Mobile package, deployment or complete multi-model integration is
claimed by this batch.

## 2026-10-08 native source history and HUMAN result consumer

This later evidence supersedes only the preceding unverified TypeScript
candidate status. It does not verify the five changed original Java files or
claim a deployed Engine, datasource, model provider or Wren business instance.
The source pins remain UI `c5f02a0391c87420dba78632dcd86073710deb72` and Engine
`47ca29ebba291100ba5d70ce1790f9887eaed7a0`, with the original paths and Analyzer,
QueryDescriptor, QueryService and native-history symbols recorded above.

The actual implementation now consumes original Engine source analysis for
direct SQL and native model/view references. A selected saved view is retained
alongside its analyzed dependencies, using the same deployment's captured
native IDs rather than current-name lookup. The original `api_history` UNKNOWN
row freezes `request_payload.nativeSources` before native SQL; a repeat can
compare the set but cannot replace it. Completed replay requires the same
frozen source set. The service checks the original deployment and current
native object identities again after authorization and before result return.
No Core body copy, new task, ledger, permission ticket or SQL parser is added.

The actual `NativeHumanQuery.preview` consumer checks completed receipts against
the same binding, project, action execution, operation, key, parameter hash,
original RUN_SQL row, deployment/hash, SQL revision and result shape.
`NativeQueryService.completedQuerySources` then reads the same original history
and frozen native deployment. For every resulting model/view, the current
HUMAN bearer calls the existing Core `human-action.resolveResource` consumer
with `data_query.query@v1`; denied or inconsistent facts do not filter a source
out of the result. Source facts are reread, and the original completed receipt
is observed again before disclosure. This is not an EXPORT grant. Core's
original `application_action::fresh_execution` already consumes
`validate_reference_and_policy`; this batch retains that active-policy gate.

The impact is the existing native query execution/reentry and HUMAN result
paths, not original page composition. Native body/SQL/source history remains
in Wren's database; platform authority remains Core/SpiceDB and original
ActionExecution. A changed native selection/deployment/scope fails with the
existing refusal; missing completed evidence is unavailable, and an uncertain
native call remains UNKNOWN without replay. No database migration, contract
field or new public workflow state is introduced. Older completed rows without
frozen source evidence are refused, not silently backfilled or re-executed.

Verification used the existing `kailo-wren-query-sdk-itgs2n` 4 CPU / 4 GiB
cgroup, existing dependency/cache mounts and existing isolated PostgreSQL.
No new database service, image or release was started. Actual commands:

```sh
./node_modules/.bin/tsc --noEmit --incremental false
./node_modules/.bin/jest --runInBand src/nativeQuery.test.ts src/nativeHumanQuery.test.ts src/viewMetadata.test.ts
./node_modules/.bin/prettier --check src/apollo/server/repositories/apiHistoryRepository.ts src/apollo/server/services/nativeHumanQuery.ts src/apollo/server/services/nativeQueryService.ts src/nativeHumanQuery.test.ts src/nativeQuery.test.ts src/apollo/server/adaptors/wrenEngineAdaptor.ts src/apollo/server/services/queryService.ts
```

The first run reported 169 passed / 2 failed / 0 skips, exit 1 (27.261 s).
Its failures were the check expecting an MCP error value instead of the
actual thrown `QUERY_EVIDENCE_UNAVAILABLE`, and a check using an old numeric
PEP call position after source-freeze reauthorization added a real callback.
The checks were corrected to consume the actual MCP refusal and SQL dispatch
event, without removing production protection. The final complete positive
run reported 3 suites passed, 172/172 passed, 0 skips, exit 0 (90.022 s).
Whole-UI TypeScript exited 0.

After implementation, three real protections were deliberately removed only
in the private SDK copy: immutable native source history, completed-source
equality, and per-source HUMAN authorization. The original consumers reported
5 failed / 141 explicitly name-filtered skips / 1 passed, exit 1 (10.011 s).
The failures caught source replacement, changed dependency evidence and
disclosure after source denial. All seven formal TypeScript inputs were then
compared with `cmp` against the restored private inputs and matched. Prettier
reported all seven files conforming. The restored original three-suite run
again reported 172/172 passed, 0 skips, exit 0 (22.754 s).

Actual logs are under
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/`:
`native-query-human-provenance-positive.log` (initial two failures),
`native-query-human-provenance-tsc.log` (exit 0, empty successful compiler
output), `native-query-human-provenance-final-positive.log` (172/172),
`native-query-human-provenance-negative.log` (five real protection failures),
and `native-query-human-provenance-restored.log` (restored 172/172).

These TypeScript checks exercise original native HTTP/MCP handlers,
QueryService/adaptor, real original repositories/PostgreSQL and HUMAN/Asking
result consumers. The source HTTP endpoint in these checks is a controlled
evidence peer, not the actual new Java Engine endpoint. Java compilation and
real Analyzer HTTP acceptance remain unverified. Complete Agent multi-source
fresh authorization, source read/export policy intersection and the original
generated-SQL `ModelResolver.previewSql` execution consumer remain open
delivery gaps, not excluded product scope. No full check, Wren business
instance/release/binding, live datasource/LLM acceptance, iframe screenshots,
Windows/Mobile package, deployment or 100% original-feature parity is claimed.

## 2026-10-08 — original SQL editors and same-execution source consumers

This is evidence recorded after implementation, not a new execution contract.
The authority remains `.design/08` §6 and DD-98, the existing Resource,
ContentReference, ActionExecution and native HUMAN/adapter protocols. This
increment consumes the existing query/dry-run actions and the shared
`sourceResources` protocol field; it does not create a Wren permission ticket,
task registry, workflow engine, SQL parser or Core SQL-body store.

The fixed official source was reread using `git grep` and `git ls-tree`:
`c5f02a0391c87420dba78632dcd86073710deb72`,
`wren-ui/src/apollo/server/resolvers/modelResolver.ts::ModelResolver.previewSql`,
`wren-ui/src/apollo/server/repositories/apiHistoryRepository.ts::ApiHistoryRepository`,
`wren-ui/src/components/modals/AdjustSQLModal.tsx::AdjustSQLModal`,
`wren-ui/src/components/modals/FixSQLModal.tsx::FixSQLModal`, and
`wren-ui/src/components/modals/QuestionSQLPairModal.tsx::QuestionSQLPairModal`.
That UI tree fixes `wren-engine` to
`47ca29ebba291100ba5d70ce1790f9887eaed7a0`. No reference-directory content was
modified or executed.

The four implementation impact checks are as follows.

1. Authority and status: original native SQL preview is supported upstream;
   Kailo's HUMAN admission, separate dry-run policy and full-source execution
   checks are authorized adaptations. The original three forms, editors,
   preview/submit controls and layout remain. No replacement page is added.
   This is a source-level difference classification for this increment, not
   a claim that the entire Wren/UI diff or every original page is accepted.
2. Readers and writers: the original `ModelResolver.previewSql` now consumes
   current trusted identity/scope and `NativeHumanQuery.previewSql`.
   `NativeQueryService.sqlSelection/sqlReference/sqlIntent` and the original
   `ApiHistoryRepository.prepareNativeSql/reserveGovernedQuery` freeze and
   consume the native SQL/deployment/source input. The original GraphQL input,
   TypeScript model and generated client type add optional opaque key/scope
   fields; all three original modal callers actually provide them through
   `useGovernedSqlPreview`. There is no new table or migration. Old bound
   clients missing current identity/key evidence are refused, not silently
   routed to direct SQL. Old history rows without frozen sources are not
   backfilled or replayed to manufacture evidence.
3. Side effects: before admission, the same original `api_history` row is
   an immutable native ContentReference input with no AE/Operation/execution
   state. Its HTTP 202 and zero duration satisfy the original non-null native
   history columns and do not claim SQL execution. The first authenticated
   adapter dispatch locks and claims that same row, attaching the original
   AE/Operation and UNKNOWN state. Duplicate delivery cannot claim it again.
   SQL, body and source history stay in Wren; Core receives references,
   revisions and source metadata only. No second execution authority is added.
4. Boundaries: malformed or changed SQL/key/scope/limit/source/deployment
   evidence is refused before SQL or result disclosure. Resource/action denial
   is not filtered out of a multi-source query. Missing source evidence is
   unavailable, not an empty successful result. Native transport uncertainty
   preserves UNKNOWN, the original native ID and opaque browser key; neither
   a transport exception nor an unverified COMPLETED label validates an edit.
   Concurrent dispatch, reentry, revocation before disclosure, identity change,
   hidden/closed/reset editors and late responses have actual consumers below.
   Refusals use the existing NativeQueryRefusal/Core ErrorBody translation;
   UNKNOWN is not converted into a successful or failed business terminal.

`NativeQueryService.reauthorize` sends all original frozen model/view sources
through the existing execute PEP. The original successful execution/replay
response carries the same source set. This removes the prior single-object
restriction only after the actual full-source consumer is called. It does
not make source metadata a permission grant. The original primary Resource,
binding, project, deployment/hash, native identities and frozen source set are
still checked, including hidden subquery/view dependencies.

`NativeHumanQuery.disclose` rereads the same completed history and sources,
then sends `sourceResources` to the original same-AE/idempotency-key observation
before returning the body. The shared Core consumer must apply current action
and read/export policy intersection there. Source fields are not added to HUMAN
command or resource-resolution requests. These checks use a controlled Core
PEP peer; they do not by themselves prove the new Core implementation, Java
Analyzer or live Wren instance has been jointly accepted.

Query and dry-run use separate existing actions and actual delivered result
exposure policies. `dryRunAction` has the original closed policy id/version
shape; absence refuses validation rather than inheriting the query policy.
Only a verified completed dry-run with its native validation body advances the
original submit flow. The browser stores only opaque intent/key identifiers,
never SQL, credentials or results. UNKNOWN retries reuse the key. Visibility,
scope changes, reset and superseded requests fence late results without deleting
the admitted pending intent. Apollo's transport error is not exposed as the
original Fix SQL syntax-failure display when the native outcome is unknown.
Necessary governance notices reuse existing Chinese/English receipt vocabulary;
complete native-product Chinese/English coverage is not claimed.

Verification reused `kailo-wren-query-sdk-itgs2n` with 4 CPU / 4 GiB memory and
4 GiB memory-plus-swap limits, existing mounts/cache and existing isolated
PostgreSQL. Existing builds and host CPU/memory/disk pressure were checked.
No new database service, image or release was created. The original offline
GraphQL codegen ran against `src/apollo/server/schema.ts`, exit 0; the generated
client diff is only the two optional input fields, not formatting churn.

Actual original commands, inside that existing SDK:

```sh
./node_modules/.bin/tsc --noEmit --incremental false
./node_modules/.bin/jest src/nativeQuery.test.ts src/nativeHumanQuery.test.ts src/viewMetadata.test.ts --runInBand
./node_modules/.bin/jest src/viewMetadata.test.ts --runInBand
./node_modules/.bin/prettier --check src/apollo/server/models/model.ts src/apollo/server/repositories/apiHistoryRepository.ts src/apollo/server/resolvers/modelResolver.ts src/apollo/server/schema.ts src/apollo/server/services/nativeHumanQuery.ts src/apollo/server/services/nativeQueryAdmission.ts src/apollo/server/services/nativeQueryService.ts src/components/modals/AdjustSQLModal.tsx src/components/modals/FixSQLModal.tsx src/components/modals/QuestionSQLPairModal.tsx src/hooks/useGovernedSqlPreview.ts src/nativeHumanQuery.test.ts src/nativeQuery.test.ts src/viewMetadata.test.ts
```

An initial candidate failed: the native suite reported 94 passed / 1 failed,
and the HUMAN suite did not compile. The checks were corrected to compare
PostgreSQL JSONB semantically instead of relying on property order, and to
explicitly type the controlled HUMAN peer value. A later candidate had a
missing closing brace and failed compilation; that implementation error was
fixed. These failed candidates are retained in the logs, not counted as passes.

After correction, the three original suites reported 189/189 passed, zero
skips, exit 0 (26.618 s). The native pre-admission history phase was then checked
against the original non-null columns: 189/189 passed, zero skips, exit 0
(26.827 s). Whole-UI TypeScript exited 0.

Three real protections were deliberately removed only in the private SDK copy:
immutable prepared native sources, the completed HUMAN observation source
payload, and the verified COMPLETED body requirement. The original consumers
reported 6 failed / 183 explicitly name-filtered skips / 0 passed, exit 1
(9.859 s). The failures caught replacing frozen input, disclosing after source
policy denial, missing same-AE source checks and false SQL validation. All 15
formal UI/backend inputs, including the generated type and new consumed hook,
were restored and matched with `cmp`; the 14 handwritten TypeScript inputs
passed original Prettier. The restored three suites reported 189/189 passed,
zero skips, exit 0 (441.624 s); whole-UI TypeScript again exited 0.

The final changes affect only the new hook and its three original modal
consumers plus the existing UI check: hidden/reset editors fence late completion
and an Apollo transport error cannot label UNKNOWN as SQL syntax failure.
Removing the reset revision and transport-error isolation in the private copy
caused 2 failed / 27 explicitly name-filtered skips, exit 1 (6.790 s). After
restoring and comparing all 15 inputs, original Prettier passed and the complete
original `viewMetadata.test.ts` suite reported 29/29 passed, zero skips, exit 0
(6.081 s); final whole-UI TypeScript exited 0. The unchanged PostgreSQL/backend
189-check set was not rerun for those last frontend-only changes. This is not
reported as a fictitious final combined 190-check run.

Logs are under the existing directory
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/`:
`native-sql-editor-positive.log` (initial failed checks),
`native-sql-editor-source-positive.log` (compilation error),
`native-sql-editor-source-final-positive.log` (189/189),
`native-sql-editor-input-phase-positive.log` (189/189),
`native-sql-editor-source-tsc.log` (exit 0),
`native-sql-editor-source-negative.log` (six real failures),
`native-sql-editor-source-restored.log` (restored 189/189),
`native-sql-editor-source-restored-tsc.log` (exit 0),
`native-sql-editor-reset-negative.log` (two real failures),
`native-sql-editor-final-format.log`, `native-sql-editor-final-ui.log` (29/29),
and `native-sql-editor-final-tsc.log` (exit 0, empty successful compiler output).

Remaining delivery gaps are not removed from the original product scope. The
Java source endpoint still rejects FunctionCall nodes, including ordinary
count/sum. The fixed original function-directory facts classify functions but
do not prove hidden provider reads absent; no guessed name whitelist or blanket
function bypass is introduced. Java compilation and actual Analyzer HTTP are
unverified. Real datasource/LLM integration, remaining native writes and full
generated-answer behavior, complete native Chinese/English coverage, iframe
navigation/upload/download/revocation screenshots, a real deployed Wren business
instance and ACTIVE binding, Windows/Mobile acceptance and global `check.sh
--full` are not accepted by this increment. No deployment, installation package
or 100% original-feature/style parity is claimed.

### Live PostgreSQL reader-role revalidation (2026-10-08)

Implemented against `.design/08` §6 and DD-98, preserving the original query
consumer at Wren UI commit `c5f02a0391c87420dba78632dcd86073710deb72`,
`wren-ui/src/apollo/server/services/queryService.ts::QueryService.preview`.
The change reuses Kailo's existing
`wren-ui/src/apollo/server/services/nativeBindingService.ts::verifyPostgresReader`;
it does not introduce another database privilege authority or SQL parser.

The four implementation conclusions are:

1. Authority: the original native database remains responsible for its role
   graph and ACLs; the existing native reader check consumes those current
   facts. A frozen project/SecretRef fingerprint alone cannot prove the role
   has not gained write or dangerous function privileges.
2. Impact: `NativeQueryService.execute` now consumes that same check from its
   actual `reauthorize` closure, before SQL, after source freezing, after
   completion and on completed reentry. `completedQuerySources`, consumed
   twice by the original HUMAN disclosure path, uses the same check. No
   schema, contract, history format, page, layout or execution authority changed.
3. Side effects: a pre-SQL refusal preserves the original proven-unsent
   `FAILED` / `NOT_DISPATCHED` history. Refusal to disclose an already completed
   result does not rewrite `SUCCEEDED`, discard its body or run SQL again.
   Metadata-only observation still reports the verified original outcome.
4. Boundaries: direct grants, inherited writable roles, changes during SQL and
   changes after the real source-freeze transaction are rejected. Removing
   the grant restores access to the same successful result without another
   query; it does not rerun a proven-unsent failed intent. Original UNKNOWN
   behavior remains unchanged. Native role denial is `DENIED`; connection
   fingerprint drift is `PRECONDITION`; insufficient outcome evidence remains
   `UNKNOWN`, following the six classes in `06` §4.

Verification reused the existing `kailo-wren-query-sdk-itgs2n` SDK and cache,
4 CPU / 4 GiB memory / 4 GiB memory-plus-swap. Before execution, existing
processes, memory/CPU pressure and Data availability were checked; final Data
availability was 1.3 GiB. The original isolated PostgreSQL fixture performed
actual role grants/revocations and ACL queries. The Ibis HTTP boundary was a
controlled peer, not an accepted running Ibis/Java/business deployment.

Actual original commands inside that SDK:

```sh
./node_modules/.bin/jest src/nativeQuery.test.ts --runInBand -t 'validates the actual binding route'
./node_modules/.bin/jest src/nativeQuery.test.ts --runInBand
./node_modules/.bin/tsc --noEmit --incremental false
./node_modules/.bin/prettier --check src/nativeQuery.test.ts src/apollo/server/services/nativeQueryService.ts
```

Four initial candidates each reported 68 passed / 1 failed. These checks had
incorrect assumptions about refreshed observation timestamps, Date-versus-JSON
terminal timestamps, a second Analyzer call despite the original cached source
analysis, and the original `NOT_DISPATCHED` error payload. The checks were
corrected to consume actual wire semantics and the real source-freeze write;
production state semantics were not changed to satisfy the checks. The focused
fixture then passed 1 test / 68 explicitly name-filtered skips, exit 0
(11.151 s).

Only in the private SDK copy, removing the completed-HUMAN reader recheck caused
1 failed / 68 explicitly name-filtered skips, exit 1 (10.629 s): a revoked
source disclosure incorrectly resolved. After restoring it, removing the
execute recheck caused 1 failed / 68 explicitly name-filtered skips, exit 1
(10.513 s): revoked reentry returned 200 instead of 403. Both formal inputs
were restored and compared with `cmp`. The complete restored original native
query suite passed 69/69, zero skips, exit 0 (24.238 s). Whole-UI TypeScript,
original Prettier and `git diff --check` also exited 0.

Logs remain in the existing SDK mount directory listed in the preceding
increment: `native-query-reader-drift-positive.log`,
`native-query-reader-drift-final-positive.log`,
`native-query-reader-drift-restored-positive.log`,
`native-query-reader-drift-positive-final.log` (the four failed candidates),
`native-query-reader-drift-target-positive.log`,
`native-query-reader-drift-human-negative.log`,
`native-query-reader-drift-execute-negative.log`,
`native-query-reader-drift-restored.log`,
`native-query-reader-drift-restored-format.log` and
`native-query-reader-drift-restored-tsc.log` (empty successful compiler output).

This is a live read-only-role integrity check, not proof that a particular
physical table still grants SELECT. Per-source platform Resource/policy checks
remain in the original execution/disclosure chain. The separate original API
History payload-read consumer is being changed; that new increment has not
been verified by these results. Java function provenance, AI callback identity,
real Wren instance/binding, native iframe screenshots and a production release
remain unaccepted. No new image, deployment or installation package was built.

### Original API History governed body consumer (2026-10-08)

The fixed original source is Wren UI commit
`c5f02a0391c87420dba78632dcd86073710deb72`,
`wren-ui/src/apollo/server/resolvers/apiHistoryResolver.ts::ApiHistoryResolver.getApiHistory`
and `ApiHistoryResolver.getApiHistoryNestedResolver`, with the original client
document `wren-ui/src/apollo/client/graphql/apiManagement.ts::API_HISTORY`.
The original nested response sanitizer did not authorize the original SQL
request or stored result body. Kailo's existing middleware identity alone did
not supply that missing resource/result decision. These references were
rechecked with `git cat-file` and `git grep` at the full fixed commit; no code
from `.references` was executed or changed.

The four implementation conclusions are:

1. Authority: `.design/08` §6 and DD-98 require the existing action receipt and
   current authorization before native result disclosure. The original
   `api_history` remains the only Wren query/body authority. The consumer reuses
   `NativeHumanQuery.disclose`, the original Core same-AE HUMAN observation,
   frozen source Resource resolution and the read/export policy intersection;
   no new command, query execution, task, permission ticket or body copy in Core
   is created when reading history.
2. Impact: `getApiHistory` keeps original count, pagination, filters and dates
   while enforcing the configured project and binding. Both original GraphQL
   `requestPayload` and `responsePayload` fields call `readHistory` for bound
   HUMAN requests. The existing response sanitizer and the unbound original
   service behavior remain. The original history page, client query document,
   schema, layout and controls are unchanged. Credential-bearing headers remain
   subject to the existing repository's metadata-only allowlist.
3. Side effects: missing, UNKNOWN, mismatched AE/native history, changed input,
   changed stored body, stale native sources or current native role denial
   refuses the body. Reading cannot create an admission or rerun SQL. The final
   existing native source/reader recheck now occurs after the final Core
   authorization round trip, so a local role/view change during that round trip
   cannot borrow an earlier check. The existing successful native terminal is
   not rewritten into failure merely because disclosure is now refused.
4. Boundaries: exact project/binding, action, AE, operation, original intent key,
   parameter digest, native history ID, deployment, SQL revision and frozen
   source facts are consumed. The selected history request and returned result
   are compared with the original history again after authorization. Foreign
   project filters are denied before count/read. Missing trusted HUMAN context
   is `DENIED`; binding/project drift is `PRECONDITION`; insufficient terminal
   evidence remains `UNKNOWN`, using `06` §4. Only query/dry-run histories with
   verified successful evidence are accepted by this body consumer. Native
   failed/pending and non-query history bodies remain an explicit integration
   gap, not an invented success or accepted complete history feature.

Verification used the same existing 4 CPU / 4 GiB SDK, cache and isolated
PostgreSQL fixture from the preceding increment. Pressure, existing processes,
cgroup limits and Data availability were checked before the final run; Data had
1.2 GiB available. The original SDL and original `API_HISTORY` client document
were executed through `ApolloServer` and the actual `ApiHistoryResolver` and
`NativeHumanQuery` consumers. Core and source-service boundaries in those HUMAN
checks were controlled fixtures; this is not a deployed Wren/Core/Engine
end-to-end acceptance.

Actual original commands inside `kailo-wren-query-sdk-itgs2n`:

```sh
./node_modules/.bin/jest src/nativeHumanQuery.test.ts --runInBand
./node_modules/.bin/jest src/nativeHumanQuery.test.ts --runInBand -t 'original API History GraphQL document'
./node_modules/.bin/jest src/nativeHumanQuery.test.ts --runInBand -t 'refuses native history mutation after source authorization'
./node_modules/.bin/jest src/nativeHumanQuery.test.ts --runInBand -t 'rechecks native reader privileges changed during final same-AE history authorization'
./node_modules/.bin/jest src/nativeQuery.test.ts src/nativeHumanQuery.test.ts --runInBand
./node_modules/.bin/tsc --noEmit --incremental false
./node_modules/.bin/prettier --check src/apollo/server/resolvers/apiHistoryResolver.ts src/apollo/server/services/nativeHumanQuery.ts src/apollo/server/services/nativeQueryService.ts src/nativeHumanQuery.test.ts src/nativeQuery.test.ts
```

The first history candidate passed 103/103 and TypeScript, exit 0. Removing
both field-level body checks only in the private SDK copy then caused the
original GraphQL document check to fail: 1 failed / 1 passed / 101 explicitly
name-filtered skips, exit 1 (6.946 s), exposing a revoked SQL request body.
After restoration, removing only the response-field check caused 1 failed /
1 passed / 101 explicitly name-filtered skips, exit 1 (6.690 s), exposing the
result despite the still-protected SQL request.

The final Core/native ordering implementation with its additional consumer
check passed 104/104 and TypeScript, exit 0 (7.220 s). In the private SDK copy,
removing the selected-request snapshot comparison caused 1 failed / 103
explicitly name-filtered skips, exit 1 (6.858 s): changed SQL was returned.
After restoration, removing the final native-reader/source recheck caused
1 failed / 103 explicitly name-filtered skips, exit 1 (7.173 s): a role changed
during the final same-AE authorization still disclosed the old body. All five
formal code inputs were restored and compared with `cmp` before the final
concentrated run. The complete original query and HUMAN suites then passed
173/173, zero skips, exit 0 (28.579 s). Whole-UI TypeScript, original Prettier
and `git diff --check` also exited 0; no failed candidate is treated as passing.

Logs remain in
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/`:
`native-api-history-positive.log`, `native-api-history-tsc.log`,
`native-api-history-graphql-negative.log`,
`native-api-history-result-negative.log`,
`native-api-history-latest-positive.log`, `native-api-history-latest-tsc.log`,
`native-api-history-snapshot-negative.log`,
`native-api-history-final-acl-negative.log`,
`native-history-reader-final-positive.log`,
`native-history-reader-final-format.log` and
`native-history-reader-final-tsc.log` (empty successful compiler output).

No image, real business instance, ACTIVE binding, deployment or installation
package was produced. Java function provenance/ordinary aggregate acceptance,
trusted AI SERVICE callback context, remaining native write consumers,
non-query/unsuccessful history bodies, complete native Chinese/English and
original-page screenshot parity remain unaccepted. Global `check.sh --full`,
Desktop and Mobile acceptance were not run by this increment. Passing the
original GraphQL document is not browser screenshot or full-feature parity
evidence.

## 2026-10-08 Original text-answer SQL result and native stream consumers

The implementation continues the fixed official source at
`c5f02a0391c87420dba78632dcd86073710deb72`, verified with `git show` / `git grep`:
`wren-ui/src/apollo/server/services/askingService.ts::generateThreadResponseAnswer`,
`wren-ui/src/apollo/server/backgrounds/textBasedAnswerBackgroundTracker.ts::TextBasedAnswerBackgroundTracker.start`,
`wren-ui/src/pages/api/ask_task/streaming_answer.ts::handler`,
`wren-ai-service/src/pipelines/generation/sql_answer.py::SQLAnswer.get_streaming_results`
and `SQLAnswer.run`, and
`wren-ai-service/src/web/v1/services/sql_answer.py::SqlAnswerService.get_sql_answer_streaming_result`.
These are original consumers, not replacement answer pages or a new executor.

The four implementation conclusions are:

1. Authority: `.design/08` §6 / DD-98 require current HUMAN admission and
   authorized result consumption. The bound original answer mutation now calls
   the existing `ModelResolver.previewSql` / `NativeHumanQuery` chain with the
   original SQL and original preview limit. Only its verified successful
   `wren.api_history` receipt and disclosed data enter the original AI
   `createTextBasedAnswer`. The background no longer reruns SQL against the
   newest deployment. The original query history remains the SQL/result
   authority; only its reference is attached to the original thread response.
2. Impact: original GraphQL mutation/schema/generated TypeScript, original Home
   answer caller, repository, background tracker and SSE consumer are changed
   together. The original page/layout/buttons/Markdown remain; the existing
   bilingual query-receipt wording is reused for required pending/refusal
   feedback. Middleware forwards only its already verified current HUMAN token
   and identity partition to the original stream route. Nested answer bodies
   and each streamed content exposure reuse the accepted same-AE API History
   reader. No HUMAN token is stored in the thread, sent to Python or reused as
   a SERVICE identity. Standalone unbound native answers keep their original
   execution path and persistence; both modes consume the same native SSE
   completion receipt.
3. Side effects: the original repository CAS binds response/thread/question/
   SQL/previous answer JSON before the non-idempotent AI create and before final
   answer persistence. Concurrent replacement cannot overwrite newer native
   intent. Reentry with the same SQL history rejoins the original AI task; a
   missing create acknowledgement never creates another AI task. A query
   receipt, source authorization or stored intent changing refuses result
   exposure, without rewriting an already successful SQL terminal into failure.
   The browser retains only an opaque intent key in its existing session
   partition, never SQL, result body or credentials.
4. Boundaries: TCP close, queue timeout, unknown native status and literal
   model-produced `<DONE>` are not completion. The original Python producer
   emits its internal completion marker only after its provider pipeline
   returns normally; its original SSE service carries the actual query ID.
   The Node consumer accepts that exact ID, rechecks current disclosure and
   CAS-writes the original FINISHED status. Missing/expired AI task lookup is
   now HTTP 404, not invented FAILED. The existing UNKNOWN/PRECONDITION/DENIED
   handling follows `06` §4; no new platform state or task authority is added.

Verification reused `kailo-wren-query-sdk-itgs2n`, its original dependencies and
cache, with 4 CPU / 4 GiB / no additional swap. Existing processes, host
pressure, cgroup limits and Data space were checked; Data had 641 MiB available
before the final narrow run. No database, image or dependency installation was
started. Original GraphQL Code Generator used the original `codegen.yaml`
against `print(typeDefs)` from the actual server SDL through the existing
`ts-node` / `@graphql-codegen/cli`; it exited 0 without fetching a remote schema.
Only the original `__types__.ts` and `home.generated.ts` outputs are changed.
Their original generator formatting is preserved, with only +3 and +12/-3
lines respectively. Applying the handwritten Prettier policy to those raw
generated outputs initially reported two formatting failures and would have
caused unrelated whole-file churn; rerunning the same original offline
generator restored its output, exit 0. The final 14 handwritten TS/TSX inputs
passed original Prettier, exit 0; raw generated outputs are not claimed to pass
that distinct formatting policy. `git diff --check` exited 0.

Actual original commands in that SDK were:

```sh
./node_modules/.bin/jest src/nativeProjectScope.test.ts src/nativeHumanQuery.test.ts src/nativeTextAnswer.test.ts src/middleware.test.ts src/nativeAskingView.test.ts src/nativeTaskOwnership.test.ts --runInBand
./node_modules/.bin/jest src/nativeTextAnswer.test.ts --runInBand
./node_modules/.bin/tsc --noEmit --incremental false
PYTHONDONTWRITEBYTECODE=1 python3 data-query/wren-ai-service/tests/pytest/providers/test_native_sql_answer_stream.py
./node_modules/.bin/jest src/nativeTextAnswer.test.ts --runInBand --testNamePattern='foreign-id|before each content exposure'
```

The first candidate had 3 suites pass / 1 fail, 240 passed / 7 failed: the new
stream check incorrectly spied an instance arrow property on the prototype.
The actual `NativeHumanQuery.readHistory` boundary replaced that invalid test
setup; the subsequent six suites passed 314/314, zero skips, exit 0 (15.2 s).
After consolidating the standalone and bound stream consumer and adding the
standalone/pre-authorization checks, the actual stream suite passed 9/9, exit
0 (6.537 s), and whole-UI TypeScript exited 0. The six-suite result precedes
this final stream-only revision; it is not claimed as a fresh all-suite run.

Deliberately removing per-content authorization and the native query-ID
comparison only in the private SDK copy caused 2 failed / 7 explicitly
name-filtered skips, exit 1 (6.229 s): revoked content leaked and a foreign task
receipt wrote FINISHED. Deliberately yielding completion on Python queue
timeout caused 1 failed / 4 passed, exit 1 (0.011 s), exposing a fabricated
`done` event. Both changes were restored using reverse patches and compared
against the formal source with `cmp`, exit 0. The restored stream suite passed
9/9, exit 0 (6.149 s); the actual original Python producer/service consumers
passed 5/5, exit 0 (0.008 s). Python checks substitute dependency boundaries,
not the production producer/service methods; they are not live model or
AgentGateway acceptance. Repository CAS service consumers pass, but no real
PostgreSQL CAS/concurrency run was performed in this increment.

Logs under the existing private SDK directory
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/`
are `native-text-answer-codegen.log`, `native-text-answer-positive.log`,
`native-text-answer-codegen-final.log`, `native-text-answer-format-final.log`,
`native-text-answer-final-positive.log`, `native-text-answer-stream-final.log`,
`native-text-answer-tsc-final.log` (empty successful compiler output),
`native-text-answer-negative.log`, `native-text-answer-python-negative.log`,
`native-text-answer-stream-restored.log` and
`native-text-answer-python-restored.log`.

No business runtime, ACTIVE ApplicationBinding, iframe, deployment or package
was produced or accepted. Trusted AI SERVICE SQL callback admission remains
unclosed: existing SERVICE source-read grants do not authorize native SQL.
Original AI create has no lookup-by-intent endpoint, so an acknowledgement
lost before its ID is persisted remains pending/unknown and is not silently
retried; its production reconciliation is still unaccepted. Complete model
usage/quota/AgentGateway runtime evidence, ordinary aggregate/function
provenance, the separate two Java changes, full original-page screenshots,
Chinese/English completeness, Desktop/Mobile and global `check.sh --full`
were not accepted by this batch. These limits do not remove those capabilities
from the delivery goal or claim the full Wren integration complete.

### Same original answer repository: actual PostgreSQL CAS consumer evidence

The preceding production increment is committed as
`2cad2897ec5525020a9c7c88a013db6b0c08712e`. Its production repository is unchanged
by this follow-up. The earlier SDK process-list check did not establish that
the original isolated database was absent: the SDK shares the network namespace
of the already running `kailo-installation-scope-pg-e4agxd`. Its actual existing
database is `wren_query_itgs2n`, current user `postgres`, with the original
`isolated-query-fixture` project and original thread/response JSONB schema.
Before and after this check, thread and response row counts were 0 and the
existing API History count was 1225. No other database was targeted.

The sole source change is an implementation-following independent `describe`
in the existing `wren-ui/src/nativeQuery.test.ts`. It reuses the original Jest,
Knex, `ThreadResponseRepository`, `ThreadRepository` and `AskingService`. The
original other describe is name-filtered out, so its migrations/setup do not
run. Each case inserts only transaction-local rows with explicit IDs, rolls
back in `afterEach` and checks the created response/thread IDs are absent.
There is no new database, schema, framework, migration, sequence allocation,
image or dependency installation. The same 4 CPU / 4 GiB SDK and caches are
used; host pressure, processes and limits were checked before execution, with
338 MiB available on Data.

Eight actual database consumers verify SQL NULL and ordered/unordered JSONB
snapshot consumption; SQL/question/thread/answer changes refuse without
overwriting native state; two same-snapshot repository claims admit only one;
overlapping original Asking calls read the same native intent and create one
AI task; reentry after a lost AI acknowledgement preserves the stored claim
and never creates again. Concurrent callers share the same outer PostgreSQL
transaction/connection to permit complete rollback. This is actual database
CAS and original service-consumer evidence, not cross-connection locking or
live AI/provider acceptance. Only the external original AI adaptor boundary
and background registration are controlled fixtures.

The initial run had 7 passed / 1 failed / 69 name-filtered skips, exit 1
(123.348 s). The native schema defaults `answer_detail` to JSONB `{}`; the
initial changed-answer fixture wrote `{}` again and therefore did not actually
change the snapshot. The fixture now explicitly selects SQL NULL before
changing it to `{}`. Reading the full original repository inheritance also
corrected an initial diagnosis: `BaseRepository.createOne` preserves SQL NULL;
it does not JSON-stringify that field. No native JSONB-null writer was found,
so no speculative production NULL-handling patch was made. The corrected
eight consumers passed, 69 original checks explicitly filtered out, exit 0
(7.255 s), and whole-UI TypeScript exited 0.

Removing only the actual production repository's previous-answer predicate
in the private SDK copy then caused 3 failed / 74 name-filtered skips, exit 1
(7.807 s): a changed answer was overwritten, both same-snapshot claims won and
the original concurrent Asking consumer created two AI tasks. The exact
predicate was restored with a reverse patch and compared to the formal source
using `cmp`, exit 0. The restored eight consumers passed, 69 filtered skips,
exit 0 (7.919 s); original Prettier and `git diff --check` also exited 0.

Actual commands reused the preceding original Jest entry with
`--testNamePattern='original Wren native answer PostgreSQL CAS'`, the negative
filter `original Wren native answer PostgreSQL CAS.*(answerDetail|same native snapshot|concurrent original Asking)`,
and `./node_modules/.bin/tsc --noEmit --incremental false`. The existing
`WREN_QUERY_TEST_DATABASE_URL` was set only to the independently verified
isolated database. Logs in the same private SDK directory are
`native-text-answer-pg-positive.log`, `native-text-answer-pg-final-positive.log`,
`native-text-answer-pg-tsc.log`, `native-text-answer-pg-negative.log`,
`native-text-answer-pg-restored.log` and `native-text-answer-pg-format.log`.
The previously stated deployment, binding, full native functionality, browser,
Desktop/Mobile and provider/governance runtime gaps remain unchanged.

### Original chart generation and adjustment: actual governed result consumers

Authority and fixed upstream: `.design/07` §§2/4.6, `.design/08` §2.3 and
DD-98 keep the full native GenBI application while requiring current HUMAN
query/result authorization. The read-only source baseline is
`c5f02a0391c87420dba78632dcd86073710deb72` in
`.references/WrenAI-ui-0.32.2`. Verified original symbols are
`wren-ai-service/src/web/v1/services/chart.py::ChartRequest/ChartService.chart`,
`wren-ai-service/src/web/v1/services/chart_adjustment.py::ChartAdjustmentService.chart_adjustment`,
`wren-ui/src/apollo/server/adaptors/wrenAIAdaptor.ts::transformChartAdjustmentInput`,
`wren-ui/src/apollo/server/services/askingService.ts::generateThreadResponseChart/adjustThreadResponseChart`,
and `wren-ui/src/apollo/server/backgrounds/chart.ts::ChartBackgroundTracker`.
Original generation already supports supplied `data`; adjustment now consumes
the same native shape. The original pipelines, controls, chart renderer,
adjustment form and standalone SQL path are retained, not replaced by summary
cards or a new chart implementation.

The implemented impact chain is original GraphQL/Home mutations → current
HUMAN `ModelResolver.previewSql` → the existing query receipt/API History →
original Asking service → original AI generation/adjustment with disclosed
data → original trackers and response JSONB → current HUMAN history disclosure
before exposing chart detail. The existing `thread_response.chart_detail`
stores only native query/history IDs, original chart state and adjustment
intent; exact id/thread/question/SQL/previous-chart CAS claims precede native
create and terminal writes. No Core SQL/result copy, new table, migration,
task registry, execution authority or permission ticket is introduced.
Original GraphQL gains optional governance arguments and receipt/adjustment
fields; existing codegen regenerated the original client types/hooks. No
shared four-language contract changed. Existing unproven chart rows are not
silently treated as authorized; the original empty JSONB default remains an
empty chart. Native standalone calls keep their existing optional-data path.

Side-effect and exception behavior: exact same query/history/adjustment intent
rejoins its original AI task; changed SQL/question/chart/adjustment or a lost
concurrent CAS refuses, never overwrites. The already frozen query uses the
existing capacity/approval/quota/source authorization and disclosure path;
supplied zero-row data is still supplied data and never calls SQL again.
No HUMAN token enters AI input, and no SERVICE callback impersonates HUMAN.
Unknown status/chart type, missing terminal fields, native task expiry/404,
transport timeout and acknowledgement lost before native task ID persistence
remain unknown; polling releases its lock and only retries the known ID.
The lost-create claim is not replayed under another key. Current scope or
authorization failure blocks disclosure; a chart changed while disclosure is
being checked is rejected. These consume the existing `apps/06` §4 classes:
DENIED for identity/scope/exposure; BLOCKED for unadmitted SERVICE SQL;
PRECONDITION for absent binding/secret/terminal evidence; LIMIT for existing
query admission limits; CONFLICT for exact native snapshot/intent changes;
UNKNOWN for unobserved external outcomes. No unknown is rendered as a proved
business failure or success. Browser session storage contains only the
existing opaque idempotency key, scoped by actual query scope and artifact.

Validation reused `kailo-wren-query-sdk-itgs2n` with its existing dependencies,
cache and independently rechecked 4 CPU / 4 GiB / no-extra-swap limits. Existing
processes/host pressure were checked before execution; no image, dependency
download, database creation or whole-tree copy occurred. Actual commands were:

```sh
node node_modules/jest/bin/jest.js --runInBand src/nativeProjectScope.test.ts src/nativeHumanQuery.test.ts src/nativeTextAnswer.test.ts src/nativeAskingView.test.ts src/nativeTaskOwnership.test.ts src/middleware.test.ts
node node_modules/jest/bin/jest.js --runInBand src/nativeQuery.test.ts --testNamePattern='original Wren native answer PostgreSQL CAS'
node node_modules/jest/bin/jest.js --runInBand src/apollo/server/adaptors/tests/wrenAIAdaptor.test.ts --testNamePattern='chart'
node node_modules/typescript/bin/tsc --noEmit --incremental false
PYTHONDONTWRITEBYTECODE=1 python3 data-query/wren-ai-service/tests/pytest/providers/test_native_sql_answer_stream.py
```

The first candidate had five suites pass and one test-type compilation fail,
224 passing checks, exit 1; whole-UI TypeScript exited 2. The actual dynamic
fixture invocation/enum and Home identity-call fields were corrected. Final
restored six suites passed **340/340**, zero skips, exit 0 (13.729 s); whole-UI
TypeScript exited 0. Original offline GraphQL generation and original Prettier
exited 0. The actual chart HTTP adaptor consumer passed 1/1, 11 other adaptor
checks explicitly name-filtered out, exit 0. A separate full seven-suite run
had 351 passed / 1 failed, exit 1: the original recommendation check expects
`project_id`, while the fixed official
`wren-ui/src/apollo/server/adaptors/wrenAIAdaptor.ts::generateRecommendationQuestions`
does not send that field either. That unrelated failure is preserved, not
weakened or reported as passing.

The existing isolated `wren_query_itgs2n` database/current user `postgres` and
`isolated-query-fixture` identity were independently checked. Twelve actual
repository/service CAS consumers passed, 69 unrelated original checks
name-filtered out, exit 0 (7.002 s). This adds four chart SQL/question/snapshot
and concurrent-claim consumers to the preceding eight answer checks. As in
that preceding receipt, each case rolls back the same original outer
transaction/connection; it is not evidence of cross-connection lock behavior.
Final response/thread counts remain 0, API History remains 1225.

Real private production faults were then introduced and restored:

- Removing the previous-chart repository predicate produced 2 failed / 2
  passed / 77 filtered skips, exit 1: changed detail overwrote and both claims
  won. The reverse patch restored the exact predicate; formal/private `cmp`
  exited 0, followed by the restored 12/12 database result above.
- Removing the actual nested chart history-disclosure call produced 2 failed /
  3 passed / 11 filtered skips, exit 1: missing fresh authorization and revoked
  chart disclosure were caught. Reverse patch and `cmp` exited 0, followed by
  the restored 340/340 suites above.
- Forcing original Python adjustment to run SQL despite supplied data produced
  1 failed / 7 passed, exit 1. Reverse patch and `cmp` exited 0; the original
  producer/service checks then passed 8/8, exit 0 (0.013 s), including empty
  data, retained standalone SQL and absent-task 404 behavior. These substitute
  external dependency boundaries, not the production service/pipeline calls;
  they are not live AI/provider acceptance.

Logs in the preceding existing private SDK directory are
`native-chart-codegen.log`, `native-chart-positive.log`,
`native-chart-tsc.log`, `native-chart-tsc-final.log`,
`native-chart-final-positive.log`, `native-chart-adaptor-positive.log`,
`native-chart-pg-positive.log`, `native-chart-pg-negative.log`,
`native-chart-disclosure-negative.log`, `native-chart-python-positive.log`,
`native-chart-python-negative.log`, `native-chart-python-restored.log`,
`native-chart-restored.log`, `native-chart-pg-restored.log` and
`native-chart-format-final.log`. `git diff --check` exited 0.

No business runtime, ACTIVE binding, iframe, live datasource/model execution,
browser screenshot, Desktop/Mobile or global full check was performed or
accepted. The separate two Engine Java changes remain **unvalidated**: the
existing SDK has no `java`, `javac` or `mvn`; no dependency/tool installation
was attempted. Ordinary aggregate/function provenance, trusted SERVICE SQL
admission and lost-native-create reconciliation remain actual delivery gaps,
not removed original features or claimed completed production behavior.

### 2026-10-08 — observe original AI tasks after a lost create acknowledgement

Authority and fixed-source facts were checked before the implementation:
DD-98 and `apps/06` §4 require unknown external outcomes to remain unknown,
without another side effect. At official Wren pin
`c5f02a0391c87420dba78632dcd86073710deb72`,
`wren-ai-service/src/web/v1/services/__init__.py::BaseRequest.query_id`
is a private property, not a caller-supplied request field.
`wren-ai-service/src/web/v1/routers/sql_answers.py::sql_answer`,
`wren-ai-service/src/web/v1/routers/chart.py::chart` and
`wren-ai-service/src/web/v1/routers/chart_adjustment.py::chart_adjustment`
always allocate a new UUID, populate their original service cache, then
schedule their original method through FastAPI `BackgroundTasks`. Their
existing GET handlers observe the same native ID. The original services
use process-local `TTLCache`, configured through
`wren-ai-service/src/globals.py::create_service_container`; there is no
durable native intent lookup. The original
`wren-ai-service/src/__main__.py` module entrypoint uses one worker. These
facts do not prove cross-process registration or durable exactly-once.

Impact and actual consumers: the same original three request models now
accept optional UUID `native_task_id`; the existing three POST routers use
it, refuse duplicate cached registration before scheduling, and otherwise
retain their original implementation. Without that field they still
allocate the original native UUID. Original `WrenAIAdaptor` create calls
send the frozen ID. Original `AskingService` first CASes that ID and the
existing query-history reference into original response JSONB, registers
the original tracker, then makes one POST. The returned ID must equal the
frozen ID. Answer/chart/adjust reentry and a CAS loser use their existing
GET for that exact ID before acknowledging a still-pending create; the
pre-POST ID alone is not an acknowledgement. The original Home caller can
therefore retain its exact opaque key on an unobservable create without
new page, state enum or identity field. Original trackers still own native
status persistence, exact snapshot CAS, chart terminal evidence and answer
preprocessing-to-stream transition; preprocessing success is not answer
completion. No Core SQL/body, new table, task registry or workflow was added.

Compatibility uses the original JSONB fields and optional native request
field; no database migration or four-language contract change is needed.
Legacy indeterminate rows without an AI ID remain unknown, not silently
replayed or assigned a new ID. A new UI against an old AI server cannot
mistake its different generated ID for acceptance: it refuses the foreign
acknowledgement. A compatible UI/AI release is still required for this
controlled fixed-ID path. Native standalone requests without an ID retain
their original behavior.

Side effects and boundaries: simultaneous claims admit one original POST;
lost HTTP acknowledgement observes the persisted ID, never another POST or
SQL call. Native 404, unknown status, transport failure, cache expiry,
process loss or a crash between JSONB claim and POST do not prove unsent,
failed or completed work. They retain UNKNOWN and the original reference;
there is no blind resend or invented terminal receipt. A surviving native
task can converge through the original tracker. Cache/process loss remains
a concrete reconciliation blocker, not durable recovery or production
readiness. Current HUMAN/source authorization and exact response/history
checks still precede execution/disclosure. Existing DENIED/PRECONDITION/
LIMIT/CONFLICT/BLOCKED classifications stay unchanged; unobservable native
outcomes consume UNKNOWN. No default identity, shared credential or new
SERVICE-to-HUMAN callback is introduced.

The previous original adaptor recommendation failure was also a real
consumer defect, not merely an assertion mismatch. At the same official
pin, `wren-ai-service/src/web/v1/services/question_recommendation.py::`
`QuestionRecommendation.recommend` and `_validate_question` consume
`input.project_id` for original schema, SQL-pair, instruction and function
retrieval. Original UI `generateRecommendationQuestions` omitted that field,
and its thread/instant/project callers did not supply it. Those original
consumers now pass the selected native project ID end to end; the project
caller builds MDL from that same selected project and preserves its original
`regenerate` input. Original tests were not weakened. This restores native
retrieval scoping; it does not establish trusted SERVICE SQL admission or
function authorization provenance.

Checks reused only `kailo-wren-query-sdk-itgs2n`, its existing dependencies,
cache and verified 4 CPU / 4 GiB / no-extra-swap limits. Process and pressure
checks preceded execution. There was no new image, database, dependency
download, full-tree copy or global build. Actual commands were:

```sh
node node_modules/jest/bin/jest.js --runInBand src/nativeProjectScope.test.ts src/nativeHumanQuery.test.ts src/nativeTextAnswer.test.ts src/nativeAskingView.test.ts src/nativeTaskOwnership.test.ts src/middleware.test.ts src/apollo/server/adaptors/tests/wrenAIAdaptor.test.ts
WREN_QUERY_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/wren_query_itgs2n node node_modules/jest/bin/jest.js --runInBand src/nativeQuery.test.ts --testNamePattern='original Wren native answer PostgreSQL CAS'
node node_modules/typescript/bin/tsc --noEmit --incremental false
PYTHONDONTWRITEBYTECODE=1 python3 data-query/wren-ai-service/tests/pytest/providers/test_native_sql_answer_stream.py
```

First six-suite ACK check: **346/346**, exit 0 (106.735 s). After the actual
recommendation repair, seven suites passed **364/364**, exit 0 (13.581 s).
After private production faults and exact restoration, the same seven
suites passed **364/364**, exit 0 (13.949 s). Whole-UI TypeScript exited 0;
original Prettier exited 0. The existing database identity was independently
verified as `wren_query_itgs2n`/`postgres`, project `isolated-query-fixture`.
Twelve original real repository/service CAS checks passed, 69 unrelated
checks explicitly filtered out, exit 0 (7.924 s); the same original outer
transaction/connection rolls back, not a cross-connection locking proof.
Final thread/response counts remained 0 and API History remained 1225.
Original Python router/service checks passed **10/10**, exit 0 (0.015 s).
Their external dependency substitutions do not validate live Pydantic/ASGI,
TTL scheduling, an LLM provider or production service deployment.

Private production faults, never applied to the formal worktree:

- Forcing the original answer router to allocate another UUID caused 1/10
  failure; removing its duplicate-registration guard caused 1/10 failure.
  Each was reverse-patched; `cmp` exited 0 and Python restored to 10/10.
- Removing exact answer/chart ACK checks and replacing the pending answer
  GET with a fabricated observation caused 4 failed / 91 filtered skips,
  exit 1. The actual foreign ACK and unobservable-ID consumers caught this;
  reverse patch and `cmp` exited 0 before the restored seven-suite run.
- Dropping original recommendation project/regeneration fields caused
  2 failed / 1 passed / 13 filtered skips, exit 1. Reverse patch and `cmp`
  exited 0 before the restored seven-suite run.

Logs are in the same existing private SDK directory recorded above:
`native-create-positive.log`, `native-create-recommendation-positive.log`,
`native-create-python-positive.log`, `native-create-python-id-negative.log`,
`native-create-python-duplicate-negative.log`, `native-create-python-restored.log`,
`native-create-ack-negative.log`, `native-create-recommendation-negative.log`,
`native-create-restored.log`, `native-create-pg.log` and `native-create-tsc.log`.
No live business runtime, ACTIVE binding, iframe, provider/datasource call,
browser screenshot, Desktop/Mobile or global full check was accepted.
The two earlier Engine Java files remain separately **unvalidated** and are
not part of this batch. Function provenance, trusted SERVICE SQL and native
cache-loss recovery remain explicit complete-delivery gaps.

### 2026-10-08 — original run_sql consumes HUMAN query admission and history

Authority and upstream comparison: `DD-98`, `SS-WRN-IDENTITY` and the existing
`.design/08` §6 query Action apply to the original REST consumer as well as
GraphQL. The fixed official UI commit
`c5f02a0391c87420dba78632dcd86073710deb72`,
`wren-ui/src/pages/api/v1/run_sql.ts::handler`, directly invokes native
`QueryService.preview`. That original behavior is retained only in independent
Wren without configured platform binding. The authorized difference is the
bound execution/disclosure chain, not a replacement page, SQL parser or executor.

The actual bound REST handler now consumes the existing
`NativeHumanQuery.previewSql` and `NativeQueryService.sqlSelection/sqlReference/
sqlIntent/completedQuerySources`. Middleware forwards the independently verified
native token and identity partition only on this exact bound REST route. Core
still authenticates the original token, admits the same query Action and applies
all frozen model/view source policies; a middleware entitlement is not permission
to execute SQL. Empty/broken delivery configuration, missing identity/scope/key,
changed project/person/SQL/thread and current source revocation cannot fall back
to original standalone execution.

Impact and storage: callers keep original `sql`, `limit`, optional `threadId`
and the successful `id`, `records`, `columns`, `threadId`, `totalRows` response.
A bound caller supplies one UUID `Idempotency-Key` and reuses it when observing
an uncertain request; no server-generated replacement execution key is added.
An omitted thread uses that existing UUID. The thread is stored in the original
`api_history.thread_id` before the Core command, including a check against a
competing prepare winner. Subsequent observations validate the same original
thread. The existing optional service argument has real REST consumers; existing
GraphQL consumers remain unchanged. No schema/migration/four-language contract
change, second history row, workflow or registry was introduced. SQL, result rows
and native provenance remain exclusively in the original Wren history, not Core.

Side effects and boundaries: the bound handler never calls the native driver or
ordinary `respondWith`/`handleApiError`, which would create another ungoverned
history. It never persists request headers or raw provider error messages. The
existing real repository already filters history headers to content-type/accept;
this batch does not introduce a duplicate filter. Only a completed, currently
authorized original receipt discloses records. Pending/UNKNOWN returns 202 and
the original receipt; denied returns 403; proven unsuccessful terminal receipts
return 409 without records. Unrecognized or inconsistent evidence returns 503,
not a fabricated success/failure or permission to execute another key.
TERMINATED/TIMED_OUT checks are defensive contract consumers, not evidence that
Core currently produces additional native business terminal classes.

Actual validation used the existing 4 CPU / 4 GiB
`kailo-wren-query-sdk-itgs2n`, its existing dependencies and isolated PostgreSQL
fixture, without a new database/image or dependency download:

```sh
node node_modules/jest/bin/jest.js --runInBand src/nativeHumanQuery.test.ts src/middleware.test.ts src/nativeProjectScope.test.ts src/nativeQuery.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/prettier/bin/prettier.cjs --check src/pages/api/v1/run_sql.ts src/middleware.ts src/middleware.test.ts src/nativeHumanQuery.test.ts src/apollo/server/services/nativeHumanQuery.ts src/apollo/server/services/nativeQueryService.ts
```

Four original suites passed **368/368**, exit 0 (31.459 s). Whole-UI TypeScript
and original Prettier exited 0. The new REST checks use the real Next
`apiResolver` over HTTP, real HUMAN/native query/history/provenance consumers and
controlled repository/Core/engine fixtures; middleware separately verifies real
signed JWTs against its ephemeral JWKS server. This is not a deployed IdP/Core/
provider or business-instance acceptance claim.

A preliminary run also selected `nativeBrowserSession.test.ts`; its four
checks were explicitly skipped because `WREN_TEST_GATEWAY_BINARY` was absent.
No native Gateway/browser acceptance is inferred from that selection.

Private production faults were not applied to the formal worktree. Inverting
the bound route condition caused **20 failed / 116 filtered skips**; inverting
private forwarding caused **2 failed / 54 passed**; removing the pre-command
thread-winner check caused **1 failed / 135 filtered skips**. The last check
observed an unwanted real command despite the later 409, not merely an error
message. Each production file was reverse-patched and matched the formal source
with `cmp` exit 0. Restored HUMAN/middleware suites passed **192/192**, exit 0
(7.891 s); all six source/check files match the verified candidate. An initial
literal-false fault failed TypeScript narrowing before running checks; it was
replaced by the dynamic condition inversion above and is not runtime evidence.

Logs in the existing private SDK directory recorded above:
`rest-query-final.log`, `rest-query-tsc-final.log`,
`rest-query-bypass-negative.log`, `rest-query-forward-negative.log`,
`rest-query-thread-negative.log`, `rest-query-restored.log`.
No business Wren container, ACTIVE binding, iframe screenshot, actual provider/
datasource or Desktop/Mobile acceptance was produced. Trusted SERVICE SQL,
ordinary function/aggregation provenance and cache-loss recovery remain gaps;
the two separate Engine Java edits remain unvalidated. Other original REST
query consumers (`ask`, `stream/ask`, `generate_summary`, `generate_vega_chart`
and SQL-pair validation) still require their actual governed consumers; this
single restored route is not a claim of complete native API integration.

### 2026-10-08 — original REST summary consumes the same HUMAN query and native task

Authority and fixed source: `DD-98`, `SS-WRN-IDENTITY` and `.design/08` §6 keep
the original query Action and component-native answer generation distinct.
The fixed official commit `c5f02a0391c87420dba78632dcd86073710deb72`,
`wren-ui/src/pages/api/v1/generate_summary.ts::handler`, executes native SQL,
creates a text-answer task and writes `GENERATE_SUMMARY` history after streaming.
Its original request/success fields and standalone implementation are retained.
The authorized bound difference is real HUMAN admission/disclosure and native
task ownership, not new pages, simplified answers or another SQL executor.

Impact: the original bound summary handler now consumes
`NativeHumanQuery.previewSql/readHistory` and `NativeQueryService` for the same
SQL, deployment, native model/view sources and original AE. Only the verified
middleware identity hop supplies credentials and scope. Query evidence and
fresh native reader privileges are checked before sending data to the existing
AI adaptor, during native streaming and before final disclosure. No HUMAN token
is forwarded to AI or saved in history. Empty platform delivery cannot enter
standalone REST or History disclosure. All original API History GraphQL request
and result fields consume the same source checks for completed summaries.

The original `api_history` table holds the summary's own fixed task ID and
immutable reference to its admitted query history. `prepareNativeSummary`
inserts before POST and returns one INSERT winner; its source SQL/result hashes,
scope, question, language, limit and thread cannot change under that ID. The
summary does not reuse the query's unique `governance_key` or claim another AE.
`advanceNativeSummary` locks and compares the original request/response JSONB,
binding, project, thread and pending status. One winner opens the consuming
native stream; stale snapshots cannot open it again or replace a terminal body.
No table/migration, shared contract, public workflow, registry or Core SQL/result
body copy was introduced. Operator usage is recorded in `docker/README.md`.

Native provenance: the same fixed official commit's
`wren-ai-service/src/web/v1/routers/sql_answers.py::sql_answer` schedules the
original `BackgroundTasks` consumer, and
`wren-ai-service/src/pipelines/generation/sql_answer.py::SQLAnswer.get_streaming_results`
consumes one per-query queue rather than replayable content. The already accepted
fork adds the original caller-fixed `native_task_id` and exact completion event;
this batch consumes those existing producer changes rather than pretending the
unmodified pin supplies them. Native `SUCCEEDED` means preprocessing is done,
not that summary text is complete. Only `done:true` with this exact original
query ID persists summary HTTP 200. Stream closure, missing/expired cache,
malformed or foreign completion and unknown statuses never fabricate success
or failed execution. Actual native FAILED records a generic failure without
provider messages. Re-entry uses the original key/task/history and read-only GET,
never another native POST or SQL. A pending response's `queryReceipt` describes
only the SQL action, not completion of the derived summary.

Boundary and convergence: pending summary uses the original HTTP 202 history,
not a new platform terminal authority. Active streaming uses the original
`MAX_WAIT_TIME` deadline; failure to receive exact done remains uncertain, and
the same caller can observe its original task. The native queue/cache does not
provide durable partial-stream replay after process/cache loss. The Wren instance
operator owns reconciliation through the original task/history; deleting the row
or blindly regenerating is forbidden. Automatic recovery for that case is a
remaining production blocker, not a completed convergence claim. Query denial,
intent/identity conflict and evidence unavailability retain existing native
refusals; another user, changed sources or stale deployment cannot disclose the
original body. A complete query receipt does not prove AI usage/terminal evidence
for another platform Action. Trusted SERVICE SQL remains separately unclosed.

Actual checks reused the existing 4 CPU / 4 GiB SDK and its cache. The existing
PostgreSQL container/database were verified as `wren_query_itgs2n` with its
`isolated-query-fixture` project; the standalone CAS selection used existing
schema and transaction rollback, without a new database or migrations:

```sh
WREN_QUERY_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/wren_query_itgs2n node node_modules/jest/bin/jest.js --runInBand src/nativeQuery.test.ts --testNamePattern="original Wren native answer PostgreSQL CAS"
WREN_QUERY_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/wren_query_itgs2n node node_modules/jest/bin/jest.js --runInBand src/nativeHumanQuery.test.ts src/middleware.test.ts src/nativeQuery.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

The original CAS selection passed **20/20** (69 filtered skips), including eight
new actual summary repository consumers. After production-fault restoration,
all three original suites passed **318/318**, exit 0 (25.33 s), including real
Next HTTP, the original API History GraphQL document, current source revocation,
concurrent summary re-entry and real PostgreSQL consumers. Whole-UI TypeScript
and original Prettier on all eight TS/check paths exited 0. An intermediate
GraphQL fixture run had 2 failures / 227 passes because its fake summary rows
omitted the original database's non-null default timestamps; correcting that
fixture produced 229/229 before the restored three-suite run. The actual
PostgreSQL repository checks did not need a production timestamp patch.

Private production changes were deliberately broken, then reverse-patched:

- Allowing every pending re-entry to POST caused **7 failed / 26 passed /
  137 filtered skips**; the checks observed a second actual adaptor call.
- Removing exact native done proof from History caused **2 failed /
  168 filtered skips**; the original reader actually disclosed unverified text.
- Removing response JSONB comparison caused **2 failed / 6 passed /
  81 filtered skips** against real PostgreSQL, admitting a second stream claim
  and overwriting an untrusted result.
- Removing summary's private identity forwarding caused **1 failed / 2 passed /
  56 filtered skips** through the real signed-JWT/JWKS middleware.
- Reintroducing empty-delivery standalone History fallback caused **1 failed /
  169 filtered skips**, exposing a previously completed summary without admission.

Each restored production file and all eight formal TS/check paths matched the
private candidate with `cmp` exit 0 before the 318/318 restored run. Logs in the
same existing private SDK directory:
`rest-summary-final.log`, `rest-summary-pg.log`, `rest-summary-tsc.log`,
`rest-summary-format.log`, `rest-summary-post-negative.log`,
`rest-summary-done-negative.log`, `rest-summary-cas-negative.log`,
`rest-summary-forward-negative.log`, `rest-summary-config-negative.log` and
`rest-summary-restored.log`.

No business Wren deployment, ACTIVE binding, provider call, iframe/browser
screenshot, Desktop/Mobile acceptance or global full check was performed here.
The old two Java edits remain unvalidated and excluded. Original REST ask,
stream/ask, chart and SQL-pair consumers, native function/provider provenance,
trusted SERVICE SQL, independent business-instance rollout and complete visual
acceptance remain explicit gaps; this batch is not complete Wren integration.

### 2026-10-08 — original REST chart uses the admitted native data and task

Authority and fixed source: `DD-98`, `SS-WRN-IDENTITY` and `.design/08` §6.
At the fixed official commit `c5f02a0391c87420dba78632dcd86073710deb72`,
`wren-ui/src/pages/api/v1/generate_vega_chart.ts::handler` already previews SQL,
converts its data and consumes `wren-ui/src/utils/vegaSpecUtils.ts::enhanceVegaSpec`,
but its chart POST omits that data. The same pin's
`wren-ai-service/src/web/v1/services/chart.py::ChartRequest/ChartService.chart`
already accepts `data` and bypasses the SQL executor when it is supplied. This
batch connects those existing consumers, not another chart implementation,
SQL parser or SERVICE execution authority. The original standalone handler,
request/success fields, full Vega enhancement and original renderer remain.

Impact: only the exact bound REST chart route consumes the middleware's trusted
HUMAN token/scope. The original `NativeHumanQuery.previewSql/readHistory` and
`NativeQueryService` retain the same admitted SQL, native history, source
models/views, deployment and AE. The bound chart POST supplies the actually
disclosed native `columns/data` to the original chart adaptor; it neither sends
the HUMAN credential nor repeats SQL through the AI SERVICE callback. Fresh
source and native-reader checks run again immediately before that side effect,
after observation and before final result disclosure. Other REST paths do not
inherit identity forwarding merely by being under `/api/v1`.

The existing original `api_history` row owns the caller-fixed chart task before
POST, with its original binding/project/thread, question, language, sample size,
SQL and immutable query-history/AE/operation/request/result references. The
existing summary repository consumers are renamed to
`prepareNativeGeneration/advanceNativeGeneration` and used only by these actual
summary/chart handlers. INSERT winner and locked JSONB comparison are retained;
the native owner type must match exactly, so summary and chart cannot adopt
one another's task. Re-entry and a competing observer use the original task ID
and read-only GET, never another POST or SQL. No table, migration, shared
contract, Core SQL/result body copy or second workflow/registry was introduced.
The original API History GraphQL fields use the same fresh query-source checks,
strip internal native evidence and retain the original chart-data sanitization.

Boundaries and exceptions: a query's `queryReceipt` proves only that SQL action,
not chart completion or AI usage. Missing/foreign POST ACK, unavailable or
expired native GET and FETCHING/GENERATING/future status remain HTTP 202;
re-entry cannot adopt a foreign task. Only native FINISHED with the original
valid schema can produce the unchanged `id/vegaSpec/threadId` success response.
Contradictory error or missing schema is unavailable terminal evidence, not
success or confirmed failure. Actual native FAILED and STOPPED are distinct
409 outcomes with generic errors, without provider details or repeated POST.
Changed identity, SQL, question, thread or sample size conflicts; source
revocation blocks dispatch/disclosure instead of retaining a successful body.
Empty configured delivery is an error and cannot enter standalone execution.
Mobile remains outside this component-host surface; no Web/Desktop page or
layout was replaced by this native REST consumer.

Convergence remains bounded by the native producer: the already accepted fork
supplies caller-fixed `native_task_id` and refuses duplicate creation; the
official pin alone does not supply that fork behavior. Re-entry can observe a
still-existing task after lost ACK. Process/cache loss does not have a durable
native result replay. The Wren operator must reconcile the same native task and
history without deleting its owner or blindly repeating the side effect;
automatic recovery for lost cache remains a production blocker.

Actual first verification reused the existing 4 CPU / 4 GiB SDK and cache and
the independently verified `wren_query_itgs2n` fixture database. No database,
image, dependency or full source-tree copy was created:

```sh
WREN_QUERY_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/wren_query_itgs2n node node_modules/jest/bin/jest.js --runInBand src/nativeHumanQuery.test.ts src/middleware.test.ts src/nativeQuery.test.ts
python3 -B data-query/wren-ai-service/tests/pytest/providers/test_native_sql_answer_stream.py
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

All three original suites passed **349/349**, exit 0 (100.4 s), including actual
Next HTTP, original History GraphQL, real signed-JWT/JWKS middleware and real
PostgreSQL native owner/CAS consumers. The original Python producer/service
suite passed **10/10**, exit 0 (0.017 s); its expected expired-ID fault logs are
not production failures. Whole-UI TypeScript exited 0. All eight formatted
formal TS/check paths matched this tested candidate. The original Vega helper
and Python chart service/router/producer checks also matched their existing
verified SDK copies; this batch did not replace their implementation.

Logs in the existing private SDK directory recorded above:
`rest-chart-positive.log`, `rest-chart-python.log` and `rest-chart-tsc.log`.
After the user-requested disk cleanup, six private production faults were
checked against the original consumers, without modifying formal production
source:

- Removing the actual chart adaptor `data` argument caused **1 failed /
  194 filtered skips**: the HTTP consumer observed a chart POST without the
  admitted query data. The cold-dependency run took 142.725 s; this is a real
  assertion failure, not a timeout or claimed build failure.
- Removing the fresh source check immediately before chart dispatch caused
  **1 failed / 194 filtered skips**. Despite the later 403, the check observed
  one actual unauthorized AI adaptor call; an error response alone is not
  sufficient evidence of side-effect protection.
- Removing the native generation owner-type guard caused **2 failed /
  90 filtered skips** against real PostgreSQL, accepting another generation
  type's pending row. Restoring preparation while separately leaving the
  terminal owner-type guard removed again caused **2 failed / 90 filtered
  skips**, now observing an actual untrusted terminal body persisted as 200.
- Removing this exact route's private identity forwarding caused **1 failed /
  2 passed / 59 filtered skips** through original signed-JWT/JWKS middleware.
- Reversing the original Python chart data branch caused **1 failed**: the
  existing native service check observed an unadmitted SERVICE SQL callback.

Each production file was reverse-patched and matched its formal source with
`cmp` exit 0. All eight TS/check paths matched before the restored run. The
same three original suites then passed **349/349**, exit 0 (33.113 s), and the
original Python suite again passed **10/10**, exit 0 (0.017 s). Original
Prettier initially exited 1 with
`[warn] src/pages/api/v1/generate_vega_chart.ts`; its only requested correction
was the line wrapping of one unchanged 409 response. Applying that formatter
output to both copies produced eight-path Prettier exit 0 and `cmp` exit 0;
no semantic production change followed the restored checks. TypeScript's
earlier exit 0 remains the actual type-check result, not a new full build.

Negative/restored logs in that same SDK directory:
`rest-chart-data-negative.log`, `rest-chart-admission-negative.log`,
`rest-chart-type-negative.log`, `rest-chart-terminal-type-negative.log`,
`rest-chart-forward-negative.log`, `rest-chart-python-negative.log`,
`rest-chart-restored.log`, `rest-chart-python-restored.log`,
`rest-chart-format.log` and `rest-chart-format-final.log`.
No business Wren container, ACTIVE binding, live
provider/datasource, iframe/browser screenshot, Desktop/Mobile acceptance or
global full check was produced. Native SERVICE SQL, ordinary function/provider
provenance, REST ask/stream and SQL-pair consumers, independent instance rollout
and complete visual acceptance remain gaps. The two separate Java edits remain
unvalidated and excluded; passing this first verification is not complete Wren
integration or production readiness.

## 2026-10-08 original REST Ask and UI planning stream consumers

Authority and source: `.design/08` §6 (`SS-WRN-IDENTITY`,
`SS-WRN-GOVERNANCE`), `.design/07` §4.6 and execution evidence (DD-87/98),
not a replacement UI or a new query capability. The fixed source is
`c5f02a0391c87420dba78632dcd86073710deb72` in the read-only
`WrenAI-ui-0.32.2` checkout. Reverified original paths and symbols are
`wren-ui/src/pages/api/v1/ask.ts::handler`,
`wren-ui/src/pages/api/v1/stream/ask.ts::handler`,
`wren-ui/src/pages/api/ask_task/streaming.ts::handler`,
`wren-ui/src/apollo/server/resolvers/askingResolver.ts::AskingResolver.createAskingTask`,
`wren-ui/src/apollo/server/services/askingService.ts::AskingService.createAskingTask`,
`wren-ui/src/apollo/server/services/askingTaskTracker.ts::AskingTaskTracker.createAskingTask`,
`wren-ui/src/apollo/server/adaptors/wrenAIAdaptor.ts::WrenAIAdaptor.ask`,
`wren-ui/src/apollo/server/utils/apiUtils.ts::transformHistoryInput`,
`wren-ai-service/src/web/v1/routers/ask.py::ask` and
`wren-ai-service/src/web/v1/services/ask.py::AskService.get_ask_streaming_result`.
The original stream unconditionally manufactured UI `done` at HTTP EOF; the
native router allocated its UUID after POST, so a lost ACK could not be safely
reattached by the caller. These are actual source facts, not inferred features.

Impact and authorized differences: both original REST handler bodies and
standalone response/SSE shapes are retained; only explicitly configured bound
mode enters their shared `governedRestAsk` consumer. It uses the existing
API History owner/CAS, original MDL reader, NativeHumanQuery, engine source
analysis and query receipt. The request freezes current HUMAN identity,
binding, captured MDL hash/digest, original contributing thread histories and
one caller-owned task/key before the native POST. The generated SQL is bound
to that captured deployment before command and on same-key re-entry; metadata
read is not SQL execute or result exposure authorization. Actual authorized
query data goes into the original answer generation without a SERVICE SQL
callback. Original API History GraphQL fields consume the same fresh source
and immutable history evidence, stripping internal proof fields from display.

UI task creation/reading/cancel/response-binding/follow-up selection now consume
the original `asking_task.detail.nativeScope` owner/MDL evidence. The actual
GraphQL context injects the original task repository; the original tracker
persists its owned fixed ID before POST, invokes current authorization before
dispatch and retains that trusted owner when native polling replaces detail.
The planning handler authorizes that original owner and captured model/view
Resources before the native read and each emitted message. The original
Python `data_assistance.py::DataAssistance`,
`misleading_assistance.py::MisleadingAssistance`,
`user_guide_assistance.py::UserGuideAssistance`,
`sql_generation_reasoning.py::SQLGenerationReasoning` and
`followup_sql_generation_reasoning.py::FollowUpSQLGenerationReasoning`
continue using their original queues and provider pipelines. Their real
`run` completion places the queue sentinel; callback finish metadata or EOF
does not. All five full paths are under the fixed pin's
`wren-ai-service/src/pipelines/generation/`. Reasoning `done` completes only
that stream phase, not SQL, the whole Ask action or AI billing.

State ownership/compatibility: no table, migration, shared contract or second
task/permission/workflow authority was added. Existing native JSONB stores
only its own context and references, not a Core SQL/body copy. Old tasks with
no captured owner cannot acquire one from a guessed ID; they fail closed.
Old standalone readers keep their original shapes, but mixed UI/AI-service
deployment cannot prove fixed-ID/done semantics and is not accepted as this
fork. Native progress remains in the original task/history. Completed history
reauthorizes the original SQL AE and its sources without another SQL/command.

Side effects and exceptions: concurrent REST entrants use the original
INSERT/CAS winner; only that winner issues the fixed-ID POST, and duplicate
native creation is refused. Lost/foreign ACK, GET cache loss, future status,
pending query receipt, interrupted/claimed stream and timeout stay uncertain,
never completed/failed by inference or blindly replayed. Native FAILED/STOPPED
remain distinct verified outcomes, with generic errors rather than provider
details. Missing identity/scope and revoked Resource are DENIED; missing
delivery/binding/metadata prerequisites are PRECONDITION; configured byte
bounds are LIMIT; changed input/owner/deployment/CAS is CONFLICT; missing
native terminal or transport outcome is UNKNOWN. Blocked SERVICE/function
abilities remain BLOCKED, not hidden behind a successful query. These map to
the existing six categories in `apps/06` §4; no new public reason-code contract
is introduced. Native queue/cache loss and a non-dispatched task after a
fresh-check refusal still require Wren operator reconciliation of the same
ID/history. There is no durable cache replay or automatic bounded repair;
this remains a production blocker, not a completed convergence mechanism.

Verification reused only the original 4 CPU / 4 GiB SDK, local dependencies
and the existing isolated PostgreSQL database. Its identity was read back as
`wren_query_itgs2n|postgres|isolated-query-fixture`; no new database, image,
dependency download or whole-tree copy was created. Actual original commands:

```sh
WREN_QUERY_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/wren_query_itgs2n node node_modules/jest/bin/jest.js --runInBand src/nativeHumanQuery.test.ts src/middleware.test.ts src/nativeQuery.test.ts
node node_modules/jest/bin/jest.js --runInBand src/nativeHumanQuery.test.ts src/middleware.test.ts src/nativeTaskOwnership.test.ts
python3 -B data-query/wren-ai-service/tests/pytest/providers/test_native_sql_answer_stream.py
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

The first REST/real-PG run actually returned **371 passed / 3 failed / 374**,
exit 1 (556.603 s): all three failures were original exact optional-argument
assertions not yet updated for `expectedDeploymentHash`; nativeQuery and
middleware suites passed. The real PG owner/CAS checks include ASK and
STREAM_ASK preparation, type adoption refusal and immutable completion. The
subsequent first UI run passed middleware **69/69** but two suites and tsc
failed with four `TS2339` errors: the real GraphQL context lacked
`askingTaskRepository`. The actual context type and injection were fixed,
not suppressed. The cold PG-wide suite was not repeated.

After those corrections, all three final HTTP/JWKS/tracker/ownership suites
passed **333/333**, exit 0 (15.833 s); whole-UI tsc exited 0. The original
Python producer/service/router suite passed **14/14**, exit 0 (0.040 s after
restoration). It imports real production implementations with the existing
dependency-boundary harness; it is not a live Pydantic/provider deployment or
AI usage receipt. UTF-8 Chinese split chunks, native GENERAL/SQL answer
content, owner/MDL drift, current source denial and real pre-POST consumers are
covered without replacing the original page or broad suite with mock success.

Actual private production faults, then reverse patches and `cmp` exit 0:

- Removing the pre-command deployment comparison emitted **one actual query
  command** for a different deployment; the original HTTP check failed before
  its response-status assertion. An eventual 409 did not erase that dispatch.
- Accepting a foreign native done ID completed the REST history with 200;
  the original GENERAL-stream check failed (expected 503).
- Removing the UI task's HUMAN-owner comparison let a foreign user read a
  200 stream; the original HTTP ownership check failed (expected 403).
- Adding UI `done` on EOF was caught as an extra completion event by the
  original planning-stream check. These four isolated production branches
  were mutated in one private candidate run: **4 failed / 260 filtered skips**,
  exit 1 (12.239 s), not a compiler failure.
- Premature callback sentinels in the real data-assistance and SQL-reasoning
  producers caused **3 failures / 14** in the original Python suite, exit 1.
  Provider callback finish metadata was observed before the real provider
  result, so it could not be accepted as native completion.

All six mutated production files were restored and matched formal source.
The original three TS suites then passed **333/333**, exit 0 (14.840 s),
followed by the final stable-input run above; Python restored **14/14**.
The exact 22 TS/check and eight Python inputs are checked against the same SDK
candidate with `cmp` exit 0, excluding the two unrelated unvalidated Java
edits. Original Prettier `--check` on those 22 inputs exited 0; scoped
`git diff --check -- data-query` also exited 0. Neither is a global full check.

Logs remain in
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/`:
`rest-ask-positive.log`, `rest-ask-ui-positive.log`,
`rest-ask-ui-tsc.log`, `rest-ask-ui-checked.log`,
`rest-ask-ui-checked-tsc.log`, `rest-ask-consumers-negative.log`,
`rest-ask-python-negative.log`, `rest-ask-restored.log`,
`rest-ask-python-restored.log`, `rest-ask-final.log`,
`rest-ask-final-tsc.log`, `rest-ask-format-checked.log` and
`rest-ask-format-stable.log`.
No real Wren business container, ACTIVE binding, live datasource/provider,
iframe/browser screenshot, Desktop/Mobile acceptance or global full check was
produced. Remaining native generate-SQL/SQL-pair/recommendation and other
mutation consumers, trusted SERVICE SQL, ordinary-function/provider provenance,
AI billing, independent instance rollout and visual acceptance are not
claimed complete. Mobile remains a non-component host; no native page/layout
was deleted or redesigned by this batch. This is source-level partial
integration, not a 100% upstream restoration or production readiness claim.

## 2026-10-08 Original Ask UI SSE completion and same-ID consumers

This batch changes the existing client consumers, not the native product page
or another task authority. The fixed official source is
`/volumes/kailo/.references/WrenAI-ui-0.32.2` at
`c5f02a0391c87420dba78632dcd86073710deb72`. The original paths and symbols were
re-read using `git show`/`git grep` before implementation:

- `wren-ui/src/hooks/useAskingStreamTask.tsx::useAskingStreamTask` originally
  stopped loading for both a truthy `done` and `EventSource.onerror`.
- `wren-ui/src/hooks/useAskPrompt.tsx::useAskPrompt` selected GENERAL's stream
  from `createAskingTaskResult`, stopped polling at intent FINISHED and could
  reopen empty PLANNING streams.
- `wren-ui/src/components/pages/home/prompt/index.tsx::Prompt` and
  `wren-ui/src/components/pages/home/prompt/Result.tsx::GeneralAnswer` are the
  original presentation consumers; GeneralAnswer inferred completion from
  partial text plus `!loading`.

Four-step impact conclusions, recorded after the actual implementation:

1. Authority is `.design/08`'s full GenBI/native-task boundary, DD-87/DD-98 and
   the existing no-success-without-evidence rule. The preceding server/native
   provider batch supplies exact current-owner `done`; the client must consume
   it rather than treat EOF as native completion. All four production
   differences are authorized governance adaptations, not missing-page
   substitutes or a second frontend implementation.
2. Impact is the existing stream hook → Ask prompt hook → original Prompt →
   GeneralAnswer. TEXT_TO_SQL's thread PLANNING path and GENERAL's actual
   observed task ID remain consumers. No SQL schema, migration, GraphQL schema,
   contract enum, server TaskStatus or workflow changes are introduced. Existing
   styles, original body, completion text, menus and page structure are retained;
   unresolved output uses the already imported original loading icon. There are
   no new user-facing message strings or translation authority.
3. Stream GETs do not submit SQL or a replacement Ask. The hook keeps one
   attempted current native ID, closes failed/finished transports and rejects
   queued old callbacks. Task selection fences stale GraphQL data and late
   create/rerun acknowledgements. The local `completed` boolean describes only
   the stream's exact completion frame, not query success, platform TaskStatus
   or billing. Existing server reads continue current HUMAN/source checks.
4. Empty output, invalid JSON, null/array/unknown frames, truthy non-boolean
   `done`, mixed/foreign completion, constructor failure, EOF and timeout do not
   complete the stream or turn it into business failure. Partial authorized
   output stays incomplete. GENERAL's existing same-ID GraphQL polling continues
   until real stream completion, actual task failure/stop or user dismissal;
   transport loss never automatically creates/reruns an Ask. Reset, task change
   and unmount fence late events. Dismissal stops observations, not the operation.
   Missing native queue/cache evidence still needs original same-task operator
   reconciliation; this is not durable replay or a new recovery authority.

Implementation preceded the checks. Reused the existing 4 CPU / 4 GiB Node SDK
and local Jest/React/TypeScript/Prettier dependencies, with about 18 GiB host
memory available and no Wren compile in flight at entry. The unrelated existing
system index process was not invoked, restarted or used as a gate. No image,
download, database, whole-tree copy or host toolchain was created.

Actual commands within the original `/work` UI candidate:

```sh
node node_modules/jest/bin/jest.js --runInBand src/askingStream.test.tsx
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/prettier/bin/prettier.cjs --check src/hooks/useAskingStreamTask.tsx src/hooks/useAskPrompt.tsx src/components/pages/home/prompt/index.tsx src/components/pages/home/prompt/Result.tsx src/askingStream.test.tsx
```

The first actual Jest invocation failed before running tests with two TS2345
diagnostics in the check's React overload/readonly dependency substitutions;
only those check typings were corrected. The next original-hook/body run passed
**20/20** and whole-UI tsc exited 0. Adding the original Prompt's two actual
consumers initially returned **21 passed / 1 failed**: the SSR fixture used a
string for the original numeric PROCESS_STATE enum. It was corrected to import
the original enum, without changing production behavior. The final pre-fault
run passed **22/22**, exit 0 (6.937 s).

Private production faults were then injected into those same four actual
client files: old EOF-as-complete behavior, permissive done frames, missing
current-source callback fence, missing same-ID attempt latch, old unbound
polling data, premature GENERAL polling stop, late create ACK adoption, old
GeneralAnswer `!loading` completion, lost Prompt completion propagation and
missing close-observation call. The original suite returned **18 failed / 4
passed / 22**, exit 1 (7.694 s), with actual duplicate EventSource construction,
stale body/completion, premature poll stop and the extra late-ID observation
visible in assertions. These were behavior failures, not compiler failures.

Because reverting GeneralAnswer masked the simultaneously removed Prompt
completion propagation, all other faults were first reversed and that one
missing propagation was checked alone:

```sh
node node_modules/jest/bin/jest.js --runInBand src/askingStream.test.tsx -t "passes actual stream completion"
```

It actually failed **1 / 1**, with **21 filtered skips**, exit 1 (7.239 s): the
original completed Prompt had no completion footer. After the final reverse
patch, all five production/check inputs matched formal source with `cmp` exit
0. The original whole suite passed **22/22**, exit 0 (6.703 s), whole-UI tsc
again exited 0 and original Prettier check exited 0. The checks substitute only
React scheduling/browser EventSource for the Node hook execution and unrelated
SSR dependencies; they exercise the real hook callbacks, GraphQL selection and
original Prompt/GeneralAnswer render consumers. This is not a browser screenshot
or real provider acceptance.

Logs remain under
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/`:
`asking-stream-positive.log`, `asking-stream-positive-final.log`,
`asking-stream-tsc.log`, `asking-stream-consumers-final.log`,
`asking-stream-consumers-negative.log`, `asking-stream-prompt-negative.log`,
`asking-stream-restored.log`, `asking-stream-restored-tsc.log` and
`asking-stream-format.log`. The two pre-existing unvalidated Java edits remain
separate and are not claimed accepted by these checks. No real Wren business
container, ACTIVE binding, live datasource/provider, iframe screenshot,
Desktop/Mobile or global full acceptance was produced. Trusted SERVICE SQL,
ordinary-function/provider provenance, AI billing, remaining original native
consumers and complete instance/visual delivery remain explicit gaps; this is
not 100% upstream restoration or production readiness.

### Same-batch Close/late-ack correction before commit

Implementation review found one real remaining consumer gap: Prompt called
`onStopPolling`, but that method stopped only the current Apollo poll. A
pending create/rerun ACK could still restore `taskId`, fetch the task and later
reattach a GENERAL stream. The original method now invalidates the observation
generation, clears the selected ID, stops polling and resets the original
stream synchronously. It does not call native cancel. The original Home and
HomeThread response-creation/cleanup callers were re-read; their passed native
task references and business commands are unchanged, only the obsolete
observation is terminated.

After that implementation, five cases were added to the same original Jest
file: both pending create/rerun ACKs, both reads already pending after ACK, and
the active stream plus old polling data arriving after Close. The whole suite
actually passed **27/27**, exit 0 (6.252 s), and whole-UI tsc exited 0. Restoring
the actual old production `onStopPolling` in the private candidate and running
`-t "after Close|when Close"` produced **5 failed / 22 filtered skips**, exit 1
(6.420 s). The checks observed the unwanted late native-ID fetch and old
GENERAL task adoption, not a compiler error. After reversing that production
fault, all five inputs again matched formal source with `cmp` exit 0; the whole
suite passed **27/27**, exit 0 (6.409 s), and Prettier on all five inputs exited
0. Additional logs at the same directory are `asking-stream-close-positive.log`,
`asking-stream-close-tsc.log`, `asking-stream-close-negative.log`,
`asking-stream-close-restored.log` and `asking-stream-close-format.log`.
No broad PostgreSQL suite, image build, deployment, new checking framework or
visual/device acceptance was added for this correction. The preceding 22-case
results remain historical evidence, not the final consumer coverage count.

## 2026-10-08 original native SQL transport delivery

Implementation-first impact and source findings:

1. **Authority.** `.design/08` §6 keeps native query/dry-run on the original
   HUMAN/AGENT Admission → Gateway → ExtMcp PEP chain. `apps/06` §4 requires
   externally uncertain effects to remain `UNKNOWN`, not become failed or
   successful. The existing binding delivery already owns `requestTimeoutMs`
   and `responseMaxBytes`; no new configuration, action, identity or contract
   was introduced. Fixed upstream was reread at
   `WrenAI-ui-0.32.2@c5f02a0391c87420dba78632dcd86073710deb72`:
   `wren-ui/src/apollo/server/services/queryService.ts::QueryService.preview`,
   `wren-ui/src/apollo/server/adaptors/ibisAdaptor.ts::{query,dryRun}` and
   `wren-ui/src/apollo/server/adaptors/wrenEngineAdaptor.ts::{previewData,dryRun}`.
   These actual methods are retained; this batch is an authorized governance
   transport change, not a new query implementation or a full-tree parity claim.
2. **Impact.** The real `NativeQueryService.execute` consumer now passes those
   controlled limits through the original `QueryService.preview` and both
   original Ibis/Engine query and dry-run transports. Existing native endpoint,
   SQL, manifest/deployment, connection information, row limit, request and
   response semantics remain unchanged. Internal optional options preserve
   original standalone callers. No database schema, serialized contract,
   migration, Core/Worker consumer or client layout changed. Web/Desktop's
   existing governed backend consumers receive the same behavior; this is not
   Mobile component hosting or a device acceptance claim.
3. **Side effects.** Earlier source-analysis and PEP requests consumed these
   limits, but actual SQL transport did not. The original Axios calls now use
   the delivered timeout and `maxContentLength`; callers cannot supply these
   limits in tool input. Engine dry-run also preserves a network error without
   dereferencing a missing `err.response`. No authentication, scope, resource,
   result-policy or native-reader check is removed. API History remains the
   original operation/execution association and holds no second task ledger.
4. **Boundaries.** Query and dry-run on both original providers reject late or
   oversized responses, including a chunked response without Content-Length.
   After native dispatch, an HTTP limit does not prove a database rollback:
   the same original history stays `UNKNOWN` with no result body, not `LIMIT`
   rendered as a business failure. Same-key reentry and observe reuse its
   original AE/Operation/deployment/native ID and never redispatch SQL, even
   after endpoint recovery. Existing auth, precondition, conflict and actual
   completed-result checks remain in their original paths. This does not
   implement database cancellation, recover a lost native result, or create a
   new state/reconciliation authority; original operator reconciliation is
   still required for missing native evidence.

Checks followed implementation. Entry inspection confirmed the existing SDK
`kailo-wren-query-sdk-itgs2n` was running under 4 CPU / 4 GiB limits, about
17 GiB host memory was available and no Wren compile was in flight. The existing
PostgreSQL fixture `wren_query_itgs2n` was verified read-only as
`wren_query_itgs2n|postgres|isolated-query-fixture`. Only its four selected
original native integration cases ran, not the broad PostgreSQL suite. The
original SDK, dependencies and fixture were reused without new image,
download, database, whole-tree copy, host compiler or GitNexus invocation.

Actual commands in the original SDK `/work` candidate:

```sh
node node_modules/jest/bin/jest.js --runInBand src/apollo/server/services/tests/queryService.test.ts
node node_modules/jest/bin/jest.js --runInBand src/nativeQuery.test.ts -t "keeps data_query.*UNKNOWN on the same native history"
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/prettier/bin/prettier.cjs --check src/apollo/server/services/nativeQueryService.ts src/apollo/server/services/queryService.ts src/apollo/server/adaptors/ibisAdaptor.ts src/apollo/server/adaptors/wrenEngineAdaptor.ts src/apollo/server/services/tests/queryService.test.ts src/nativeQuery.test.ts
```

Final pre-fault checks returned **12/12 passed** for original QueryService,
**4 passed / 94 filtered skips** for the actual SDK adapter and PostgreSQL
history path, and whole-UI tsc exit 0. The QueryService checks use real original
adaptors against an HTTP provider fixture, not an Axios mock: eight combinations
cover Engine/Ibis × query/dry-run × deadline/size and successful subsequent
requests. The four native cases use actual ES256 transport, original MCP SDK,
Next adapter and API History; the SQL provider alone is a controlled HTTP
fixture, not a real external datasource acceptance.

Private production mutation first removed the two limits from all four real
adaptor request paths. The original governed transport group then returned
**8 failed / 4 filtered skips**, exit 1: valid delayed/oversized results resolved
instead of being rejected. After restoring both adaptors, a separate production
mutation removed only `NativeQueryService`'s delivery to `queries.preview`.
The native four cases returned **4 failed / 94 filtered skips**, exit 1, each
showing expected `UNKNOWN` but actual `SUCCEEDED`. These are actual behavior
failures, not type/compiler failures or invalid provider result shapes.
After reversing that final fault, all six production/check inputs matched
formal source with `cmp` exit 0. Restored QueryService returned **12/12 passed**
(6.738 s), original native checks **4 passed / 94 filtered skips** (9.223 s),
both exit 0, and original Prettier exited 0. The tsc run used these same final
source bytes; only private production mutations intervened and were reversed.

An earlier broader invocation also ran the original Ibis adaptor suite and
returned **41 passed / 1 failed / 42**, exit 1. The unchanged MySQL constraints
check expected connectionInfo `ssl:false` but received `sslMode:"DISABLED"`.
That failure was retained, not weakened or counted as passing. Initial size
fixtures were also corrected to return valid original result shapes before the
final positive and mutation runs, so malformed data cannot mask a missing byte
limit. No global `check.sh --full`, build/image, browser screenshots or
Desktop/Mobile acceptance was produced for this batch.

Logs remain at
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/`:
`query-transport-original-positive.log` (retained MySQL failure),
`query-transport-final-positive.log`, `query-transport-native-final-positive.log`,
`query-transport-tsc.log`, `query-transport-negative.log`,
`query-transport-native-negative.log`, `query-transport-restored.log`,
`query-transport-native-restored.log` and `query-transport-format.log`.

**Release boundaries remain explicit.** Binding SERVICE OAuth authenticates
the adapter's Core PEP transport; current SQL business admission still needs
the original HUMAN/AGENT ActionExecution. SERVICE source-read grants do not
authorize SERVICE SQL, and no `DataQueryRun` Workflow was fabricated. Trusted
SERVICE SQL admission, ordinary-function/provider provenance and the two
pre-existing unvalidated Java edits remain outside this accepted increment.
No real Wren business-container deployment, ACTIVE release/binding, live
datasource/provider or iframe visual evidence was created. This is neither
100% restoration nor production readiness.

## Original dashboard HUMAN cache consumer (2026-10-08)

This implementation was compared against the fixed official
`WrenAI-ui-0.32.2@c5f02a0391c87420dba78632dcd86073710deb72`:
`wren-ui/src/apollo/server/resolvers/dashboardResolver.ts`
(`DashboardResolver.previewItemSQL`),
`wren-ui/src/components/pages/home/dashboardGrid/index.tsx` (`PinnedItem`),
`wren-ui/src/apollo/client/graphql/dashboard.ts` (`PREVIEW_ITEM_SQL`) and
`wren-ui/src/apollo/server/services/queryService.ts` (`QueryService.preview`).
`tools/upstream_manifest.py status data-query` confirmed the reference HEAD
still equals that baseline; no reference source was edited or executed.

Four implementation conclusions:

1. **Authority.** DD-87 and `.design/08` §6 require the full native page and
   original QueryService to consume current HUMAN/resource query admission,
   not bypass it through dashboard refresh. The original dashboard metadata
   management is not automatically a new platform Action. Existing
   `NativeHumanQuery`, `NativeQueryService`, Core Resource/action/result-policy
   checks and native API History remain the only execution association.
2. **Impact and compatibility.** Original item opening, item refresh and
   Refresh All call `DashboardResolver.previewItemSQL` with the current opaque
   scope/key. The original GraphQL input adds optional identity fields and the
   original response adds optional receipt metadata; original codegen produces
   the shared client types and operation. Native opaque SQL-editor selections
   optionally freeze the original two cache booleans in the same existing
   history/revision; selectors, command re-entry, execution and HUMAN completed
   disclosure validate that same snapshot. Old references without cache remain
   accepted. Raw Agent tool inputs, Core contracts and database schema are
   unchanged. No four-language contract regeneration or data migration is
   needed. Backend and its actual UI consumers must ship together before any
   binding is activated; an old bare dashboard client is not a governed client.
3. **Side effects.** The real QueryService receives original cache options and
   returns original cache times/hit/overwrite metadata, in addition to the
   already delivered HTTP bounds. The native SQL history owns those facts;
   there is no duplicate cache, result, authorization or operation ledger.
   The browser stores only the key and refresh choice, never SQL/results.
   Original grid/styles/menus/chart rendering remain unchanged except the
   necessary governance notices and excluding charts without verified data.
   The original pin UI/schema/mutation were restored to their pre-batch bytes:
   a temporary browser pin latch was removed because it cannot authorize or
   make the native metadata INSERT idempotent. This is not a pin-governance
   completion claim.
4. **Boundaries.** Zero-row completed data still uses the original empty chart
   presentation. RUNNING, missing/unknown terminal evidence or transport loss
   retains the original query key, no rows and no stale cache times. Invalid
   delivery, missing identity, current project mismatch, changed native item
   or cache intent refuse without a standalone fallback/new query. Scope
   changes and focus/unmount fences prevent late responses from disclosing or
   retiring another person's intent; they do not cancel SQL. Existing auth,
   precondition and conflict refusals retain the apps/06 §4 classification;
   inconclusive side effects remain UNKNOWN rather than business success or
   failure. Missing native results still require the existing operator
   reconciliation path, not automatic replay.

The original SDK `kailo-wren-query-sdk-itgs2n` was reused with its verified
4 CPU / 4 GiB cgroup; the existing isolated PostgreSQL
`wren_query_itgs2n|postgres` and its original `api_history`/`project` tables were
checked read-only before the two selected native cases. No new database,
image, dependencies, whole-tree copy, host compiler or GitNexus was used.

The first candidate's original NativeHuman/UI suites returned **267/267
passed** and whole-UI tsc exited 0. Removing the real private resolver's
completed-result gate and the hook's current-user fence then produced
**4 failed / 3 passed / 260 filtered skips**, exit 1: RUNNING/missing/unknown
terminal states disclosed original rows/cache times and a changed user retired
the previous user's key. Both production faults were reversed and their
files matched formal source with `cmp` exit 0. Pin candidate removal and the
chart-without-verified-data exclusion are later source changes; that earlier
267 result is not presented as final acceptance of the later bytes.

Two earlier MCP/PG target runs returned **2 failed / 98 filtered skips** each.
The first fixture compared JSONB reserialization as a raw string, although
all values were identical; it now compares full parsed values. The second
expected an `isError` return, while the actual MCP SDK rejects changed
references with `QUERY_REFERENCE_CHANGED`; it now checks that actual rejection.
Neither correction weakened result or source validation or changed production
behavior to accommodate the fixture. The isolated history mutation is
restored in `finally` even if an assertion fails.

After those source corrections, final original checks returned **265/265
passed** (223 NativeHuman + 42 original UI controls, 316.703 s), **2 passed /
98 filtered skips** for the real original MCP/PG cache consumers (316.589 s),
whole-UI tsc exit 0 and original GraphQL codegen exit 0. The long elapsed runs
are retained rather than replaced by earlier passing byte snapshots. The
native cases use real original MCP SDK/Next transport, actual QueryService,
signed execution context and native PostgreSQL History; only the SQL provider
is a controlled HTTP fixture, not a production datasource/cache acceptance.
The UI cases exercise actual hook callbacks, identity/storage and
focus/unmount boundaries, not a browser or visual screenshot.

A second private production mutation removed only the frozen cache snapshot
comparison in `NativeQueryService.referencedInput`. Both real MCP cases then
returned **2 failed / 98 filtered skips**, exit 1 (8.949 s): changed original
history cache intent wrongly returned its old `SUCCEEDED` result instead of
the SDK rejecting `QUERY_REFERENCE_CHANGED`. Reversing that fault restored
all 13 production/generated/check inputs to formal bytes (`cmp` exit 0).
Restored MCP/PG then returned **2 passed / 98 filtered skips**, exit 0
(9.363 s), and the original Prettier check exited 0. The final tsc used these
same bytes; only the private, fully reversed production mutation intervened.

Actual original check commands in `/work`:

```sh
node node_modules/jest/bin/jest.js --runInBand src/nativeHumanQuery.test.ts src/viewMetadata.test.ts
node node_modules/jest/bin/jest.js --runInBand src/nativeQuery.test.ts -t "frozen original dashboard cache intent"
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/prettier/bin/prettier.cjs --check src/apollo/server/resolvers/dashboardResolver.ts src/apollo/server/models/dashboard.ts src/apollo/server/schema.ts src/apollo/client/graphql/dashboard.ts src/apollo/server/services/nativeQueryService.ts src/apollo/server/services/nativeHumanQuery.ts src/components/pages/home/dashboardGrid/index.tsx src/hooks/useDashboardQuery.ts src/nativeHumanQuery.test.ts src/nativeQuery.test.ts src/viewMetadata.test.ts
```

Original GraphQL generation used `@graphql-codegen/cli`'s existing
`codegen.yaml` with the actual local server `typeDefs`; only its original
`__types__.ts` and `dashboard.generated.ts` outputs are included. It did not
fetch a live server schema or handwrite generated types.

Logs are in
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/`:
`dashboard-codegen-final.log`, `dashboard-consumers-positive.log`,
`dashboard-consumers-negative.log`, `dashboard-mcp-positive.log`,
`dashboard-mcp-final-positive.log`, `dashboard-consumers-restored.log`,
`dashboard-mcp-accepted-positive.log`, `dashboard-mcp-negative.log`,
`dashboard-mcp-restored.log` and `dashboard-tsc-accepted.log`.

No Wren business-container deployment, ACTIVE release/binding, real external
datasource/provider or iframe visual evidence was created. Browser screenshots,
Desktop/Mobile acceptance and global `check.sh --full` are not claimed.
Native user/project write authorization, original pin/writes, trusted SERVICE
SQL admission, ordinary-function/provider provenance and the pre-existing
unvalidated Java pair remain explicit delivery gaps. The whole release stays
unactivated; this increment is neither 100% restoration nor production ready.

### Implementation-review correction: returning to the dashboard window

Review found a real regression in the above UI candidate: its focus/visibility
listener cleared the original chart result but never resumed observation.
The fixed official `PinnedItem` and `DashboardResolver.previewItemSQL` cited
above do not clear the original Apollo result on window return. The existing
governed editor hooks were also checked; editor-only invalidation is not a
replacement for the continuously displayed native dashboard.

The dashboard's `useDashboardQuery` governance consumer now invalidates stale disclosure,
rechecks the current person and observes the same original key/cache intent
on focus or visibility return. Its in-memory reference retains only
item, scope and opaque intent, not SQL, results or another execution authority.
Even after a verified terminal retired browser storage, automatic observation
uses that settled key without recreating the storage entry or dispatching a
new query. A changed person refuses automatic reuse; a denied current receipt
cannot restore the old chart body. Late replies still obey the original
generation/item/scope fences, and unmount still stops observation rather than
cancelling SQL. This changes no backend, schema, source/permission authority,
cache contract or pin-management semantics.

After the implementation, the original actual hook/event consumers in
`src/viewMetadata.test.ts` returned **46/46 passed**, exit 0 (7.887 s), including
focus, visibility, changed-user and revoked-permission cases. Whole-UI
`tsc --noEmit --incremental false` exited 0. Removing only the real private
production `preview(false, true)` resume call reproduced the regression:
**2 failed / 44 filtered skips**, exit 1 (6.185 s); the focus and visibility
consumers expected a second same-key observation but saw only the initial call.
The production line was restored, all 13 production/generated/check inputs
matched the formal tree with `cmp` exit 0, and the original UI suite returned
**46/46 passed**, exit 0 (6.236 s). Prettier and `git diff --check` exited 0.

The added UI validation used the same restricted SDK and original Jest entry:

```sh
node node_modules/jest/bin/jest.js --runInBand src/viewMetadata.test.ts
node node_modules/jest/bin/jest.js --runInBand src/viewMetadata.test.ts -t "dashboard (focus|visible) revalidates"
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/prettier/bin/prettier.cjs --check src/hooks/useDashboardQuery.ts src/viewMetadata.test.ts
```

Logs in the same directory are `dashboard-focus-positive.log`,
`dashboard-focus-negative.log`, `dashboard-focus-restored.log`,
`dashboard-focus-tsc.log` and `dashboard-focus-format.log`. The earlier 265
and MCP results remain evidence of their stated byte snapshots; the unchanged
backend/PG suite was not rerun for this two-source-file UI correction. These
are real hook/event checks, not browser screenshots or live deployment.
The native write/identity, SERVICE/function, instance/binding and visual
acceptance gaps above remain unchanged.

## Original dashboard metadata consumes current native source read rights (2026-10-08)

The fixed official baseline remains
`WrenAI-ui-0.32.2@c5f02a0391c87420dba78632dcd86073710deb72`;
`tools/upstream_manifest.py status data-query` reported no newer reference
commit. Original source compared includes
`wren-ui/src/apollo/server/resolvers/dashboardResolver.ts::DashboardResolver.getDashboard/getDashboardItems`,
`wren-ui/src/apollo/server/repositories/projectRepository.ts::ProjectRepository.getCurrentProject`
and `wren-ui/src/apollo/server/services/queryService.ts::QueryService`.
No reference content was modified or executed.

Four implementation conclusions:

1. **Authority.** `.design/08` §6, DD-98, SS-WRN-IDENTITY and
   SS-WRN-GOVERNANCE require real current-user/resource authorization; an
   instance access claim or query execution cannot grant model metadata read
   or native project write. The dashboard's original item definitions contain
   SQL and chart metadata, so its two existing readers now consume the same
   registered `data_query.describe@v1`/Resource `read` checks as model/view
   metadata, not a new dashboard Action or local permission registry.
2. **Impact and compatibility.** `DashboardResolver.getDashboard` and
   `getDashboardItems` select the real current project, then use
   `NativeQueryService.metadataSources` to consume the existing original
   QueryService/Engine source analysis and captured deployment object IDs.
   All sources, including saved views and dependencies, require current read
   permission. The existing original GraphQL response, complete item/layout,
   SQL/chart definition and page remain unchanged. No Core contract, generated
   type, database migration, account table or new permission model is added.
3. **Side effects.** This metadata consumer does not call QueryService.preview,
   allocate API History, submit an ActionExecution or copy SQL/results to Core.
   After assembling visible items it reloads the original item, deployment and
   source revision and repeats the current source read checks. There is no
   cross-user decision cache or default binding/project fallback. Only an
   authoritative resource permission denial filters an item; outages and
   identity/binding failures are errors rather than apparent successful emptiness.
4. **Boundaries.** Changed item, deployment, source closure or current native
   model refuses disclosure with the existing PRECONDITION/reference error.
   Missing identity/token and foreign project/dashboard/item scope are DENIED;
   unavailable delivery or authorization is not success. These are metadata
   reads, so no unknown external write is reclassified. The native dashboard
   schedule, empty-project access and all native writes still need their real
   project authorization; per-source read is not proof that those are closed.

Actual mapping facts were traced, not inferred from instance isolation:
`Project.id` equals the controlled `projectId`/`nativeScopeRef` selection;
`Dashboard.projectId` and `DashboardItem.dashboardId` retain original native
ownership. Existing captured deployment Resource mapping is only `model|view`
with exact native IDs/names. No project/dashboard Resource-registration
consumer or native user/role authority was found. The existing Core native
HUMAN `resolveResource` is action-bound; describe cannot substitute for project
update. The original pin UI/mutation and other native management functions are
not deleted or falsely declared authorized by a query AE. Their release-level
SS-WRN-IDENTITY gap remains explicit and the release remains unactivated.

The existing restricted SDK (4 CPU/4 GiB) and local dependency cache were
reused after checking active processes and host memory pressure. Initial
original resolver/native-source checks returned **19 passed / 223 filtered
skips**, exit 0 (112.648 s), and whole-UI tsc exited 0. These exercise the real
original resolver, NativeQueryService source/fact consumer and resource-selection
payload; Engine source analysis and Core HTTP responses are controlled fixtures,
not live business authorization or a production datasource acceptance.

Private production fault injection replaced the actual source read call with
unconditional permission. The original checks returned **8 failed / 11 passed /
223 filtered skips**, exit 1 (126.08 s): unreadable/revoked source definitions
were exposed and unavailable authorization became apparent success. That
production call was restored. Independently removing only the final source
revision comparison returned **2 failed / 240 filtered skips**, exit 1
(172.096 s): deployment/source changes wrongly disclosed the assembled item.
That production comparison was also restored. No formal production source was
mutated for these negative checks.

All three production/check inputs matched the SDK candidate (`cmp` exit 0).
The restored original dashboard query and metadata consumers together returned
**29 passed / 213 filtered skips**, exit 0 (52.376 s). The initial format check
exited 1 for three mock-chain layouts; running the same existing formatter
reflowed those chains without changing arguments or assertions, and the next
format check exited 0. `git diff --check` exited 0. No backend/PG-wide suite was
rerun for these two existing metadata readers.

Actual original target commands in `/work`:

```sh
node node_modules/jest/bin/jest.js --runInBand src/nativeHumanQuery.test.ts -t "original dashboard HUMAN metadata readers"
node node_modules/jest/bin/jest.js --runInBand src/nativeHumanQuery.test.ts -t "refuses original (deployment|sources) facts changed" --silent
node node_modules/jest/bin/jest.js --runInBand src/nativeHumanQuery.test.ts -t "original dashboard HUMAN (query consumers|metadata readers)" --silent
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/prettier/bin/prettier.cjs --check src/apollo/server/resolvers/dashboardResolver.ts src/apollo/server/services/nativeQueryService.ts src/nativeHumanQuery.test.ts
```

Logs in the previously recorded SDK directory are
`dashboard-metadata-positive.log`, `dashboard-metadata-permission-negative.log`,
`dashboard-metadata-revision-negative.log`, `dashboard-metadata-restored.log`,
`dashboard-metadata-tsc.log`, `dashboard-metadata-format.log` (first failure)
and `dashboard-metadata-format-restored.log`.

No new image, dependencies, database or full-tree copy was created. Core,
contracts, Worker, the pre-existing unvalidated Java pair and frontend layout
were not changed. No business container, ACTIVE binding, iframe screenshot or
Desktop/Mobile acceptance is claimed; `check.sh --full` was not run by this
module batch. Trusted SERVICE SQL and ordinary-function/provider provenance
remain separate unsatisfied requirements.

## 2026-10-08 — Original native project management and public scope permissions

This is implementation evidence, not another permission authority or a change
to the frozen design. The fixed original remains Wren UI
`c5f02a0391c87420dba78632dcd86073710deb72`, including
`/volumes/kailo/.references/WrenAI-ui-0.32.2/wren-ui/src/apollo/server/resolvers.ts::resolvers`,
`wren-ui/src/apollo/server/resolvers/projectResolver.ts::ProjectResolver` and
`wren-ui/src/apollo/server/resolvers/dashboardResolver.ts::DashboardResolver`.
The original resolver methods, GraphQL response shape, pages, layout and pin
button remain; the differences below are authorized identity/scope/permission
consumers, not a simplified replacement interface.

The four impact conclusions after implementation are:

1. **Authority.** `.design/05` §2.7 and `.design/08` §6 keep native internal
   management in the component while consuming public identity and permissions.
   The existing platform native HUMAN endpoint now also checks `discover|manage`
   on the authenticated binding's original workspace, or tenant if the binding
   has no workspace. No project-specific Core entity, pin Action, local ACL or
   reusable permission ticket is introduced. Actual SQL admission and Resource
   read remain their separate original authorities.
2. **Impact.** The existing native HUMAN request gains an optional, exclusive
   `authorizeScope` choice and a reference-only scope result; legacy command,
   same-key observation and Resource resolution remain unchanged. All four
   bindings were regenerated from the actual schemas, with original sample and
   four round-trip consumers extended. Core verifies the independent HUMAN,
   ACTIVE tenant/member and exact binding/release/runtime generation before
   returning the scope result. The original Wren resolver map consumes current
   discovery for metadata queries and management for native metadata mutations.
   Model/view mutation bodies use their original current Resource readers;
   dashboard pin/item/layout writes read their actual source closure before
   the write and before full result disclosure.
3. **Side effects.** Scope authorization never executes SQL, submits an AE,
   copies business content to Core or persists a local permission decision.
   The original native write runs once between two fresh checks. A changed
   binding generation, current authorization or delivery refuses the response,
   without retrying that write. Pin retains its original INSERT/full response
   but does not perform the former naked SQL warm in configured binding mode;
   actual viewing/refresh retains the governed preview/cache consumer. This
   post-write refusal is not evidence that the native write was rolled back.
4. **Boundaries.** Missing identity, foreign native project, malformed scope
   facts and authoritative denial fail closed; unavailable authority is not
   successful emptiness or standalone fallback. Scope facts are checked again
   around fully consistent SpiceDB decisions, and current HUMAN/binding facts
   again before the endpoint response. A previously joined inactive workspace
   membership needs fresh tenant management as well as workspace management;
   a stale workspace-admin tuple alone is insufficient. The original DD-82
   never-joined admin behavior is retained. No schema migration or second
   account/permission/task store is added. New response/request choices require
   consumers supporting this version; old consumers reject unknown choices
   rather than silently granting them.

The original Wren Jest target returned **66 passed / 213 filtered skips / 279
total**, exit 0, then the same target after the two independent production
guard restorations returned **66 passed / 213 filtered skips**, exit 0.
Whole original Wren UI `tsc --noEmit --incremental false` exited 0. The first
format check reported the original test file; the existing formatter reflowed
it and the next original format check exited 0. All four production/check
inputs matched the restored candidate (`cmp` exit 0).

The first private production mutation changed the configured-binding guard in
`nativeProjectResolver`; the original target returned **26 failed / 1 passed /
252 filtered skips**, exit 1. It caught actual writes/disclosure entering
without current scope permission and invalid standalone fallback. The second
private production mutation bypassed `DashboardResolver.readableWriteResult`;
its original write target returned **8 failed / 2 passed / 269 filtered skips**,
exit 1, including revoked-source bodies incorrectly returned after a write.
Both production guards were restored from the formal bytes. Formal production
source was never mutated for those negative checks.

Actual original Wren commands, in the existing 4 CPU/4 GiB SDK `/work`:

```sh
node node_modules/jest/bin/jest.js --runInBand src/nativeHumanQuery.test.ts -t "original native project scope permission consumers|original dashboard HUMAN metadata readers|original dashboard HUMAN query consumers"
node node_modules/jest/bin/jest.js --runInBand src/nativeHumanQuery.test.ts -t "original native project scope permission consumers"
node node_modules/jest/bin/jest.js --runInBand src/nativeHumanQuery.test.ts -t "original dashboard HUMAN metadata readers.*(pin|update|layout)"
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/prettier/bin/prettier.cjs --check src/apollo/server/resolvers.ts src/apollo/server/resolvers/dashboardResolver.ts src/apollo/server/services/nativeHumanQuery.ts src/nativeHumanQuery.test.ts
```

Logs in
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N`
are `native-scope-positive-final.log`, `native-scope-guard-mutation.log`,
`native-scope-disclose-mutation.log`, `native-scope-restored.log`,
`native-scope-wren-tsc.log`, `native-scope-format.log` and
`native-scope-format-restored.log`. The earlier interrupted positive process
ended exit 143 and is not counted as acceptance.

Original four-side generation and `gen.sh --check` both exited 0. The actual
native-HUMAN scope sample round-trip passed in original TypeScript runtime and
typecheck, Go (1/1) and Dart (1/1), using existing local caches without downloads.
An initial Python `jsonschema` attempt failed because that SDK does not contain
the module; no package was installed and that attempt is not schema acceptance.
An initial Dart unsupported `--no-pub` invocation and missing original export
input failed; after consuming the original export and cached test runner the
final Dart target passed. Logs are in the existing
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX`
directory: `native-scope-generate.log`, `native-scope-generate-check.log`,
`native-scope-ts-roundtrip.log`, `native-scope-go-roundtrip.log` and
`native-scope-dart-roundtrip-final.log`.

This batch does not prove release-level SS-WRN-IDENTITY/GOVERNANCE complete.
Original reset/data-source replacement changes the native project ID and still
needs binding lifecycle reconciliation; native SQL-pair `validateSql` has a
separate dry-run admission gap; new model/view Resource registration must exist
before their full bodies pass disclosure. Native CRUD lost-ACK recovery,
idempotency and public audit are not demonstrated by scope checks. Trusted
SERVICE SQL, ordinary-function/provider provenance and the separately excluded
unvalidated Java pair remain explicit gaps. There is no live Wren business
container, datasource/provider, ACTIVE binding, iframe screenshot or
Desktop/Mobile acceptance. No image, new database, dependency installation or
whole-app copy was created; module `check.sh --full` was not rerun. Wren
fixtures do not stand in for production authorization.

The first actual restricted Core `cargo clippy --workspace --all-targets --
-D warnings` exited 101 on `platform_views.rs::list_own_audit` after a test
module and `temporal/automation_steps.rs`'s unnecessary struct default update;
these are not passing checks. The subsequent original workspace
`native_human` target exited 101 because its contracts round-trip linked an old
cached library without `NativeHumanScopeResult`. Both current formal and private
generated source contain that type and compare equal; the diagnostic instead
names the older `/workspace/apps` generated source. The shared target's
library timestamp was later than the copied source, and its dep-info records
relative crate input paths. No cache was deleted to bypass the failure. The
following PG and bridge commands in that invocation were not run after the
first command failed. Failure logs are `native-scope-core-clippy.log` and
`native-scope-core-positive.log` in the same original evidence directory.

The native scheduler is one concrete SERVICE-SQL consumer still outside that
acceptance: `wren-ui/src/apollo/server/backgrounds/dashboardCacheBackgroundTracker.ts::refreshDashboardCache`
calls the original `QueryService.preview` for scheduled refresh. Native
`setDashboardSchedule` management permission is not authorization for that
background SQL. The release must not be activated on the strength of this
scope-check batch; no scheduler execution or SERVICE AE is claimed here.

### Final Core and isolated SQL evidence for this increment

After the mainline owner corrected the two pre-existing clippy failures, only
those actual source bytes and the required current Rust manifests, original
fixtures, contracts, registry and Gateway proto were synchronized into the
existing private SDK candidate. The five mainline bridge/read/service/media
inputs compared equal to the formal tree. No target, dependency tree, UI tree,
whole application snapshot or database was recreated. The exact private
contracts source inputs were byte-identical and their mtimes were refreshed;
the next original Cargo invocation compiled the actual new scope type rather
than reusing the old library. The earlier failed logs were retained.

The actual original `cargo test --workspace native_human -- --nocapture`
finished exit 0: the Rust native-HUMAN round-trip passed **1/1**, and Core's
native-HUMAN header/request/JWT targets passed **3/3**, with **2 explicit
isolated-database targets ignored** in that invocation. That filter still
compiles the existing workspace integration targets; their zero-selected-test
outputs are not extra passing business tests. The native Resource-selection
SQL target was not rerun by this batch.

The existing `AGENT_INVOKE_TEST_DATABASE_URL` was confirmed to select the
already-migrated isolated `component_runtime_lcivus` database, with the actual
tenant, HUMAN and workspace membership tables present. Running the original
`native_human_mapping_uses_binding_tenant_and_current_identity_chain` target
with `--ignored --nocapture` returned **1 passed / 0 ignored / 396 filtered**,
exit 0. Its real PostgreSQL transaction exercises ACTIVE and revoked members,
the existing DD-82 exception, paused tenant/workspace, disabled HUMAN/principal
and the original identity mapping, then rolls back. Public permission HTTP
responses are the existing controlled SpiceDB fixture, not a live business
SpiceDB acceptance. This is real isolated SQL execution, not a missing-env
`SKIP` branch.

Private production mutation changed the actual revoked-membership condition
so a non-ACTIVE member no longer needed current tenant management. The same
original SQL target returned **1 failed / 0 ignored**, exit 101, precisely at
the assertion refusing a revoked member with only a residual workspace-admin
relation. The formal production file was untouched. Restoring its exact bytes
(`cmp` exit 0) and rerunning returned **1 passed / 0 ignored**, exit 0. No SQL
fixture/schema or expected denial was weakened to make the restored run pass.

The final original `cargo clippy --workspace --all-targets -- -D warnings`
exited 0, and `cargo test -p collab-bridge --lib bridge::media_tests --
--nocapture` returned **6 passed / 0 failed**, exit 0. They used the existing
4 CPU/8 GiB SDK cgroup and `/cache/rust-target`, preserving the requested
Cargo parallelism. This window was coordinated after the UI teammate's actual
Node/types terminal result and released afterward; no competing Cargo was
started. Original `rustfmt` and `gofmt` formatted the owned consumers while
retaining current mainline avatar/emoji round-trip checks. The original avatar
sample was restored to exact HEAD bytes rather than leaving its unintended
deletion in this batch.

Actual original Core target commands in the private `core` directory:

```sh
CARGO_NET_OFFLINE=true CARGO_TARGET_DIR=/cache/rust-target CARGO_BUILD_JOBS=16 cargo test --workspace native_human -- --nocapture
CARGO_NET_OFFLINE=true CARGO_TARGET_DIR=/cache/rust-target CARGO_BUILD_JOBS=16 cargo test -p platform-core --bin platform-core native_human_mapping_uses_binding_tenant_and_current_identity_chain -- --ignored --nocapture
CARGO_NET_OFFLINE=true CARGO_TARGET_DIR=/cache/rust-target CARGO_BUILD_JOBS=16 cargo clippy --workspace --all-targets -- -D warnings
CARGO_NET_OFFLINE=true CARGO_TARGET_DIR=/cache/rust-target CARGO_BUILD_JOBS=16 cargo test -p collab-bridge --lib bridge::media_tests -- --nocapture
```

Final logs in the previously recorded original Core evidence directory are
`native-scope-core-positive-restored.log`, `native-scope-core-pg-positive.log`,
`native-scope-core-pg-mutation.log`, `native-scope-core-pg-restored.log`,
`native-scope-core-clippy-restored.log` and `native-scope-bridge-media.log`.
The four generated bindings and scope consumers are implementation/specialized
acceptance evidence, not the complete release `check.sh --full`, published-tag
compatibility gate, live multi-user Wren deployment or visual acceptance.

The mainline owner then ran the original `step_contract` against the actual
read-only formal source and index in the existing SDK image, network disabled,
2 CPU/4 GiB, with the original local npm cache. It exited 0: all four generated
bindings and same-source Mobile catalogs matched; 291 schemas were checked
against `contracts-v0.1.0`, with only 3 historical matches. That narrow historical
baseline is not full business compatibility. Log:
`native-scope-formal-contract-original-path.log` in the same evidence directory.
The first invocation sourced the checker in the wrong cwd and exited 1; a second
login-shell invocation lost the image's formatter PATH and exited 1. Both failed
logs remain as `native-scope-formal-contract-seam-docs.log` and
`native-scope-formal-contract-seam-docs-restored-cwd.log`. Restoring only the
image's original PATH fixed the invocation; no generated bytes, dependencies or
permissions were changed to obtain success. The second invocation's original
documentation check separately exited 0.

Native frontend outcome handling is still a concrete release blocker. Original
`wren-ui/src/apollo/client/index.ts` has no RetryLink, but the installed Apollo
3.9.6 `useMutation` resolves its error result when a caller supplies `onError`.
Original modeling/home and pin callers do so; their drawers can then close, and
`wren-ui/src/utils/errorHandler.tsx` labels post-write 403/412 as failed. Backend
scope/disclosure rejection does not prove those writes were rolled back, or
that the original frontend presents UNKNOWN or prevents a later duplicate pin.
The 66 Jest cases do not accept that frontend behavior. The component release
remains inactive while its actual error and readback consumers are corrected.

## Native metadata UNKNOWN and original creation consumers (2026-10-08)

### Authority, actual impact and boundaries

The authority remains `.design/05` §2.7 and `.design/08` §6: original native
project metadata uses the existing current HUMAN/public scope and Resource-read
authority, not a fabricated query Action or a local ACL. `apps/06` §4 requires an
uncertain native side effect to remain UNKNOWN and prohibits blind replay.
This increment does not turn query admission into native metadata admission or
activate the component release.

The fixed official source was rechecked read-only at
`WrenAI-ui-0.32.2@c5f02a0391c87420dba78632dcd86073710deb72`:

- `wren-ui/src/apollo/client/index.ts::client` uses the original error link and
  HttpLink, with no RetryLink. No automatic HTTP resend is inferred here.
- `wren-ui/src/components/pages/modeling/ModelDrawer.tsx::submit` and
  `wren-ui/src/components/modals/SaveAsViewModal.tsx::submit` await their original
  `onSubmit` before closing. Their actual layout and control implementation are
  retained rather than replaced with a new form or status page.
- `wren-ui/src/pages/modeling.tsx::Modeling`,
  `wren-ui/src/pages/home/[id].tsx::HomeThread` and
  `wren-ui/src/components/pages/home/promptThread/ChartAnswer.tsx::ChartAnswer`
  supplied `onError` to their original create hooks. The actual installed Apollo
  3.9.6 `react/hooks/useMutation.js` resolves an error response after calling that
  callback, so a rejected backend write acknowledgement can otherwise close the
  original dialog and later permit another creation.
- `wren-ui/src/apollo/server/utils/error.ts::defaultApolloErrorHandler` already
  retains `extensions.other` but does not return its nested `originalError`.
  This existing formatter is reused, not a new wire error transport.

The changed execution boundary is the existing
`wren-ui/src/apollo/server/resolvers.ts::nativeProjectResolver`: a proven
pre-native permission/configuration refusal is marked NOT_STARTED, whereas a
failure after entering original native CRUD is UNKNOWN. The existing before/
after fresh scope, binding generation, delivery and body-read checks are not
removed or weakened. Where the actual created row is available, only its native
type/ID is attached; the original pin resolver also retains its actual INSERT
row reference when its following Resource-read check refuses. No row is
fabricated, no SQL is re-executed, and neither Core nor a new registry stores
the model/view/chart body.

The three actual original create controls call the same component utility and
their original GraphQL mutations. Its readback consumers are the existing
`LIST_MODELS`, `LIST_VIEWS` and `DASHBOARD_ITEMS`, with `no-cache` and exact
returned native-ID matching. The original model/view dialogs remain open on
UNKNOWN rather than completing their awaited submit; pin keeps its original
confirmation. Creation success is shown only after a verified original response
or an authorised readback. A subsequent diagram/deployment refresh error does
not reinterpret a known completed creation as an unsent write.

The existing `/api/config` consumer obtains current HUMAN `discover` and the
actual generation from the existing binding scope response. Browser-supplied
tenant/project/generation fields are not authority. The retained browser marker
is scoped by the current opaque identity/binding scope and captured authoritative
generation; it contains only an input digest and an optional native reference.
Known absence or refusal of a referenced row remains UNKNOWN, never permission
to repeat the write. A generation/identity change cannot disclose the old result
or discard its uncertain write to submit a replacement.

There is no database migration, second task/execution table, durable server
idempotency, account/permission authority or new Core contract in this increment.
The original GraphQL error code remains INTERNAL_SERVER_ERROR, with component
outcome information in its existing `other` field. Older clients do not gain the
new UNKNOWN/readback consumer; client/server coordinated release remains
required. Existing browser markers without the captured generation are refused
rather than silently upgraded or replayed.

The relevant six-class mapping is unchanged: current identity/permission refusal
before dispatch is DENIED; missing binding/projection or unavailable storage/
Web Crypto is PRECONDITION; changed generation is CONFLICT before dispatch and
UNKNOWN once native execution may have occurred. Unsupported recovery is
BLOCKED at release activation. LIMIT remains the original request/quota surface;
this native metadata increment neither reserves SQL quota nor bypasses it.
An arbitrary GraphQL/serialization error is not evidence of NOT_STARTED.

The browser uses standard Web Crypto SHA-256, not a handwritten hash or a
downloaded fallback. HTTPS/secure-context Web Crypto and session storage are
required before native mutation dispatch. A non-localhost HTTP/LAN browser
without `crypto.subtle` fails closed before storing input or sending the write.
No plaintext SQL, input, result or credentials are persisted in the browser
marker. This HTTP environment is not a create-function acceptance claim.

This is explicitly the three creation consumers, not closure of all native
update/delete/reset/lifecycle operations. Full acknowledgement loss without a
native reference stays UNKNOWN with no safe readback target; it never treats
not-found as failure or sends another native write. The browser marker ends
after a verified result, or on a proven pre-native refusal; otherwise its
session retains the unresolved reference/digest. Session loss and other clients
still lack durable recovery and remain release blockers, not a claimed
production reconciliation mechanism. Newly created model/view Resource
registration, native project replacement, SQL-pair dry run, trusted SERVICE
SQL/scheduler and ordinary-function/provider provenance remain separate concrete
gaps. No live business container, ACTIVE binding, iframe, browser screenshots,
installed Desktop/Mobile or full production/multi-user acceptance is claimed.

### Original targeted check: first actual failure

The existing Wren SDK `kailo-wren-query-sdk-itgs2n` was confirmed running with
4 CPU/4 GiB cgroup limits and existing dependencies. The first original serial
Jest invocation selected the original native project/dashboard consumers and
the new original-create consumers from `nativeHumanQuery.test.ts`,
`viewMetadata.test.ts` and `modeling.test.ts`. It exited 1: **73 passed / 213
filtered skip**, with two suites passing and one suite unable to compile because
a `createElement` call selected two original components with incompatible Props.
The actual component calls were corrected individually; no production
expectation was weakened. Log: `native-write-positive.log` in the existing Wren
SDK `/work` evidence directory recorded earlier in this receipt.

The first formatting invocation also exited 1 because it used the absent
Prettier 2-style `bin-prettier.js`. The installed original Prettier is 3.2.5;
using its actual `bin/prettier.cjs` then formatted the exact owned inputs, exit
0. The failed `native-write-format.log` and actual
`native-write-format-final.log` are retained. No dependency was installed or
changed to correct either invocation.

The next actual combined invocation exited 1 with **96 passed / 2 failed / 259
filtered skip**. Both failures were the original modal checks: the existing SSR
fixture rendered `children` but omitted the original Modal/Drawer `footer`, so
it could not find their real Save/Submit buttons. The fixture was corrected to
render that original footer, not to replace a production control or weaken the
close assertion. The subsequent original UI-only invocation exited 0 with
**27 passed / 46 filtered skip**; it exercises the original model callback and
the original two modal submit/close consumers. Logs are
`native-write-positive-final.log` and `native-write-ui-positive.log` in the same
original Wren evidence directory. The first combined run spent 664.768 seconds
loading the native suite; the UI invocation spent 529.136 seconds loading its
first suite. Read-only process checks showed `folio_wait_bit_common` disk I/O
wait, not an OOM, and no competing Wren check was started to bypass it.

The same three original Apollo mutation calls now set a local operation-context
presentation flag only when their existing bound-mode UNKNOWN guard dispatches.
The original error link consumes it so an output-serialization error without a
server outcome cannot first show a definite create failure. This flag is not a
wire identity/scope, permission, execution key or new ticket; it cannot authorize
server work. The never-configured standalone calls do not set it and retain
their original failure handling. Original `ModelDrawer::submit` and
`SaveAsViewModal::submit` only `catch(console.error)` after their awaited callback;
they do not turn its UNKNOWN rejection into a failure toast or run `onClose`.
The installed original antd 4.20.4
`lib/modal/ConfirmDialog.js::ConfirmDialog` forwards pin's `onOk` to
`lib/_util/ActionButton.js::handlePromiseOnOk`: resolve calls `close`, rejection
only logs and clears loading/clicked state. This is actual dependency source
evidence, not a browser screenshot or installed Desktop acceptance.

Private production mutation replaced the real native wrapper's post-entry
UNKNOWN handling with the original error throw. Its original three selected
checks returned **3 failed / 283 filtered skip**, exit 1, including the real
Apollo formatter result becoming `private-native-error-body` instead of
UNKNOWN. Restoring `resolvers.ts` from the formal implementation compared equal,
exit 0. The private browser mutation then bypassed the existing-marker branch
in `runNativeMetadataWrite`. Its original target returned **12 failed / 9 passed /
46 filtered skip**, exit 1: real consumers sent a second mutation or failed to
read back the recorded object, including the original modal callbacks. Both
mutations changed only the private SDK's production inputs, not the formal
source or the assertions. After restoring the browser production input, all
**13 owned source/check inputs compared equal**, exit 0. Logs:
`native-write-backend-mutation.log` and `native-write-ui-mutation.log`.

### Final restored implementation evidence

With both private production mutations restored, the original three selected
suites finished **101 passed / 0 failed / 259 filtered skip**, exit 0. This final
run includes the final three real mutation operation-context consumers, normal
standalone error presentation, post-write serialization UNKNOWN, authoritative
generation changes and the model's non-blocking secondary refresh error path.
The expected dashboard refusal logs are the original negative fixtures, not
failed suites. Whole Wren `tsc --noEmit --incremental false` then exited 0 with no
diagnostics, and the original Prettier check of the same 13 owned inputs exited
0: `All matched files use Prettier code style!`. Original cgroup events were zero
before the batch and at this final terminal result: `oom 0`, `oom_kill 0`,
`oom_group_kill 0` (increments all zero), within the existing 4 CPU/4 GiB SDK.

Actual final commands in the existing SDK `/work` directory:

```sh
node node_modules/jest/bin/jest.js --runInBand --verbose=false src/nativeHumanQuery.test.ts src/viewMetadata.test.ts src/modeling.test.ts -t 'original native project scope permission consumers|original dashboard HUMAN metadata readers|original dashboard HUMAN query consumers|original native metadata create UNKNOWN|original modeling page authorization result consumer'
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/prettier/bin/prettier.cjs --check src/apollo/server/resolvers.ts src/apollo/server/resolvers/dashboardResolver.ts src/apollo/server/utils/error.ts src/utils/errorHandler.tsx src/utils/language.ts src/utils/env.ts src/pages/api/config.ts src/pages/modeling.tsx 'src/pages/home/[id].tsx' src/components/pages/home/promptThread/ChartAnswer.tsx src/nativeHumanQuery.test.ts src/viewMetadata.test.ts src/modeling.test.ts
```

Final logs are `native-write-restored.log`, `native-write-types.log` (no emitted
diagnostics), `native-write-format-check.log` and `native-write-cgroup.log` in
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N`.
The selected-target skips are not passed tests or additional feature acceptance.
The current batch did not run a second database, image, dependency install,
global build, `check.sh --full`, compatibility matrix or Java verification.
It changes no Core schema/generated contract. The two earlier unverified Java
provenance candidates remain outside this increment. Mainline submission/push
and release are owned by the mainline agent; no deployment or activation is
inferred from these source, SSR/handler and narrow implementation checks.

## Original SQL-pair dry-run and mutation outcome consumers (2026-10-08)

### Authority, original-source evidence and complete impact

The established `.design/07` section 4.6 / DD-87 and `.design/08` section 6
require retaining the complete native Wren page while consuming current HUMAN
identity, scope, authorization and governed SQL execution. A successful preview
is not permission to run another SQL statement or to treat native metadata CRUD
as an idempotent platform Action. DD-98's existing-reference registration and
trusted delivery requirements are unchanged; this increment does not manufacture
dynamic Resource evidence from a returned model/view ID.

The fixed original source is
`WrenAI-ui-0.32.2@c5f02a0391c87420dba78632dcd86073710deb72`. Source facts were
read with `git show` from that commit, without executing upstream files:

- `wren-ui/src/apollo/server/resolvers/sqlPairResolver.ts`,
  `SqlPairResolver.createSqlPair`, `updateSqlPair` and `validateSql`: both native
  mutations directly called the original QueryService dry-run before the
  original metadata service. Optional SQL in update could reach that validator
  as undefined.
- `wren-ui/src/components/modals/QuestionSQLPairModal.tsx`,
  `QuestionSQLPairModal`: the original Submit, SQL validation, preview,
  generate-question, native form, import control and close consumers remain.
- `wren-ui/src/pages/home/[id].tsx`, `HomeThread`, and
  `wren-ui/src/pages/knowledge/question-sql-pairs.tsx`,
  `ManageQuestionSQLPairs`: these are the real original create/update callbacks,
  not a replacement metadata page.
- `wren-ui/src/apollo/server/schema.ts`, `typeDefs`: the original
  `CreateSqlPairInput` / `UpdateSqlPairInput` own this native GraphQL input.

The impact was traced across those actual callers, the existing
`useGovernedSqlPreview`, `NativeHumanQuery.previewSql` / `disclose`, original
native SQL history/intent consumers, and the actual Apollo error link. Original
SqlPairService, its database/repositories, learning behavior, native mutations,
SQL editor, table, drawer, preview and import implementation are not replaced.
All changed source differences in this increment are the authorized governance
consumer, required native GraphQL generation, localized outcome presentation or
implementation-after checks. There is no new Core/Worker entity, native table,
workflow, permission ticket, task registry, SQL parser or billing authority.

### Actual implemented consumer and compatibility

The original hook exposes only the completed dry-run's opaque key/scope after
the existing current-SQL/scope/action/limit checks. Reset, focus revalidation,
another query/limit or unfinished evidence cannot expose that validation
identity. The original modal submits it along with its unchanged form values.
The existing server mutations observe the same `data_query.dry_run@v1` AE using
`NativeHumanQuery.previewSql` in observation-only mode. Native history still
fixes the SQL, deployment, connection, parameters and source references; the
existing HUMAN disclosure path rechecks current source and result-policy
authorization. No missing AE is repaired by selecting or commanding a second
SQL execution. Incomplete or mismatched evidence does not reach native metadata
write. Governance fields are stripped before calling the original SqlPairService.

The original schema gains two optional fields on each existing native input;
the actual original GraphQL generator emits their client types. This is not a
change to the four-language platform contracts and requires no database
migration. The current modal/two callback consumers write the optional fields;
the server reads them. A bound old caller without them is refused rather than
allowed to execute bare SQL. A never-configured server keeps its original
standalone dry-run; a present empty/invalid delivery does not select that path.
Question-only updates retain the original edit service without submitting an
undefined SQL. This does not establish full standalone browser acceptance.

The same original modal no longer unconditionally overwrites every caught
error with `Invalid SQL syntax`. Only original `INVALID_SQL_ERROR` selects that
message. Before a native metadata mutation it rechecks the current trusted
browser configuration/scope; the server remains the authorization authority.
Only a verified native `NOT_STARTED` refusal proves it is safe to retry a
refused write. Once a bound metadata mutation has been entered, a transport
exception, missing outcome or native UNKNOWN keeps the original modal open,
shows a Chinese/English unresolved warning and prevents concurrent/repeated
Submit in that mounted component. Its original reset/close does not cancel
native work or clear that instance's uncertainty. The two actual callbacks pass
only an Apollo presentation-context flag so the original global error link does
not show an earlier generic failed/retry-network message. That flag is not a
wire identity, permission, execution key or public Action.

No reliable metadata reference/observe protocol is invented. These SQL-pair
create/update operations do not acquire native idempotency, durable recovery,
cross-reload/client fencing or a second ledger from their dry-run AE. Those
remaining UNKNOWN recovery gaps still block activation. They are not resolved
by leaving the modal open and are not reported as fully delivered metadata CRUD.

### Boundaries and actual negative evidence

Empty/malformed delivery, missing HUMAN/policy/history and changed native
connection/deployment/source remain fail-closed. Current authorization refusal
is `DENIED`; unavailable binding/evidence is `PRECONDITION`; changed identity,
revision or intent is `CONFLICT`; unconfirmed admitted SQL or native write is
`UNKNOWN`, never successful or failed. Existing execution/transport bounds
retain `LIMIT`, and the still-inactive release retains `BLOCKED`, following
`apps/06` section 4. No new error code or execution state is introduced.

The existing SQL/AE/history chain remains responsible for timeout, duplicate
delivery, restart and in-flight authorization/usage convergence. This consumer
does not reissue SQL to repair missing evidence. Unknown enum values and
unfinished/invalid dry-run receipts refuse metadata write. The original UI
checks include a pending native write, simultaneous Submit, identity change
after validation, scope/project mismatch, different SQL under the same key,
denied source access, no-binding mode, and broken delivery. No such fixture is
production business data or proof of a deployed component.

The original offline GraphQL generator exited 0; all generated outputs were
compared and only `src/apollo/client/graphql/__types__.ts` changed, with the two
optional fields on each input. Actual invocation in the original SDK `/work`:

```sh
TS_NODE_TRANSPILE_ONLY=1 TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS"}' node -r ts-node/register -e 'const {loadCodegenConfig,generate}=require("@graphql-codegen/cli"); const {print}=require("graphql"); const {typeDefs}=require("./src/apollo/server/schema"); (async()=>{const loaded=await loadCodegenConfig({configFilePath:"codegen.yaml"});await generate({...loaded.config,schema:print(typeDefs)},true)})().catch(e=>{console.error(e);process.exit(1)})'
```

The first two-suite invocation exited 1 with **11 failed / 8 passed / 279
filtered skip** and the UI suite unable to load: the added fixture omitted the
original telemetry decorator's `ctx.telemetry.sendEvent`, and the original
ErrorCollapse import lacked the test's antd stub. Only those original test
fixtures were corrected. The next invocation exited 1 with **1 failed / 66
passed / 300 filtered skip** because its mocked original mutation result omitted
`reset`; adding that actual original method to the fixture fixed it. The failed
`sql-pair-positive.log` / `sql-pair-positive-restored-fixture.log` remain.

Private production mutation bypassed `NativeHumanQuery.previewSql`'s
observation-only guard. The selected original check failed, exit 1. Its first
fixture stopped at an undefined draft; the fixture was strengthened with actual
native-source resolution data, not a weaker expectation. Repeating the actual
production mutation then failed with **1 failed / 297 filtered skip**: the
original platform call count changed from one observe to six calls including
source resolution and command. Log:
`sql-pair-negative-missing-ae-full-source.log`; the earlier
`sql-pair-negative-missing-ae.log` is retained too. Restored production input
compared equal to the formal file, exit 0.

Bypassing the actual SqlPairResolver completed/valid receipt guard produced
**4 failed / 294 filtered skip**, exit 1: the native metadata promises actually
resolved for incomplete/unknown/invalid evidence. Log:
`sql-pair-negative-incomplete.log`. That production input was restored and
compared equal, exit 0. Removing the original modal's unresolved-write replay
guard produced **3 failed / 76 filtered skip**, exit 1: its actual Submit consumer
called native mutation twice for UNKNOWN, transport loss and missing outcome.
Log: `sql-pair-negative-ui-replay.log`. The modal was then restored and compared
equal, exit 0. Assertions were unchanged during all production mutations.

### Final restored evidence and release boundary

After all private mutations were restored, the actual original two-suite
target finished **79 passed / 0 failed / 298 filtered skip**, exit 0. This
includes the original global Apollo UNKNOWN and never-configured create
consumers as well as the new original SQL-pair consumers. Whole Wren
`tsc --noEmit --incremental false` exited 0 with no diagnostics. Original
Prettier checked all 11 handwritten source/check inputs and exited 0:
`All matched files use Prettier code style!`. All 12 formal source/generated/check
inputs compared identical to the final SDK candidate, exit 0, and scoped
`git diff --check` exited 0. Cgroup `oom`, `oom_kill` and `oom_group_kill` were
zero before and after this batch (all increments zero).

```sh
node node_modules/jest/bin/jest.js --runInBand --verbose=false src/nativeHumanQuery.test.ts src/viewMetadata.test.ts -t 'SQL-pair|SQL editor|SQL-editor|actual SQL resolver|exact completed dry-run identity|original saved-view preview controls|original global Apollo consumer|original never-configured standalone create'
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/prettier/bin/prettier.cjs --check src/apollo/server/resolvers/sqlPairResolver.ts src/apollo/server/schema.ts src/apollo/server/services/nativeHumanQuery.ts src/components/modals/QuestionSQLPairModal.tsx src/hooks/useGovernedSqlPreview.ts src/nativeHumanQuery.test.ts 'src/pages/home/[id].tsx' src/pages/knowledge/question-sql-pairs.tsx src/viewMetadata.test.ts src/utils/errorHandler.tsx src/utils/language.ts
```

All these commands use the existing `kailo-wren-query-sdk-itgs2n` 4 CPU/4 GiB
cgroup, original installed dependencies and isolated candidate. Evidence logs
are retained under
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N`:
`sql-pair-codegen.log`, `sql-pair-final-restored.log`,
`sql-pair-final-types.log` (no diagnostics), `sql-pair-final-format-check.log`
and `sql-pair-final-cgroup.log`, plus the retained failure/mutation logs above.
The intermediate 67- and 77-passed runs apply only to those earlier input
snapshots; the 79-passed run is the final restored current-byte evidence.
No new image, database, dependency, full-tree copy or global build was started.
The raw first attempt to execute the non-executable upstream manifest Python
file returned permission denied; the original `python3 -B
tools/upstream_manifest.py status` invocation then exited 0. Neither changed the
fixed original source pin or installed anything.

Filtered skips are not passed tests. This batch did not run Java verification,
`check.sh --full`, a platform-contract four-language matrix, a deployment or
Playwright/device screenshots. The two earlier unverified Java candidates are
excluded. Original REST SQL-pair bare validation, trusted SERVICE SQL,
ordinary-function provenance, dynamic Resource evidence and durable native
metadata reconciliation remain concrete separate gaps. No live Wren business
container, ACTIVE binding, iframe, production multi-user function or 100%
original visual equivalence is claimed. Mainline submission/push and activation
remain owned by the mainline agent, after integration evidence.

## 2026-10-08 original SQL-pair persisted write and same-event recovery

### Authority, impact, effects and boundaries

This increment implements `SS-WRN-IDENTITY` / `SS-WRN-GOVERNANCE` under
`.design/08` §6, `.design/05` §2.7 and DD-87. Native SQL-pair management remains
native management, not a new platform Action or execution authority. The fixed
original source was read again, without executing or modifying `.references`:

- `c5f02a0391c87420dba78632dcd86073710deb72`,
  `wren-ui/src/apollo/server/services/sqlPairService.ts`,
  `SqlPairService.createSqlPair`, `editSqlPair`, `deleteSqlPair`: the original
  local transaction surrounded external AI indexing/deletion. A lost ACK could
  therefore rollback the local ID while the external effect had already run.
- The same full commit,
  `wren-ai-service/src/web/v1/routers/sql_pairs.py`, `prepare` and `delete`:
  the original event IDs were generated inside those endpoints. The existing
  `SqlPairsService` event cache could observe a known event, but a missing cache
  entry was previously reported as failed rather than unprovable.

The impact search included original repository/service/adaptor, GraphQL
schema and generated hooks, REST CRUD, Home/Knowledge modal callbacks,
ApiHistory fields and `AskingResolver.transformAskingTask`. No new database
table, workflow, registry, permission authority, native SQL parser or platform
contract was added. Existing `project`, `sql_pair` and `api_history` are the
native authority. The project row lock serializes preparation/completion;
the original intent, original row/reference and API History status are written
in their existing database transaction. Original SQL/question bodies remain
in Wren, never Core. Existing native scope authorization supplies current
HUMAN management/discovery and generation; browser-supplied scope is not that
authority.

Only a newly prepared intent may dispatch its original native event. Reentry
under its same opaque key observes that event and never sends another POST or
DELETE. The optional original Python `native_task_id` consumer claims the
existing cache event before scheduling, accepts the identical claim, and
refuses changed input. Only explicit same-event `finished` evidence plus fresh
management/generation can atomically settle native row and history. Original
row snapshot drift refuses completion. Pending CREATE rows are withheld;
pending UPDATE/DELETE retains the previous native row and carries a transient
pending projection, not another persistent state authority.

The original list can reconcile the initiating user's persisted event after
reload or from another client without a native write. History bodies and Ask
SQL-pair candidates use those actual consumers; a pending pair is not returned
as active. The original modal retains only input digest/reference, awaits its
real asynchronous submission, and observes a recorded native reference on
reentry. The original delete control retains its opaque same-event key. REST
CRUD consumes the same services and same HUMAN dry-run/observation, preserving
its original success response shapes. Never-configured standalone remains
independent; empty/invalid configured delivery does not select standalone.

Compatibility is limited to optional internal GraphQL fields
`SqlPair.nativeWritePending` and `SqlPairWhereUniqueInput.idempotencyKey`, and
the optional native Python request ID. The original generator emitted the two
TypeScript GraphQL products; no generated file was hand-maintained. Older
bound writers without current identity/key/validation are refused rather than
executing the old ungoverned path. No new database migration or four-language
platform-contract change applies. Layout, controls, original success text and
pages are retained; delayed success/UNKNOWN presentation, native context and
same-event execution are the authorized governance differences.

### Actual implementation-after checks and deliberate production damage

All Node/Python checks used the existing `kailo-wren-query-sdk-itgs2n` 4 CPU /
4 GiB cgroup, existing installed dependencies and original isolated candidate.
The original PostgreSQL container was already running. A read-only identity
check returned `wren_query_itgs2n|isolated-query-fixture`; the original connection
was present without printing it. The new independent original-repository
describe verifies that fixture, uses transactions/savepoints and rolls back
all its rows. It does not run the other suites' migration hooks, create a
database, touch a business database or claim cross-connection concurrency
acceptance.

```sh
node node_modules/jest/bin/jest.js --runInBand --verbose=false src/nativeHumanQuery.test.ts src/viewMetadata.test.ts
node node_modules/jest/bin/jest.js --runInBand --verbose=false src/nativeQuery.test.ts -t 'original SQL-pair PostgreSQL write transaction'
node node_modules/typescript/bin/tsc --noEmit --incremental false
python3 -B -m unittest discover -s data-query/wren-ai-service/tests/pytest/providers -p test_native_sql_answer_stream.py
```

The first two-suite run exited 1: **387 passed / 7 failed**. Six original UI
checks were awaiting only one event-loop tick instead of the actual WebCrypto
and submission promise; the original handler now returns its own promise and
the checks await it. The other assertion had not yet consumed the real bound
question-only edit context. The exact native context assertion was corrected;
no production protection or expected refusal was weakened. Intermediate type
invocations also exited 2 for real consumer/fixture type errors, all corrected
before final acceptance. Those logs remain retained. The first mechanical
format command formatted the inputs but its shell wrapper exited 2 with
`exit: Illegal number`; the subsequent exact original formatter check exited
0, reporting `All matched files use Prettier code style!` for all 22 handwritten
TypeScript inputs.

In the private candidate only, the actual newly-prepared dispatch guard was
bypassed, the actual repository snapshot check was removed, and the original
modal pending-result guard was removed. Unchanged original checks returned
**5 failed / 498 filtered skip**, exit 1: three duplicate dispatches, a real
PostgreSQL changed-snapshot completion and premature modal close were caught.
The original Python claim was separately bypassed; its original endpoint
consumer returned **1 failed / 15 passed**, exit 1, catching two background
dispatches instead of one. These were production mutations, not deliberately
failed checks written before implementation. All four damaged production
inputs were restored from the formal source and compared identical, exit 0.

Final restored checks completed with actual exit 0:

- Original two Node suites: **394 passed / 0 failed**, including real original
  REST handlers over HTTP, current-permission refusal, same-event ACK recovery,
  History/Ask consumers and modal remount/read-back.
- Original SQL-pair PostgreSQL target: **9 passed / 100 filtered skip**.
- Whole Wren TypeScript no-emit: **exit 0**, no diagnostics.
- Original Python producer/consumer target: **16 passed**.
- Original Prettier check: **exit 0**; candidate/formal restored inputs match.
- Cgroup `oom`, `oom_kill` and `oom_group_kill` remain zero, increments zero.

Logs are retained under
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N`:
`sql-pair-native-write-codegen.log`, `sql-pair-native-write-types.log`,
`sql-pair-native-write-types-final.log`,
`sql-pair-native-write-types-restored.log`,
`sql-pair-native-write-jest.log`, `sql-pair-native-write-jest-restored.log`,
`sql-pair-native-write-final-restored.log`, `sql-pair-native-write-pg.log`,
`sql-pair-native-write-pg-restored.log`, `sql-pair-native-write-negative.log`,
`sql-pair-native-write-python.log`,
`sql-pair-native-write-python-negative.log`,
`sql-pair-native-write-python-restored.log`,
`sql-pair-native-write-format.log`, `sql-pair-native-write-format-check.log`.

### Exact remaining delivery boundary

This is not complete native CRUD recovery. The first durable intent can exist
without a dispatched event after a crash; cache expiry, partial native failure
or initiating-user revocation remains UNKNOWN without redispatch. The original
read consumers provide an observation entrance but not yet bounded operational
reconciliation for those cases; release activation remains blocked. Losing all
keys/references across clients still prevents distinguishing a new create from
an old completed one. No cross-client exactly-once guarantee is claimed.
Other metadata CRUD, trusted SERVICE SQL, ordinary-function provenance and
dynamic Resource evidence remain separate concrete gaps. WebCrypto needs a
production HTTPS secure context; local HTTP LAN creation is not accepted as
working by these fixtures.

No new image, dependency, database, full-tree copy or global build was started.
No Java verification, `check.sh --full`, four-language platform matrix,
Playwright screenshot/device acceptance, Wren business deployment or ACTIVE
binding was run or established in this increment. The earlier two unverified
Java candidates remain excluded. This evidence does not certify iframe,
multi-user production use or 100% original visual equivalence. Mainline
integration, commit/push and publication remain the root agent's ownership.

### Implementation-after cross-review corrections

The earlier 394-item result did not prove the real never-configured UI or the
middleware-to-handler private hop. Cross-review found three actual gaps: its
standalone fixture supplied a fabricated 64-character scope and governed
receipt; the new native SQL-pair REST routes were absent from private-header
dispatch; and config discovery received identity scope without its trusted
HUMAN token. Those were real implementation defects, not accepted boundaries.

The original SQL editor and modal now consume an explicit
`nativeBindingConfigured: false` with no scope, key or governed receipt, using
the original native dry-run/data-preview/create/edit calls. Unknown/invalid
configuration still refuses. A binding introduced while preview is in flight
withholds that old standalone result. The real standalone create/edit checks
also remove browser WebCrypto rather than accidentally accepting the bound
helper's prerequisites. Bound dry-run evidence and current identity checks
remain unchanged.

The original middleware now delivers verified current HUMAN token and scope
only to the exact SQL-pair index/positive-integer ID routes and current config
consumer. It still removes incoming forged headers. The existing real-JWKS
checks exercise those actual routes, independent mode and lookalikes; the
actual config handler consumes the resulting private-hop headers before its
fresh public-authority discovery. Only the public authorization transport is
mocked in that composition, not the middleware identity or config consumer.

The first corrective three-suite run exited 1: the native-HUMAN and middleware
suites passed **397 items**, while the modal suite failed to compile with
`TS2367` because an old `!== false` condition remained after the newly explicit
false-path return. The obsolete condition was removed; the original failed log
`sql-pair-native-hop-jest.log` is retained. That partial result is not acceptance
of the later corrected bytes.

The same final source review found one additional actual transition window:
the original metadata helper selected standalone before awaiting its real
`beforeSubmit` consumer, but did not re-read that configuration before dispatch.
It now re-reads the same trusted scope facts immediately after that consumer;
anything other than still-explicit standalone refuses before a native write.
This does not add a state, switch, ledger or a permission authority. It prevents
a newly bound SQL-pair dry-run from being followed by a write through the old
standalone branch without its existing UNKNOWN guard.

Actual corrective verification before that last helper line and its one new
consumer check:

- Original native-HUMAN, modal and middleware suites: **485 passed**, exit 0,
  `sql-pair-native-hop-final-jest.log`.
- Whole Wren TypeScript no-emit: **exit 0**,
  `sql-pair-native-hop-types.log`.
- Private production damage reintroduced the standalone scope requirement and
  removed the exact SQL-pair/config private-hop consumers. The unchanged
  original targets failed **8 items / 9 passed / 154 filtered skip**, exit 1,
  `sql-pair-native-hop-negative.log`.
- Separately removing the modal's explicit standalone branch failed both real
  create/edit checks: **2 failed / 86 filtered skip**, exit 1,
  `sql-pair-native-hop-modal-negative.log`.
- All three damaged production inputs were restored from formal source.
  Formal/candidate comparison then returned **30 inputs identical**, exit 0;
  the original formatter accepted all **25 handwritten TypeScript inputs**,
  exit 0, `sql-pair-native-hop-format-check.log`.

The restored three-suite request is still in flight as handle **29881** and
`sql-pair-native-hop-restored-jest.log`; repeated observations showed disk-I/O
wait, no terminal result and no OOM. It is not recorded as a passing rerun.
The final helper's one fresh `readScope` line and its one original consumer
check were written in the formal tree afterwards, but are **not yet run or
synced over that in-flight candidate**. Earlier 485/type/format results do not
certify those final bytes. Root froze these 32 paths for a source-only stage
integration rather than accumulate work indefinitely behind I/O. Its latest
tail verification remains outstanding and no image or service deployment is
claimed. The original PostgreSQL 9 and Python 16 passing results remain valid
for their unchanged backend bytes; neither was repeated for these UI/private-
hop corrections. Existing failed logs are retained in the directory above.

### 2026-10-08 restored SQL-pair private-hop request reached terminal

The original in-flight handle **29881** eventually returned **exit 0**:
**3 suites / 485 passed / 0 failed**, 1826.025 seconds, recorded in the same
`sql-pair-native-hop-restored-jest.log`. Read-only diagnostic handle **70510**
also returned exit 0. No duplicate suite, database, image or dependency
installation was started while these original requests waited on disk I/O.

These restored candidate bytes still predate the final helper's one fresh
`readScope` line and its one added consumer check; this result does **not**
certify that last guard or the next API History source batch. Those two
committed helper/check inputs have now been synced separately into the same
original 4-CPU/4-GiB SDK for a single selected consumer run, handle **57994**,
`sql-pair-final-fresh-helper-positive.log`, still in flight at this entry.
No terminal for that selected run, deployment or release activation is claimed.

## 2026-10-08 original API History exact-event reconciliation source increment

Implementation is written; new generation and targeted execution have not run yet.
The preceding 485 and in-flight helper check do not certify these new bytes.

1. **Authority and upstream:** DD-87, `.design/08` §6,
   SS-WRN-IDENTITY/SS-WRN-GOVERNANCE retain native Wren management and require
   current authorization and real terminal evidence. Fixed upstream
   `c5f02a0391c87420dba78632dcd86073710deb72` was reread using `git show`:
   `wren-ui/src/apollo/server/resolvers/apiHistoryResolver.ts::ApiHistoryResolver`,
   `wren-ui/src/pages/api-management/history.tsx::APIHistory`,
   `wren-ui/src/components/pages/apiManagement/DetailsDrawer.tsx::DetailsDrawer`,
   and `wren-ui/src/apollo/client/graphql/apiManagement.ts::API_HISTORY`.
   The original table, drawer, pagination, fields and JSON sanitization remain;
   the new explicit readonly check and 202 UNKNOWN labels are necessary
   authorized governance differences, not replacement pages.
2. **Impact and compatibility:** optional original `ApiHistoryFilterInput.id`
   is consumed by the existing history repository's primary-key filtering and
   the original UI lazy query. No Core contract, table, migration, native ID,
   Action, task, ledger or SQL parser was added. Old callers omit this optional
   field. The server's exact row selection retains controlled project/binding
   and consumes the original SQL-pair proof before returning a selected event,
   including completed events. Page listing does not poll pending SQL-pair
   tasks; their nested request/response fields remain null until terminal.
3. **Side effects and disclosure:** one selected original event invokes the
   existing `SqlPairService.readNativeWrite`, its timeout/bounded native GET and
   existing metadata/history CAS transaction. No native POST/DELETE, command,
   alternate execution authority or Core content copy is introduced. A true
   FINISHED is reread from the same history row before completed bodies are
   disclosed; nested completed fields do not issue another native task GET.
   `SqlPairService.observeNativeWrite`'s existing post-GET fresh identity/manage
   check was moved before status classification: pending/UNKNOWN native results
   cannot skip revocation or generation checks that previously ran only after
   FINISHED. This is the same authority and original consumer, not a wrapper
   or an added permission system; no metadata is committed on that refusal.
   Current discovery and original manage/proof checks are server-side. The UI
   rechecks the trusted config identity/generation before and after reading,
   uses no Apollo result cache for this exact read and rejects late completion
   after Close or another selected row.
4. **Boundaries:** empty IDs are original invalid-parameter refusal; missing
   rows, missing cache and unknown/failed native events do not become success,
   failure, rollback or a replacement task. Same-binding foreign actors are
   rejected by the persisted proof. Current identity is not binding-only:
   middleware hashes verified issuer/subject/audience/native access, then
   `nativePreviewScope` adds binding/instance/native scope; config also consumes
   fresh Core discovery and generation. Explicit never-configured standalone
   retains its original readonly history path; invalid/configured facts refuse.
   Concurrent observation uses the original CAS; there is no automatic loop or
   claim to recover an unprovable pre-dispatch crash. General operational
   reconciliation/time limits, complete native CRUD, SERVICE SQL, function
   provenance and dynamic trusted Resource evidence remain release gaps.

   Existing `apps/06` §4 classes are retained: current authentication/scope/read
   refusal is DENIED; inactive release is BLOCKED; absent valid delivery or
   terminal evidence is PRECONDITION; original transport byte-size rejection is
   LIMIT; changed original proof/generation is CONFLICT; a timed-out or
   otherwise unverified native write remains UNKNOWN. A denied or unavailable
   check does not rewrite that
   previously pending business outcome as a failed write. No seventh class or
   new native reason code was introduced.

New checks were appended to the existing native-HUMAN and original UI targets,
not a separate framework: same-event single GET/no redispatch, pending-list
withholding, genuine completed reread, revoked membership/foreign actor,
revocation/generation change during the actual original pending GET,
Chinese/English UNKNOWN tags, original Details callback, same-ID lazy query,
invalid config, standalone, identity switch, Close/late ACK and missing row.
They are source checks only until actual execution is recorded below. No Wren
instance, ACTIVE binding, screenshot, full restoration or deployment is claimed.

This source increment is frozen for root review as eight original source/check
paths plus the two existing README/receipt paths. GraphQL regeneration, types,
the new targets and production damage/restoration are **not run**, and the old
helper's handle 57994 remains separate. No new image, database, dependency
installation, broad suite or replacement SDK was started behind the in-flight
checks. The root's existing source commit `dfc7a33835174bbaa9e43e0e335c2f12959edfeb`
remains the submitted boundary; this new increment is unsubmitted/unreleased.

### Original standalone-to-binding helper selected run: terminal evidence

The existing handle **57994** returned **exit 0**: **1 passed / 88 filtered
skip**, one original `viewMetadata.test.ts` suite, 1359.508 seconds,
`sql-pair-final-fresh-helper-positive.log` in the same original SDK directory.
`memory.events` before and after reported zero for low/high/max/oom/oom_kill/
oom_group_kill. This is the committed `dfc7a33835174bbaa9e43e0e335c2f12959edfeb`
helper guard and its selected consumer, not the frozen new History source or
the relocated SQL-pair post-GET authorization. No negative damage/restoration
or new History generation/check was run as part of this selected positive.

### Same-page cache/list disclosure correction after implementation review

Root review identified the real shared `ApolloClient` singleton cache: the
selected observation was fenced, but the original `cache-and-network` list and
direct `openDrawer(record)` still admitted old cached/late bodies. The original
history page now consumes the same native GraphQL query for both list and
selection through `no-cache` lazy reads, never through the hook's retained data.
Each actual response is fenced by before/after trusted identity/generation and
the current page/request generation. Only a selected opaque history ID crosses
from Table to the fresh detail read; the old record body is never copied into
Drawer. Current identity must still match the actual displayed page identity
before selection. Scope or request failure clears the private page/drawer view,
without changing the recorded business outcome or dispatching another write.

The existing original Table, pagination/filter controls and Drawer are retained.
Focus/visibility clears the private display and re-reads the current page;
same-identity selection is restored only via fresh exact-ID authorization/body
consumers. A new identity does not inherit the previous actor's selection.
Close, hidden visibility, pagination change and unmount invalidate old responses.
Explicit standalone is a verified config case, not a missing-scope fallback.
No global auth cache, permission source, native task, platform Action or ledger
was added. This extends the same authorized governance difference in the
original page, not another page or layout.

Original UI consumer checks now also cover the actual effect/list path,
no-cache options, actor/generation changes during a list GET, a stale Table
callback after actor change, same-identity focus/visibility restoration,
new-identity selection isolation, hidden/unmount late list responses and
standalone's absent governed scope. They reuse the existing SSR/effect/state
consumer strategy in `viewMetadata.test.ts`; they are **not run** and are not
browser screenshots or visual acceptance. The same ten paths are re-frozen;
the old helper candidate and its 57994 positive evidence remain untouched.
UI SDK 11961 is still completing its own private damage/restoration sequence,
so original Wren GraphQL generation has not started and no new environment or
parallel toolchain request was created.

### Original API History final generated and targeted evidence

This section records the final terminal results for this same History batch.
Earlier entries above are historical source/in-flight snapshots, not current
claims that generation or the final selected consumers remain unexecuted.
The original 57994 helper result remains separate; none of the newer checks
is substituted for that older candidate or its preserved log.

The final request-correlation correction is an authorized governance seam in
the original page, not another authorization authority. Its four-step impact
is:

1. **Authority:** the same DD-87 / SS-WRN-IDENTITY / SS-WRN-GOVERNANCE and fixed
   upstream `c5f02a0391c87420dba78632dcd86073710deb72` apply. Original
   `API_HISTORY`, `ApiHistoryResolver`, `APIHistory` and `DetailsDrawer` still
   provide the list, original table/pagination/filter controls, selected JSON
   and drawer. The user-selected bounded observation and Chinese/English 202
   warning are explicitly authorized governance differences.
2. **Actual request and compatibility:** original `ApiHistoryFilterInput` now
   includes optional `id`, `queryScope` and `generation`, consumed by the
   existing GraphQL document and generated input type. The original page sends
   the trusted config's expected scope/generation on both page and selected-ID
   reads. Configured `ApiHistoryResolver.getApiHistory` compares them against
   `nativePreviewScope(config, ctx.nativeIdentityScope)` and the fresh Core
   `discover` result **before count, list or selected-event reads**. They are
   correlation facts, not database filter columns or permission tickets. A
   missing/different expected value refuses with the existing
   `QUERY_REFERENCE_CHANGED`. Optional fields preserve never-configured
   standalone compatibility only; bound native clients must upgrade schema
   and consumers together. No data migration, Core contract, table, ledger,
   task or new permission authority was added.
3. **Disclosure and side effects:** before/after config checks cannot by
   themselves exclude actor/generation A→B→A around the middle request. The
   server now associates that actual request with its trusted identity/fresh
   generation, while existing current permission, source and persisted native
   proof checks still authorize disclosure. The UI uses original no-cache
   lazy reads and only selected opaque IDs, and refuses old/late responses,
   partial-error results and a refused intermediate request. Nothing submits
   native SQL, replacement POST/DELETE or a new command during observation.
4. **Boundaries:** actual original GraphQL checks cover missing scope,
   missing generation, changed actor and changed generation, for both page
   and selected reads, with no repository reads or native observation on
   refusal. Standalone sends no fabricated scope/generation. Original
   completed SQL, summary and chart History consumers are upgraded to the
   same request shape; source refusal and native JSON sanitization remain.
   Unknown/cache-lost/failed native events remain 202 with no redispatch.
   A native GET also fresh-rechecks original manage/identity/generation before
   classifying UNKNOWN, not only after FINISHED. These are original DENIED,
   PRECONDITION, CONFLICT and UNKNOWN behavior, not a new outcome enum.

All following logs are under the existing
`/volumes/data/kailo/check-cache/wren-history-readback.ofKxdZ/`. The only SDK is
the existing `kailo-wren-query-sdk-itgs2n`, 4 CPU / 4 GiB, with original `/work`
Node modules, Jest configuration, TypeScript configuration and formatter. No
image, dependency download, database or replacement SDK was created. Before
execution host memory was available and the SDK had no active toolchain;
`memory.events` before and after reported zero for all six counters.

Preserved earlier attempts and their actual boundaries:

- `history-consumers-positive.log`: suite-load failures, no executed tests;
  the real UI `QueryResult.error` field and candidate import layout were then
  corrected. `history-consumers-positive-corrected.log` passed UI 18, but
  backend loading still failed on duplicate private class identities.
- `history-native-positive-canonical-input.log` retained that private-layout
  failure. No diagnostic was disabled and no production type was weakened.
  The original `/work` single-root layout was reused instead. Its old inputs
  and original configs remain in `old-work-before-history.tar`, SHA-256
  `7ce6475a6f708d4565143ce767bd7c25b02c22a3b107dc07716cd54d813ca2a0`.
- `history-original-root-positive.log`: 36 passed / 7 failed / 387 filtered.
  Those seven fixture failures lacked the original PostgreSQL row timestamps
  or counted the preparation create's native GET as a later observation.
  The fixture now supplies actual row timestamp fields and clears only that
  preparation call count; no production refusal/assertion was weakened.
  `history-original-root-native-fixture-corrected.log` then passed 25.
- `history-ui-identity-mutation.log`: removing the private real UI identity
  fence caused 4 failures (14 passed), including old body/late list disclosure
  and stale Table selection. Original bytes were restored. Removing the
  real post-GET native authorization guard caused 2 failures in
  `history-original-root-post-get-mutation.log`; it too was restored.
- `history-original-root-restored.log`: 43 passed / 387 filtered, with original
  tsc and eight-source format checks exit 0. This result predates the final
  request-correlation change and does **not** certify its new bytes.

Final original generation and actual selected checks:

- `history-aba-codegen.log`, exit 0: existing
  `node -r ts-node/register` loads the original `codegen.yaml`, original
  `@graphql-codegen/cli` `loadCodegenConfig/generate` and printed actual local
  `schema.typeDefs`. No hand-written generated types or alternative generator
  were used. Original `__types__.ts` adds the three optional input fields;
  `apiManagement.generated.ts` remains byte-identical. The original formatter
  was applied to source/check inputs, not to generated types.
- The original focused command was:

  ```sh
  node /work/node_modules/jest/bin/jest.js --runInBand \
    --runTestsByPath src/nativeHumanQuery.test.ts src/viewMetadata.test.ts \
    --testNamePattern 'original SQL-pair durable native write consumer|original API History detail bounded native observation consumers|consumes the original API History GraphQL document|rejects a foreign API History project filter|discloses summary through the original API History GraphQL document|consumes original chart History GraphQL'
  ```

  `history-aba-positive.log`: exit 0, **2 suites / 61 passed / 380 filtered**,
  10.222 seconds. This executes real original GraphQL list/selected and
  SQL/summary/chart History consumers, plus original Table/Drawer/effect
  callbacks. It is not a screenshot or browser installation result.
- Private production damage removed only the real resolver's five-line
  expected scope/generation refusal. The same original native-HUMAN target,
  `--testNamePattern 'the original API History request refuses'`, exited 1:
  **8 failed / 324 filtered**, `history-aba-server-fence-mutation.log`.
  Without the guard, missing/ABA page requests returned data or selected
  requests reached repository reads before later proof refusal. This proves
  the checks detect the actual production seam, not just a mock assertion.
  The guard was restored with `apply_patch` and `cmp` before re-execution.
- `history-aba-restored.log`: exit 0, **2 suites / 61 passed / 380 filtered**,
  8.704 seconds, same original focused command after restoration.
  `history-aba-types.log`: original
  `node /work/node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false`,
  **exit 0**. `history-aba-format.log`: original Prettier check of eight
  source/check paths, **exit 0**. Final nine original source/generated/check
  inputs each `cmp` 0 with the formal tree; the unchanged generated query
  also `cmp` 0. Final SDK memory counters remained zero.

The final owned scope is eleven paths: eight original source/check files,
their original generated input types, and the existing Docker README/this
receipt. The inherited two Java candidates are excluded and unverified.
This increment is frozen for root's independent main integration; no image,
Wren business instance, ACTIVE binding, iframe, browser screenshot, Windows
or Mobile acceptance has been produced by these source checks. General
operational reconciliation/time limits, unprovable pre-dispatch crashes,
trusted SERVICE SQL, ordinary-function provenance and dynamic trusted native
Resource evidence remain release blockers; no complete restoration or
production-readiness claim is made.

## Original models REST: current captured MDL and History disclosure

Implementation increment after `9bc0b023e`, reviewed against fixed official Wren
`c5f02a0391c87420dba78632dcd86073710deb72` in read-only
`/volumes/kailo/.references/WrenAI-ui-0.32.2`:

- `wren-ui/src/pages/api/v1/models.ts::handler` returns the current project's
  captured manifest as `{hash, models, relationships, views}` and logs the
  original GET_MODELS event. This native payload and the never-configured
  independent path are retained, not replaced by a summary API.
- `wren-ui/src/apollo/server/resolvers/modelResolver.ts::ModelResolver.getMDL`
  originally delegates to `deployService.getMDLByHash`; Kailo's existing
  captured-deployment/Resource reader is reused, not another metadata authority.
- `wren-ui/src/apollo/server/resolvers/apiHistoryResolver.ts::ApiHistoryResolver.getApiHistory`
  and `getApiHistoryNestedResolver` remain the original table/field consumers.
  Their existing bound request fence and original list/pagination are retained.

Four-step implementation conclusions:

1. **Authority:** `.design/08` §6, SS-WRN-IDENTITY and SS-WRN-GOVERNANCE require
   current user/project and actual Resource permissions, not just instance
   entitlement. Native MDL metadata disclosure uses existing Resource `read`
   via `data_query.describe@v1`; it does not manufacture a query AE or use
   describe as a project-management write permission.
2. **Impact and compatibility:** exact `/api/v1/models` private-header delivery,
   original handler, existing MDL reader and GET_MODELS History fields are the
   real callers. The bound handler supplies its actual trusted request scope
   and fresh binding generation to the same reader; these optional internal
   TypeScript arguments do not change the GraphQL schema. Both are rechecked
   with fresh discover, current project and controlled delivery before/after
   every captured-resource round trip. Other original hash-only callers keep
   their existing signature. Provenance uses the original native history JSON
   and binding column; no schema/table/Core body copy or migration is added.
   Old bound GET_MODELS records lacking this evidence refuse their bodies.
3. **Disclosure and side effects:** the handler reuses the same MDL reader
   after the asynchronous original history write too, and compares the same
   manifest digest before returning its original payload. That second read
   consumes specific model/view Resource permission, not only discover.
   History rereads the same native event and captured deployment, verifies its
   initiating identity/generation/digest and current source rights, and returns
   no opaque internal provenance in the original request field. No SQL,
   replacement query, new command/task, second permission or history authority
   is created. The existing repository header allowlist remains responsible
   for excluding forwarded credentials from native history.
4. **Boundaries:** missing private identity rejects before project/deployment
   access; bad/empty configured delivery never falls back. Changed source,
   scope, generation, project, delivery or deployment refuse disclosure, both
   during source reads and during history persistence. Missing/tampered/foreign
   History evidence refuses instead of granting old bodies. Never-configured
   standalone keeps the exact original success response and history. Unknown
   dependency/evidence returns unavailable, never a fabricated success; these
   are existing DENIED/PRECONDITION/CONFLICT/dependency errors, not a new enum.

Difference classification: original payload, native event, standalone response,
History table/fields and other original UI are **原样保留**. No shared-host
migration applies to this batch. Exact trusted-header delivery, request fences,
captured-source authorization and native History provenance consumption are
**已授权治理改造**. Trusted SERVICE SQL, dynamic trusted Resource registration,
ordinary-function provenance and complete business-instance activation remain
**缺失需恢复**; this batch does not certify full-project original parity.

Only the existing `kailo-wren-query-sdk-itgs2n` was used: 4 CPU / 4 GiB, original
single `/work` root, installed Node/Jest/TypeScript/Prettier and unchanged
configs. There was no image build, dependency download, database, SDK creation,
Core/contract edit or inherited Java candidate validation. All logs are in
`/volumes/data/kailo/check-cache/wren-history-readback.ofKxdZ/`.

The original focused positive/restored command was:

```sh
node /work/node_modules/jest/bin/jest.js --runInBand \
  --runTestsByPath src/nativeHumanQuery.test.ts src/middleware.test.ts \
  src/nativeProjectScope.test.ts \
  --testNamePattern 'original models REST current MDL consumer|native instance identity boundary|original historical manifest|legacy deployment IDs|historical native mapping|historical metadata|same resource changes|persisted manifest changes|MDL references'
```

- `models-rest-positive-first.log`, **exit 1**: original middleware and captured
  MDL targets passed 100, but the new REST fixture failed suite-load TS2345
  because its original Next `apiResolver` preview-context fields were missing.
  The fixture now supplies those actual three fields; no production refusal
  was weakened. This first result predates the post-history recheck.
- `models-rest-positive.log`, **exit 0**, **3 suites / 126 passed / 417 filtered**,
  12.067 seconds. This includes the real Node REST handler, real signed JWKS
  middleware/private-hop handler, real original History GraphQL fields, current
  captured-source readers and six history-write interleavings.
- Private production damage skipped only the handler's real post-history MDL
  reauthorization. `models-rest-history-write-mutation.log`, **exit 1**:
  **6 failed / 352 filtered**; actual scope/source/generation/project/deployment/
  delivery interleavings wrongly returned 200. The check therefore catches the
  real disclosure defect, not just a mocked guard call. Original bytes restored
  using `apply_patch`, `cmp` 0 before the next step.
- Private production damage then removed the exact models route from the real
  middleware forwarding list. `models-rest-middleware-hop-mutation.log`,
  **exit 1**, **1 failed / 89 filtered**: the actual signed middleware-to-handler
  consumer returned 401 instead of its original 200. Original bytes restored
  using `apply_patch`; all six current source/check inputs `cmp` 0.
- `models-rest-restored.log`, **exit 0**, **3 suites / 126 passed / 417 filtered**,
  8.048 seconds, same original command after both restorations.
  `models-rest-types.log`: original `node /work/node_modules/typescript/bin/tsc
  --noEmit --incremental false --pretty false`, **exit 0**.
  `models-rest-format.log`: original Prettier check of six inputs, **exit 0**.
  `models-rest-cgroup-final.log`: `cpu.max=400000 100000`, memory 4294967296,
  all six memory-event counters **0**, matching the initial no-OOM check.

This eight-path increment is source/targeted-SDK evidence for root's main
integration. No Wren business container, ACTIVE binding, iframe, browser
screenshot, Windows/Mobile acceptance or full check is established here. A
history row retained after a later disclosure refusal is still reauthorized on
read; its earlier native response is not proof the later client received it.
No complete restoration or production-ready claim is made.

## Original generate SQL REST: HUMAN task and current source consumers

Implementation follows `.design/07` §2.2/§4.6 and `.design/08` §6, not a new
permission or task model. The fixed original is
`/volumes/kailo/.references/WrenAI-ui-0.32.2` at
`c5f02a0391c87420dba78632dcd86073710deb72`, specifically
`wren-ui/src/pages/api/v1/generate_sql.ts::handler` and
`wren-ui/src/pages/api/v1/stream/generate_sql.ts::handler`.

Four-step implementation impact:

1. **Authority:** these are the original HUMAN generation surfaces. A configured
   binding must consume current trusted identity, native project/deployment,
   scope and each actual metadata Resource read. SQL generation is not database
   query execution, and this change does not invent an AE or enable SERVICE SQL.
   Existing-object registration still requires the exact trusted evidence
   consumed by `resource_provision::{verify_delivery,delivery_match}`; a newly
   returned native ID cannot fabricate that evidence or activate a Resource.
2. **Impact:** the two original handlers and their exact middleware routes now
   consume `nativeRestAsk::governedRestAsk` in SQL-generation mode. The original
   `ApiType.GENERATE_SQL`/`STREAM_GENERATE_SQL` values enter the existing
   `ApiHistoryRepository::{prepareNativeGeneration,advanceNativeGeneration}`
   row/CAS consumer; `ApiHistoryResolver::visibleHistory` consumes the same
   successful history through `readNativeAskHistory`. The original table,
   native query ID, GraphQL contract and UI remain; no migration or Core
   contract change is introduced. Old bound records lacking actual provenance
   refuse disclosure rather than synthesizing it.
3. **Side effects:** the first original task POST follows durable native event
   preparation. Reentry only observes that fixed native task. The same native
   history freezes actor identity, current scope/generation, manifest digest,
   original question/language/thread, requested dialect and permitted source
   history references. Full MDL/source permission is consumed before and after
   native processing, conversion and terminal history persistence, and again
   on History disclosure. This does not use retrieved table names as permission
   evidence, copy SQL/MDL into Core, invoke direct QueryService/summary or create
   another history/permission authority.
4. **Boundaries:** missing private identity, invalid configured delivery,
   changed intent/person/project/binding/generation/deployment/source or source
   revocation refuse rather than disclose. Lost create ACK, future native enum,
   foreign ACK and missing native cache keep the same event UNKNOWN/pending,
   without a second task POST or SSE success/message_stop. Real FINISHED
   GENERAL/MISLEADING classification retains the original 400/code/error;
   its original History error body is still not admitted by the old
   success-only reader. Never-configured mode retains the original independent
   handler without invented scope/key. These use the existing authentication,
   denied/precondition/conflict/dependency and unknown categories, not a new
   state authority. Permanently lost native cache remains unresolved rather
   than being cleared as a fabricated failure.

Difference classification: original success/error response fields, SSE events,
SQL dialect adapters, native API History and standalone handlers are
**原样保留**. Shared-host migration is not applicable. Exact verified-header
delivery, current full-source reads, fixed native task/event reentry and pending
outcomes instead of unverifiable timeout failure are **已授权治理改造**.
Dynamic trusted Resource adoption, trusted SERVICE SQL, ordinary-function
provenance, original 400 History body disclosure and complete business-instance
activation remain **缺失需恢复**. This is not a full-project parity claim.

The fixed original nonstream handler uses `sql = nativeSql || sql`; that fallback
is preserved. The later source increment records the actual native converter
output separately (empty/undefined normalizes to an empty/null native output),
then the History consumer verifies the same original fallback. It does not
claim a requested dialect was successfully converted merely because SQL was
returned. Two additional original consumer checks cover empty/undefined output
and same-key reentry without another conversion; their result is distinct from
the first positive checkpoint below.

Only the existing `kailo-wren-query-sdk-itgs2n`, 4 CPU / 4 GiB, original `/work`
single root and installed dependencies/configs are used. No image, SDK,
dependency download, database startup/migration, platform contract or inherited
Java candidate is part of this increment. Existing isolated PG was read-only
identified as `wren_query_itgs2n`, user `postgres`, with the exact
`isolated-query-fixture` project before any proposed original CAS invocation.
All logs use `/volumes/data/kailo/check-cache/wren-history-readback.ofKxdZ/`.

Initial original target, before the later native converter-output increment:

```sh
node /work/node_modules/jest/bin/jest.js --runInBand \
  --runTestsByPath src/nativeHumanQuery.test.ts src/middleware.test.ts \
  --testNamePattern 'original generate_sql HUMAN-only native consumer|native instance identity boundary|original ask SQL and SSE|original GENERAL answer|actual captured MDL read revocation|same-key changed question/user/surface'
```

`generate-sql-positive.log`: **exit 0**, **2 suites / 128 passed / 352 filtered**,
122.728 seconds. This covers real local HTTP handlers, exact signed middleware
routes, standalone/no-scope operation, lost ACK and same-event observations,
current source/history-write revocation and original dialect/non-SQL response
consumers. It does not certify the later converter-output fields or their two
additional cases.

At this checkpoint the original production-damage target `30507` is retained
in place while its independent SDK is paused for coordinated disk-I/O relief.
It only runs three local HTTP/mock-authority disclosure cases, with no real
database transaction or external write API. No result is claimed for that
in-flight damage/restoration, the additional converter cases, final types or
the two new original PostgreSQL CAS cases until their terminal logs are recorded.
No business deployment, ACTIVE binding, browser/iframe, Desktop/Mobile,
full-project check or complete restoration is certified by this checkpoint.

### Final generation consumer validation after SDK restoration

The original SDK resumed the same `30507` process; it was not restarted. Its
terminal result and the later increment are separate from the old 128:

- `generate-sql-disclosure-mutation.log`, **exit 1**, **3 failed / 381 filtered**,
  1394.791 seconds including the coordinated SDK pause and host disk-I/O wait.
  The private production branch skipped only the final `readNativeAskHistory`
  after the terminal history write. Actual scope/source/generation revocation
  interleavings incorrectly emitted SQL_GENERATION_SUCCESS and message_stop;
  all three checks caught that real disclosure fault. This was the earlier
  candidate, not evidence for the later converter-output fields. The private
  source was restored with `apply_patch` and synchronized to the final nine
  formal source/check inputs; original Prettier reported all nine unchanged.
- `generate-sql-once-converter-mutation.log`, **exit 1**, **5 failed / 381 filtered**,
  27.369 seconds, on the latest converter-output increment. Private production
  damage allowed SQL-only reentry to POST again and recorded fallback SQL as a
  converted native output. The three UNKNOWN cases caught exactly two original
  task POSTs instead of one; the empty/undefined converter cases caught the
  false native output. Both actual production branches were restored using
  `apply_patch`; all nine formal/SDK inputs then `cmp` **0**.
- `generate-sql-restored.log`, **exit 0**, **2 suites / 130 passed / 352 filtered**,
  8.754 seconds. This is the original positive command above on the final
  restored bytes, including both new converter-output cases. It verifies the
  original REST/SSE/standalone consumers, same-key observation, exact signed
  middleware delivery and current captured-source/History disclosure without
  SQL/summary/command execution by these consumers.
- `generate-sql-types.log`: original `node
  /work/node_modules/typescript/bin/tsc --noEmit --incremental false
  --pretty false`, **exit 0**, with no suppressed diagnostics or altered config.
- `generate-sql-postgres-cas.log`, **exit 0**, **2 passed / 109 filtered**, 9.606
  seconds. The existing verified `wren_query_itgs2n` database was reused through
  the SDK's existing shared native PG network, without starting a database,
  migrating or running the unrelated suite setup. Original target:

  ```sh
  node /work/node_modules/jest/bin/jest.js --runInBand \
    --runTestsByPath src/nativeQuery.test.ts \
    --testNamePattern 'uses the original .* history task for one durable create and terminal'
  ```

  `WREN_QUERY_TEST_DATABASE_URL` selected only that existing isolated fixture.
  Both GENERATE_SQL/STREAM_GENERATE_SQL actually ran, not SKIP: the same original
  native event has one durable create owner, terminal JSONB CAS rejects a stale
  overwrite, and cross-surface adoption refuses. Each original transaction was
  rolled back, including its native history/thread/response writes. This is
  repository/DB evidence, not a live Wren AI/provider or multi-client browser
  acceptance.
- `generate-sql-format.log`: original Prettier check of nine source/check inputs,
  **exit 0**. `generate-sql-cgroup-final.log`: CPU `400000 100000`, memory
  `4294967296`, all memory-event counters **0**, unchanged from the pre-run
  check. Only the existing limited SDK and installed cache were used.

These final results close this source increment's targeted SDK/isolated-DB
validation. The current README points to these actual terminal results. They
do not close the native 400 History body, dynamic trusted Resource evidence,
SERVICE SQL, ordinary-function provenance, permanently lost native cache or
actual release/instance/iframe gaps listed above. The eleven owned paths are
ready for root's main integration; this agent does not stage/commit/push, and
no deployment or complete original restoration is claimed.

## Original SQL generation confirmed 400 History consumer

This small follow-up closes the previously recorded GENERAL/MISLEADING
generation History-body gap, not every native 400 or a new query capability.
The fixed official UI source is
`c5f02a0391c87420dba78632dcd86073710deb72`:
`wren-ui/src/apollo/server/resolvers/apiHistoryResolver.ts::ApiHistoryResolver.getApiHistoryNestedResolver`
returns the original non-SQL error bodies without a success-only status filter;
`wren-ui/src/apollo/server/utils/apiUtils.ts::validateAskResult` supplies the
original NON_SQL_QUERY code/message and GENERAL explanationQueryId. Both
original SQL-generation REST surfaces consume that classifier. No source is
executed or edited under `.references`.

Implementation four-step findings:

1. Authority: `.design/08` §6 requires the complete original Wren frontend/native
   behavior with current HUMAN/project and public authorization, not a renamed
   simplified History. The original classifier is supported upstream; bound
   History disclosure needs the existing governance adaptation. HTTP 400 is
   not native FINISHED evidence and is not a platform business FAILED terminal.
2. Impact: existing `ApiHistoryResolver.visibleHistory` already sends both
   GENERATE_SQL types and both nested JSON fields to `readNativeAskHistory`.
   Its old 200-only guard was the missing consumer. The same persisted original
   task, API History request/result JSON, identity/deployment/source references,
   request scope/generation fence and existing terminal CAS remain authoritative.
   `governedRestAsk` and the reader now consume the same original classifier;
   there is no schema/type/state/table/migration change. Older bound rows with
   missing evidence refuse, while never-configured standalone code is unchanged.
3. Side effects: reading this original 400 body is read-only, cannot POST another
   native task or execute SQL/summary, and cannot mutate a terminal history.
   Both code/message and the original explanation reference must exactly match
   the genuine FINISHED GENERAL/MISLEADING result. Current Resource authorization
   and metadata are rechecked, including after the final exact-row reread;
   the private native proof is stripped from both visible JSON fields.
4. Boundaries: missing proof, unknown/FAILED status, future type, contradictory
   provider error, substituted error, different actor/project/binding/scope or
   generation refuse. Concurrent final row/status mutation or source revocation
   withholds both bodies. Existing admission DENIED and binding/evidence
   PRECONDITION/CONFLICT semantics from `apps/06` §4 remain, with no new reason
   code; a task whose result is UNKNOWN remains UNKNOWN and never becomes a
   confirmed error merely because an HTTP 400 row exists. LIMIT/backpressure
   remains the existing configured response bound. This read adds no new
   workflow/retry/lease state, cleanup owner or public write side effect.

Difference classification: original History/Table/Drawer, SQL-generation
REST/SSE and error fields are **原样保留**; shared-host migration is **无适用对象**.
Current HUMAN/source/frozen-row verification and withholding unprovable bodies
are **已授权治理改造**. The precise previously missing confirmed-400 History
consumer is restored; arbitrary provider errors, trusted SERVICE SQL, dynamic
trusted Resource adoption, ordinary-function provenance and actual business
release remain **缺失需恢复**. No UI layout/content or native execution authority
was replaced.

Only the existing `kailo-wren-query-sdk-itgs2n`, 4 CPU / 4 GiB, original `/work`
root, dependencies and original checks were used. Before the run, the SDK was
idle, host available memory was 20.9 GiB, I/O full avg10 was 22%, and root's one
existing full check was still running Rust. No new SDK, image, dependency
download, database, platform contract or inherited Java input was used.
Logs are under
`/volumes/data/kailo/check-cache/wren-history-readback.ofKxdZ/`.

```sh
node /work/node_modules/jest/bin/jest.js --runInBand \
  --runTestsByPath src/nativeHumanQuery.test.ts \
  --testNamePattern 'original generate_sql HUMAN-only native consumer'
```

- `generate-error-history-positive.log`: **exit 0**, **47 passed / 358 filtered**,
  9.612 seconds. The original 28 generation consumers and 19 new real local
  REST/GraphQL consumers cover both classification types/surfaces, full original
  visible error bodies, no private proof, no SQL/summary/command/extra Ask POST,
  current identity/scope/source/generation and concurrent final-read rejection.
- `generate-error-history-types.log`: original `node
  /work/node_modules/typescript/bin/tsc --noEmit --incremental false --pretty
  false`, **exit 0**, with unchanged configs and no suppressed diagnostics.
- `generate-error-history-mutation.log`: **exit 1**, **5 failed / 14 passed /
  386 filtered**, 8.799 seconds, under the original nested
  `original confirmed non-SQL History consumer` target. Private production
  damage removed the FINISHED check from the actual classifier consumer and
  skipped final metadata reauthorization only for 400. UNKNOWN/FAILED History,
  corrupted REST replay, and source/generation revocation checks all caught the
  real faults. Both branches were restored with `apply_patch`; both final
  formal/SDK source inputs `cmp` **0** before revalidation.
- `generate-error-history-restored.log`: **exit 0**, **47 passed / 358 filtered**,
  8.837 seconds, on those restored final bytes and the same positive command.
- `generate-error-history-format.log`: original Prettier check of the two
  source/check files, **exit 0**. `generate-error-history-cgroup-final.log`:
  CPU `400000 100000`, memory `4294967296`, all memory-event counters **0**.

These are original targeted SDK/local-consumer checks, not live provider,
PostgreSQL, browser screenshot, iframe, Desktop/Mobile or multi-user acceptance.
No database path changed, so no new DB check was run. Root owns the one global
check and this four-file batch's review/main commit/push; this agent does not
stage/commit/push. The production Wren instance and ACTIVE binding remain
unestablished; no deployment or complete original restoration is claimed.

## Original independent model, view and MDL readers

Fixed official baseline: `c5f02a0391c87420dba78632dcd86073710deb72`,
`wren-ui/src/apollo/server/resolvers/modelResolver.ts::ModelResolver.listModels`,
`ModelResolver.getModel`, `ModelResolver.listViews`, `ModelResolver.getView` and
`ModelResolver.getMDL`. Those original native readers return the complete model
fields/relationships, views and MDL without a platform delivery file. Kailo's
unconditional `metadataConfig` loader had broken that independent native mode.
This batch restores those consumers, not dynamic Resource adoption or every
original frontend difference. No `.references` content was edited or executed.

Implementation four-step findings:

1. Authority: `.design/08` §6 retains Wren's complete independent native system
   and requires trustworthy HUMAN/project/public authorization when bound.
   `.design/07` §2 / DD-98 requires trustworthy native references, not inferred
   ownership or a second registry. Only absent configuration and absent native
   identity fields select independent mode; empty/bad configured delivery does
   not. This is a real original consumer restoration, not a new capability.
2. Impact: the existing `metadataConfig/readableMetadata` consumers preserve
   native repository calls, full list/detail bodies and current-project checks.
   Model detail/relation and view detail reuse that same helper. Independent MDL
   reads the existing current-project deployment/manifest without requiring
   platform `nativeObjectRefs` absent from original deployments. The authorized
   current-project constraint stays; the old global hash reader is not restored.
   Bound GET_MODELS History still requires its real bound proof. No contract,
   generated type, table, state, migration or client presentation changes;
   shared-host migration is **无适用对象**. Old independent rows stay readable;
   old bound rows without trustworthy provenance remain refused.
3. Side effects: these readers create no model/view, SQL/Ask execution, History
   or second authority. Defined-empty configuration, empty/partial native
   headers or a correlated platform MDL request cannot borrow independent mode.
   If binding appears during original column/view loading, the same existing
   helper withholds the in-flight independent response. Wren bodies stay Wren
   business data; no Core plaintext or ownership claim is added.
4. Boundaries: original empty-list behavior and no unfiltered dependency reads
   remain; current Resource denials, unavailable authorization, foreign project,
   missing identity, malformed sources and generation/deployment changes keep
   existing rejection. The existing `apps/06` §4 DENIED/BLOCKED/PRECONDITION and
   reference CONFLICT behavior/reasons are retained. No UNKNOWN becomes a
   success/failure. This read adds no retry/task/lease, response limit,
   reconciliation state or changed DB writer, so those mechanisms and their
   existing bounds are unchanged; no database check was rerun.

Difference classification: original frontend/layout and original model/view/MDL
body fields are **原样保留**; existing project/Resource authority, explicit
independent-mode selection and mid-read binding fences are **已授权治理改造**.
The independent consumer regression is restored in source/local checks.
Dynamic trusted native-object adoption remains **缺失需恢复**:
`core/crates/platform-core/src/resource_provision.rs::verify_delivery` and
`delivery_match` consume exact operator-delivered
`typeKey/nativeType/nativeRef/evidenceRef/evidenceDigest` facts from the existing
adapter directory. At the same fixed official pin,
`wren-ui/src/apollo/server/repositories/modelRepository.ts::ModelRepository` and
`wren-ui/src/apollo/server/repositories/viewRepository.ts::ViewRepository` have
native ID/project fields but no complete platform adoption receipt. Existing
`query_revision` cannot prove scope/owner/type;
`resolve_native_scope(LOOKUP)` is not bare native-ID discovery. This batch does
not invent those operations, manufacture trusted directory facts from CRUD IDs,
write Core delivery or activate the release.

Only the existing `kailo-wren-query-sdk-itgs2n`, original single `/work` root and
installed dependencies were used, limited to CPU `400000 100000` and memory
`4294967296`. It was idle before the concentrated run; host available memory
was 24.0 GiB and I/O full avg10 42.33%. Root's one full check remained separately
owned. No SDK/image/download/database/global check or inherited Java input was
started/changed. Logs:
`/volumes/data/kailo/check-cache/wren-history-readback.ofKxdZ/`.

```sh
node /work/node_modules/jest/bin/jest.js --runInBand \
  --runTestsByPath src/nativeProjectScope.test.ts src/nativeHumanQuery.test.ts \
  --testNamePattern 'native bound-project business consumers|original models REST current MDL consumer|original native project scope permission consumers'
```

- `standalone-model-positive.log`: **exit 0**, **169 passed / 345 filtered**,
  10.186 seconds, including the first fourteen new actual original GraphQL
  consumers. This predates the final two empty-header cases/predicates and is
  not their final-byte evidence.
- `standalone-model-types.log`: original `node
  /work/node_modules/typescript/bin/tsc --noEmit --incremental false --pretty
  false`, **exit 0**, covering final predicates and all sixteen new original
  GraphQL cases, with no altered config or suppressed diagnostics.
- `standalone-model-mutation-native-original.log`: **exit 1**, **5 failed /
  11 passed / 95 filtered**, 8.246 seconds. Removing the real private production
  independent-mode selection broke all five actual model/view/MDL GraphQL
  readers. The original nested `original never-configured model metadata
  consumers` target caught it. The source was restored with `apply_patch`,
  then `cmp` **0** before the second independent production-damage run.
- `standalone-model-mutation-transition.log`: **exit 1**, **3 failed /
  13 passed / 95 filtered**, 8.334 seconds. Removing only the private production
  `readableMetadata` mid-read fence leaked listModels/model/listViews after a
  binding appeared during native reads; all three actual GraphQL cases failed.
  Formal production files were never damaged.
- `standalone-model-restored.log`: **exit 0**, **171 passed / 345 filtered**,
  10.286 seconds, using the full positive command above on final restored bytes.
  Both formal/SDK source/check files `cmp` **0** before that run. Original bound
  native/project, captured-MDL REST/History and public permission consumers
  passed alongside all sixteen independent GraphQL cases.
- `standalone-model-format.log`: original Prettier check of both source/check
  files, **exit 0**. `standalone-model-cgroup-final.log`: resource limits remained
  as above, and all memory-event counters were **0**, unchanged from pre-run.

This four-file increment is ready for root's main review/commit/push. These are
actual local original GraphQL/REST consumers with repository/permission fixtures,
not PostgreSQL/provider/browser/screenshot/iframe/Desktop/Mobile/multi-user
evidence. No production Wren instance, ACTIVE binding or dynamic registration
is established. Ordinary-function provenance, trusted SERVICE SQL and complete
original parity remain unaccepted. This agent does not stage/commit/push/deploy.

## Original Show original SQL: current HUMAN and source disclosure

Fixed official baseline: `c5f02a0391c87420dba78632dcd86073710deb72`,
`wren-ui/src/apollo/server/resolvers/modelResolver.ts::ModelResolver.getNativeSql`,
`wren-ui/src/hooks/useNativeSQL.tsx::useNativeSQL`,
`wren-ui/src/components/pages/home/promptThread/ViewSQLTabContent.tsx::ViewSQLTabContent`,
`wren-ui/src/apollo/server/adaptors/wrenEngineAdaptor.ts::WrenEngineAdaptor.getNativeSQL`
and `wren-ui/src/apollo/server/adaptors/ibisAdaptor.ts::IbisAdaptor.getNativeSql`.
Those original consumers use the current MDL builder, native response SQL,
Engine/Ibis conversion and original formatting; unlike the separate REST
generation consumer, this resolver has no `nativeSql || sql` fallback.
No `.references` file was changed or executed.

Implementation four-step findings:

1. Authority: `.design/08` §6 preserves native UI and requires current HUMAN/
   project/public resource authorization when bound; `.design/07` §2 / DD-98
   requires real native references, not inferred ownership. This converter reads
   metadata and reuses existing `data_query.describe@v1` Resource read; it issues
   no SQL query, execution Action, new task or SERVICE authorization.
2. Impact: original GraphQL schema/document/generated caller and SQL-tab hook
   carry `queryScope/generation`. The resolver uses
   `MDLService.makeCurrentModelMDL(project)` and same-builder captured native
   model/view refs, not later same-name lookup or last deployment that drops
   undeployed edits. It freezes manifest/refs, response ID/thread/SQL and current
   Resource facts, then rechecks after the one original conversion. Engine/Ibis
   consume already configured deadline/response bounds. The existing Engine
   error now throws rather than returning undefined; existing REST catches see
   transport errors while genuine empty-output fallback remains unchanged.
   No DB/table/migration, platform contract, four-language type, lifecycle or
   execution writer changed. Optional native GraphQL arguments preserve
   never-configured standalone compatibility only; old bound clients refuse and
   need same-version schema/caller upgrade. Both changed generated files came
   from the original generator, not handwritten types.
3. Side effects: trusted identity, project, delivery, generation and each captured
   source read are checked before/after conversion, including error exits.
   Bound provider error bodies and non-string results are withheld; existing
   refusal and localized reference toast expose no SQL/MDL/provider body.
   Never-configured mode retains original arguments/body/error behavior; empty/
   bad delivery or mixed identity cannot borrow it. The hook uses no-cache,
   selected response and before/after identity checks; the server also compares
   request identity, so client before/after alone is not claimed as ABA proof.
4. Boundaries: missing identity/read is DENIED; unavailable or malformed delivery,
   source/converter evidence keeps PRECONDITION refusal; changed reference/
   generation/snapshot is CONFLICT. Original transport bounds limit provider
   work/response memory; no quota/state/UNKNOWN authority is invented.
   Close/hide/unmount detach late responses without canceling a native task.
   Focus/visibility restores an enabled view only through a fresh same-identity
   conversion; changed identity cannot reopen the old selection. No automatic
   SQL retry/second query or unknown-to-success path was added. Already blocked
   SERVICE/function/dynamic-adoption capabilities stay blocked, without new
   menus/actions/tools.

Difference classification: original SQL-tab layout/toggle/format/data-source
information, current native model/response and Engine/Ibis path are **原样保留**;
shared-host migration is **无适用对象**. Request association, same-source/current
read checks, no-cache/detach/identity restore, configured transport bounds, real
Engine error propagation and bound redacted zh/en toast are individual
**已授权治理改造**. No replacement page/parser/credential/execution authority/
resource registry/Core business-body copy was introduced. Dynamic trusted
Resource adoption, ordinary-function provenance, trusted SERVICE SQL and actual
release remain **缺失需恢复**; this batch is not full original parity.

Only existing `kailo-wren-query-sdk-itgs2n` and original `/work` dependency cache
were used, CPU `400000 100000`, memory `4294967296`. Before the concentrated run
at `2026-10-09T00:09:37Z`, the SDK was idle, host available memory was about
25 GiB and I/O full avg10 was 8.70%. Initial/final memory-event counters were
zero. No new SDK/image/download/database/inherited Java/global check/production
service was started or modified. Logs below are under
`/volumes/data/kailo/check-cache/wren-history-readback.ofKxdZ/`.

Original generation used installed `@graphql-codegen/cli` `loadCodegenConfig`
with original `codegen.yaml`, actual `print(typeDefs)` and `generate(..., true)`
through existing `ts-node/register` (CommonJS, transpile-only), not a second
generator. `native-sql-codegen.log` is **exit 0**, all stages succeeded.
Changed outputs are `home.generated.ts` and `__types__.ts`; all eighteen generated
files match private generated inputs, and the other sixteen have no formal diff.
Only the generated home's missing EOF newline was normalized mechanically to
the patch tool's newline; no generated type was manually edited.

```sh
node /work/node_modules/jest/bin/jest.js --runInBand --runTestsByPath \
  src/nativeProjectScope.test.ts src/viewMetadata.test.ts \
  src/apollo/server/services/tests/queryService.test.ts
node /work/node_modules/typescript/bin/tsc \
  --noEmit --incremental false --pretty false
```

- `native-sql-positive.log`: **exit 1**, two suites passed **143** checks; backend
  did not execute because a fixture read permission on unknown input (TS2339).
  It now returns known discover and asserts each actual permission request;
  no production diagnostic was suppressed.
- `native-sql-backend-positive.log`: **exit 1**, **136 passed / 1 failed / 137**.
  The scope fixture mutated outer context while Apollo copied the real resolver
  context. An intermediate converter assertion then became a caught provider
  error: `native-sql-backend-final-cases.log` (**26 passed / 111 filtered**, exit 0)
  and first `native-sql-mutation-backend.log` (**11 failed / 15 passed /
  111 filtered**, exit 1) are retained but not accepted as scope-case or full
  three-suite proof. Final fixture captures/mutates real GraphQL context and
  verifies its distinct digest; production fence stays unchanged. A malformed
  shell quote exited 2 before Docker/tests and is not counted as a test run.
- `native-sql-mutation-backend-real-context.log`: **exit 1**, **12 failed /
  14 passed / 111 filtered**, 8.584 seconds. Removing request scope/generation
  comparison and final Resource reauthorization in private production bytes
  was caught, including the corrected real-context scope consumer and source/
  generation/error-exit consumers. Resolver restored with apply_patch and cmp 0
  before the next target; formal production was never damaged.
- `native-sql-mutation-ui-transport.log`: **exit 1**, **8 failed / 14 passed /
  121 filtered**, 9.135 seconds. Private shared-cache reads and detached-response
  acceptance broke no-cache/Close/hide/unmount consumers. Removing real Engine/
  Ibis converter timeout/response options broke four local HTTP deadline/size
  cases. Requests used original converter paths, not SQL queries/blind retries.
  Three private production files restored with apply_patch; all twelve formal/
  private source/generated/check inputs cmp 0 before final checking.
- `native-sql-restored.log`: **exit 0**, **3 suites passed / 280 passed / 280 total**,
  13.513 seconds, full unfiltered command above on restored final bytes:
  137 native-project/GraphQL, 127 original UI and 16 real HTTP adapter checks.
  Includes POSTGRES/DUCKDB/MSSQL conversion, captured model/view reads, identity/
  project/delivery/MDL/response/source changes, errors/malformed results, real
  standalone, late detach, same-identity focus restore and original zh/en toast.
- `native-sql-types.log`: original TypeScript command above, **exit 0**,
  unchanged compiler config and no suppressed diagnostics.
- `native-sql-final-format-write.log` / `native-sql-format.log`: original Prettier
  on ten handwritten inputs, **exit 0**; final check reports all matched files
  use original style. Generated files were not globally reformatted.
  Batch `git diff --check` is **exit 0**.
- `native-sql-cgroup-final.log`: at `2026-10-09T00:21:59Z`, same CPU/memory bounds,
  and low/high/max/oom/oom_kill/oom_group_kill all **0**.

These are actual original Apollo/React consumers with repository/authorization
fixtures and real local HTTP transport, not live business-provider, PostgreSQL,
browser/screenshot/iframe/Desktop/Mobile/multi-user evidence. Production delivery/
projection/native registration still require runtime acceptance. No production
Wren instance or ACTIVE binding is established; full restoration/production
readiness is not claimed. Fourteen paths are frozen for root main review/commit/
push; this agent does not stage/commit/push/deploy. Root owns full-check/release.

## Original project boundary: explicit independent mode and one trusted identity

Fixed official baseline: `c5f02a0391c87420dba78632dcd86073710deb72`,
`wren-ui/src/apollo/server/resolvers.ts::resolvers.Query.settings`,
`resolvers.Mutation.updateCurrentProject` and
`wren-ui/src/apollo/server/resolvers/projectResolver.ts::ProjectResolver.getSettings`
/ `ProjectResolver.updateCurrentProject`. Those original complete consumers and
registered project/model/view/dashboard native operations remain. The affected
Kailo adapter is the existing
`data-query/wren-ui/src/apollo/server/resolvers.ts::nativeProjectResolver`;
it is not claimed as an upstream function. No reference file was changed/run.

Implementation four-step findings:

1. Authority: `.design/05` §2.7 and `.design/08` §6 / SS-WRN-IDENTITY require
   actual current HUMAN/project/public authorization, not instance entitlement
   alone. Original native metadata management is not automatically a new platform
   query Action. The wrapper already uses the existing binding's public discover/
   manage permissions and fixed native project; this fixes its real selection
   and asynchronous request consumers, not the permission authority.
2. Impact: all already-registered native project discover/manage wrappers use
   the same existing function. Previously undefined delivery alone bypassed them,
   even with trusted native identity fields. Standalone now requires delivery,
   identity scope and HUMAN token all undefined; empty/mixed fields do not count
   as absence. Bound calls retain initial trusted identity/token, original Core
   authorization, fixed project and generation. After asynchronous project read,
   current controlled delivery and identity must still match before native
   dispatch; final authorization consumes the same token and rejects changed
   identity before returning. Original per-Resource disclosure and SQL admission
   consumers remain separate. No API/schema/generated type/database migration,
   state/permission/registry/lifecycle or frontend change is introduced.
3. Side effects: missing delivery cannot borrow standalone current-project writes
   through an already authenticated native request. Native headers are still
   produced by original middleware from a verified JWT after removing browser
   internal headers; this wrapper does not fabricate or duplicate identity.
   Its digest is request association, not authorization. Core still verifies
   the same HUMAN token and scope each time. No token/body is added to persistent
   native history, error metadata, Core or a second store. Native methods run
   once; configured pre-dispatch refusal is existing NOT_STARTED, not UNKNOWN.
4. Boundaries: genuine independent settings/project editing preserve full native
   responses and original repository writes without fabricated scope. Empty/bad
   delivery is PRECONDITION; missing identity/current project is DENIED; switched
   delivery/identity is CONFLICT before dispatch. After native entry the existing
   nativeWriteUnknown consumer retains UNKNOWN and original scope/generation,
   never claims rollback or retries. Original authorization outages, revocation,
   generation changes and Resource body denials remain closed. No new lease,
   queue, quota/backpressure limit, reconciliation state or external SQL task
   requires a new termination mechanism.

Difference classification: original registered native operations, response/body/
layout and genuine independent mode are **原样保留**; shared migration is **无适用对象**.
Strict standalone selection, same trusted request/delivery before native entry
and same-identity final response are precise **已授权治理改造**. No new UI or product
name branch/Action/permission authority is added. Full release and live multi-user
acceptance remain **缺失需恢复**, including existing dynamic native Resource evidence,
ordinary-function provenance and trusted SERVICE SQL gaps.

Only the existing `kailo-wren-query-sdk-itgs2n` original `/work` / dependencies
were used. UI's Node window finished before this one started. Actual preflight
`2026-10-09T00:32:15Z`: SDK idle, uid 1000, CPU `400000 100000`, memory
`4294967296`, all memory events 0; host memory available about 24 GiB, CPU some
avg10 0.87%, I/O full avg10 5.03%, no concurrent Cargo/Go/Node build found.
No SDK/image/download/new database/global check or production service was started.
Logs below: `/volumes/data/kailo/check-cache/wren-history-readback.ofKxdZ/`.

```sh
node /work/node_modules/jest/bin/jest.js --runInBand \
  --runTestsByPath src/nativeProjectScope.test.ts
node /work/node_modules/jest/bin/jest.js --runInBand \
  --runTestsByPath src/nativeHumanQuery.test.ts \
  --testNamePattern 'original native project scope permission consumers'
node /work/node_modules/typescript/bin/tsc \
  --noEmit --incremental false --pretty false
```

- `project-boundary-positive.log`: all 175 assertions passed, but importing the
  original resolver registration also initialized common's recommendation
  timers; Jest did not exit and logged unavailable observations. Only the exact
  owned SDK Jest process was terminated (exit 143); this is not a passing
  terminal check. The existing nativeHumanQuery fixture's common isolation was
  reused, without forceExit, changing product code or adding a test framework.
- `project-boundary-positive-isolated.log`: **exit 0**, **175 passed / 175 total**,
  10.24 seconds, complete original project file including 38 new real exported
  settings/project-mutation consumers and existing original source readers.
- `project-boundary-existing-scope.log`: **exit 1**, **1 failed / 33 passed /
  371 filtered**, 8.901 seconds. The old standalone fixture removed only delivery
  but retained verified native headers, precisely relying on the bypass being
  closed. Its only two changed lines now remove both trusted fields for genuine
  independent mode; denied/UNKNOWN/resource assertions were not weakened.
- `project-boundary-existing-scope-final.log`: **exit 0**, **34 passed /
  371 filtered**, 7.037 seconds, same original scope target. This is not a pass
  of the other 371 checks, nor production membership/permission evidence.
- `project-boundary-types.log`: original tsc command above, **exit 0**,
  unchanged configuration and no suppressed diagnostics.
- `project-boundary-mutation.log`: **exit 1**, **22 failed / 16 passed /
  137 filtered**, 6.783 seconds, original nested project-boundary target.
  Private production damage restored env-only standalone selection, removed
  the pre-dispatch delivery/identity fence and final identity comparison.
  Actual exported consumers caught twelve missing-delivery bypasses, six
  project-load switches and four late disclosure/write-UNKNOWN faults.
  Formal production bytes were never damaged. Private resolver restored via
  apply_patch and cmp 0 before the full restoration run.
- `project-boundary-restored.log`: **exit 0**, **175 passed / 175 total**,
  10.29 seconds, full original project command on restored final bytes.
  All three formal/private source/check inputs cmp 0; no delayed native replay.
- `project-boundary-format.log`: original Prettier check on three inputs,
  **exit 0**. Final batch diff-check **exit 0**.
- `project-boundary-cgroup-final.log`: `2026-10-09T00:35:58Z`, same CPU/memory
  bounds and low/high/max/oom/oom_kill/oom_group_kill all **0**.

These are real exported native resolver consumers with original repository/
authorization fixtures, not business provider, PostgreSQL, browser/screenshots,
iframe, Desktop/Mobile or three-user acceptance. No production Wren instance,
ACTIVE binding or full original parity is established. Five paths are frozen
for root review/main commit/push; this agent does not operate the Git index or
deploy. The inherited unverified Java2 are unchanged and excluded. Root owns
the full-check/release gate.
