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
