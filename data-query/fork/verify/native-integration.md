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
PostgreSQL project `NAMESPACE` with one connection SecretRef. It does not echo
unverified `DEDICATED_INSTANCE` or other isolation claims. Existing native UI
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
