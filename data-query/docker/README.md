## Service

- `wren-engine`: the engine service. check out example here: [wren-engine
  /example](https://github.com/Canner/wren-engine/tree/main/example)
- `wren-ai-service`: the AI service.
- `qdrant`: the vector store ai service is using.
- `wren-ui`: the UI service.
- `bootstrap`: put required files to volume for engine service.

## Volume

Engine bootstrap retains the original `data` volume. The native UI database
uses `native-ui-data`; Qdrant uses `native-qdrant-data`. Neither is mounted
in Core or another capability service. This split is for a new independent
deployment; do not apply it to an existing installation as an implicit data
migration. Preserve its database, index and original encryption keys first.

Path structure as following:

- `/mdl`
  - `*.json` (will put `sample.json` during bootstrap)
- `accounts`
- `config.properties`

## Network

- Check out [Network drivers overview](https://docs.docker.com/engine/network/drivers/) to learn more about `bridge` network driver.

The original native stack has its own Compose project and `wren` network,
not Core's default application network. Qdrant is only on the internal
`wren-ai-service-data` network; the AI service is its sole native client.
Only the explicitly selected query-governance overlay connects the native UI
and its credential agent to an existing private platform protocol network.

## How to start with OpenAI

1. From the apps root, copy the sole `deploy/local/.env.example` to
   `deploy/local/.env` if that deployment file does not already exist. Fill its
   `WREN_*` section; do not create a second `component.env` or overwrite an
   existing deployment file. The native `.env.example` is only a pointer.
   Set an independent `WREN_COMPOSE_PROJECT_NAME` and actual source-built
   `WREN_UI_IMAGE`, `WREN_AI_IMAGE`, `WREN_ENGINE_IMAGE` and
   `WREN_GATEWAY_IMAGE` digest references. The fixed Ibis/bootstrap/Qdrant
   dependencies preserve the original GenBI recipe, not an original UI/AI
   replacement. Bound queries additionally consume the forked Engine's
   `/v2/analysis/sql/sources`; the upstream Engine image in the deployment
   template does not prove that producer exists. Keep the release inactive
   until its actual source-built Engine digest and compatible native version
   have been verified and delivered. Registered build entries
   already exist as `tools/build-upstream.sh data-query-ui` and
   `tools/build-upstream.sh data-query-ai-service`, plus
   `tools/build-upstream.sh data-query-engine`; run them only in the normal
   resource-checked release batch with the real registry supplied. The Engine
   entry uses its original Maven wrapper/modules/exec-jar and native analysis
   checks; an unbuilt `none` artifact is not a deployable digest.
   The actual nonzero TestNG HTTP checks, production fault/restoration results
   and source-built artifact evidence are in the
   [Engine receipt](../fork/verify/native-integration.md#original-engine-rendered-source-closure-and-source-build-entry).
   They do not certify ordinary-function/provider provenance, trusted SERVICE
   SQL, dynamic native Resource adoption or a deployed/active business binding.
2. Deliver native OIDC/cookie keys and model provider credentials in the two
   separate component-only files. No platform `.env` is mounted or sourced.
   `WREN_UI_SECRET_ENV_FILE` is a third component-only file: it supplies the
   original `PG_URL` when `WREN_DB_TYPE=pg`, and may be empty for SQLite.
   Database passwords do not belong in the sole non-secret deployment file.
   Deliver the original native database encryption password/salt as owner-only
   files under `WREN_NATIVE_DATA_KEY_DIR`; no values belong in this repository.
3. Copy `data-query/docker/config.example.yaml` to the private
   `WREN_PROJECT_DIR/config.yaml` and
   configure actual native model/embedding providers. This is a native service
   configuration, not proof of a platform ModelRoute or billing integration.
   Set `WREN_PROJECT_DIR` and `WREN_LOCAL_STORAGE` to existing absolute native
   directories. Bind mounts reject implicit creation of missing config/data
   paths; retain the original native files and independent data volumes.
4. Validate without printing resolved secrets:
   `docker compose --env-file deploy/local/.env -f data-query/docker/docker-compose.yaml config --quiet`.
5. After release-level checks, use the existing entry:
   `docker compose --env-file deploy/local/.env -f data-query/docker/docker-compose.yaml up -d --no-build`.
   Stop with the same files and `down`, never `down -v` for retained data.

The UI image's original startup now loads the two DATA_KEY files before its
original Knex migration and Next standalone server. Missing, empty, symlinked or
group/world-readable key files abort startup without logging their contents.
The public upstream encryption defaults are not used by this release entry.
The original `knexfile.js` continues to select this component's PostgreSQL
(`DB_TYPE=pg`, component-only `PG_URL`) or SQLite (`SQLITE_FILE`) database.
The sole deployment inputs are `WREN_DB_TYPE` and `WREN_SQLITE_FILE`; Compose
projects them to the original native names. These are native deployment
settings, never Core database credentials. Compose forwards them
and `WREN_UI_BIND_ADDRESS`/`WREN_UI_PORT`; the entrypoint does not overwrite
the configured database, address or port. Keep the Gateway upstream and AI
service endpoint consistent with that port. A nonzero migration exit never
starts Next. A key change does not re-encrypt old native data: keep
the same keys with database backups and perform any rotation through native
re-encryption, not by replacing a deployment file.

Engine startup waits for the one-shot original bootstrap to finish successfully.
The existing Native Gateway remains the only published browser port. The UI,
AI Service, Ibis, Engine and database/index storage are not exposed as host ports.

The original AI provider `src/providers/engine/wren.py::WrenUI.execute_sql`
and startup `src/force_deploy.py::force_deploy` now authenticate the existing
GraphQL callback using the issuer's standard client-credentials grant. This is
a component-specific native service account, not a HUMAN/platform session or a
Core ServicePrincipal privilege. Its issued JWT must have the same dedicated
UI audience and signed instance entitlement checked by the existing JOSE
middleware. GraphQL is not exempted. No default account/grant is provisioned.

Deliver `WREN_AI_IDENTITY_DIR/identity.json` with exactly `uiEndpoint`,
`publicOrigin`, `tokenEndpoint`, `clientId` and `secretFile`. The private
endpoint uses the configured `WREN_UI_PORT`; the public origin matches the actual browser
registration. The token endpoint comes from that issuer's real registration,
not a user request. The file referenced by `secretFile` is an owner-only
component-client credential in the same mounted directory. Neither the UI
encryption keys nor browser OIDC/cookie keys are mounted in the AI service.
Every callback re-reads this delivery and obtains a fresh token, so rotations
and issuer denial are not hidden by a local cache. Both HTTP calls reject
redirects; missing delivery/token failure refuses the callback without exposing
credentials or issuing an unauthenticated query.

`force_deploy` does not automatically retry the GraphQL mutation after a lost
response: failure remains visible and does not prove the native mutation was
not applied. This is a per-invocation guarantee, not cross-restart deduplication.
The original AI entrypoint invokes this optional startup mutation when
`SHOULD_FORCE_DEPLOY` is set from `WREN_SHOULD_FORCE_DEPLOY`; a later service restart or an explicit invocation
can invoke it again. Inspect native deployment state before such recovery;
no native task ID or platform workflow is fabricated for this startup operation.
The supplied environment template leaves this optional switch empty. Native UI
deployment remains available; ordinary service restarts do not force deployment.

The original UI/AI/Engine pipeline remains native. This source slice neither
invokes a model nor claims a live datasource, OIDC registration, image build or
real question-to-SQL acceptance. Those deployment facts remain prerequisites.

### Optional

- Select `WREN_PUBLIC_PORT` in `deploy/local/.env`; no public port is selected
  by default. `WREN_PUBLIC_ORIGIN` derives from `PUBLIC_HOST` and that port,
  while `WREN_PUBLIC_BIND_ADDR` derives from `PUBLIC_BIND_ADDR`.
- Wren is not included in the platform Compose. Its absent inputs do not
  prevent Core startup; required inputs fail closed only on explicit Wren
  Compose invocation. Do not use a disabled profile to bypass missing native
  credentials: Compose interpolates required variables before profile selection.

## How to start with custom LLM

To start with a custom LLM, the process is similar to starting with OpenAI. The main difference is that you need to modify the `config.yaml` file
that we created on the previous step. After verifying the configuration and any native deployment response, use the same original entry from the apps root:
`docker compose --env-file deploy/local/.env -f data-query/docker/docker-compose.yaml up -d --no-build wren-ai-service`.

For detailed information on how to modify the configuration for different LLM providers and models, please refer to the [AI Service Configuration](../wren-ai-service/docs/configuration.md).
This guide provides comprehensive instructions on setting up various LLM providers, embedders, and other components of the AI service.

## Native browser authentication

The source-built Wren UI is reached through `wren-native-gateway`, not a
public UI backend port. The original AgentGateway OIDC policy owns login,
authorization-code/PKCE callback and its encrypted HttpOnly session cookie.
The original Next middleware independently verifies the resulting signed
component token and instance entitlement before forwarding to native handlers.
No platform session, administrative token or default native administrator is
shared with this service.

Deployment inputs (no credential values belong in source):

- `WREN_GATEWAY_IMAGE`: the verified source-built AgentGateway image digest.
- `WREN_GATEWAY_HTTP_PORT` and `WREN_GATEWAY_ADMIN_PORT`: explicit native
  Gateway ports; admin remains bound only to loopback. `WREN_PUBLIC_PORT` is the
  public port input. `WREN_UI_PORT` configures the UI listener and
  both the Gateway upstream and AI callback endpoint; `EXPOSE` is metadata,
  not an instruction to override the configured port.
- `OIDC_ISSUER`, `WREN_OIDC_CLIENT_ID`: the same public identity issuer,
  with the native service's dedicated registration, not the platform browser
  client. Compose projects the sole issuer to the existing native Gateway
  `WREN_OIDC_ISSUER` consumer.
- `WREN_PUBLIC_ORIGIN`: Compose derives the native Gateway's existing
  `WREN_OIDC_REDIRECT_URI` by appending `/oauth/callback`; register that exact
  URI at the issuer. Do not independently configure another callback/issuer.
- `WREN_OIDC_SECRET_ENV_FILE`: a component-specific, controlled delivery file
  containing `WREN_OIDC_CLIENT_SECRET` and a separate `OIDC_COOKIE_SECRET`
  (the original Gateway's 32-byte AES key, hex-encoded); never point it at the
  platform `.env` or reuse its cookie key. Missing or malformed keys fail startup.
  Do not print rendered Compose configuration containing that secret.
- `WREN_NATIVE_IDENTITY_JSON`: the existing native verifier configuration;
  issuer and audience must match the above native registration, `publicOrigin`
  must equal the external native origin, and the dedicated signed access claim
  must identify this explicitly authorized native instance. Missing grants
  remain denied; configuring a client does not assign users an instance grant.

Open the native origin normally (or `/auth/login?returnTo=/`). No JavaScript
Bearer injection is needed. All routes, including callback, share one native
listener policy. After login, the Gateway forwards only its verified native ID
token over the private hop. Browser-provided Authorization, Cookie and platform
identity headers are removed before that hop. The native backend removes the
credential before the original application handler/API-history boundary.
Same-origin `POST /auth/logout` clears the native Gateway session; it does not
claim to terminate the IdP session, platform session or a native running task.

Use TLS at the public native origin. This isolated static Gateway configuration
is mounted read-only and its administrative listener is loopback-only. It is
not the Core-managed MCP/ModelRoute Gateway and does not receive Core dynamic
projections, so those projections cannot erase this browser login policy.
No other Wren backend gains a public host port through this change.

`NATIVE_PAGE` uses this same native origin and login chain, never a platform
token in its URL. Browser/IdP frame policy and third-party-cookie restrictions
still apply; if they block embedded login, open the independent native address.
Do not relax CSP, cookie security or instance admission to make an iframe work.

## Governed query credential delivery

`query-governance.yaml` is an optional overlay on the same native Compose file.
It does not create an ApplicationBinding or register tools. The existing native
UI reads `WREN_PLATFORM_QUERY_CONFIG_FILE`; absent or invalid delivery fails
closed. Do not deploy the overlay as a substitute for the normal approved
release/binding lifecycle or for a genuinely read-only native data-source role.

The overlay uses the original OpenBao Agent, not a second secret reader. Supply
the fixed source-built OpenBao image, exact binding namespace/AppRole, a fresh
wrapped SecretID and its RoleID in the controlled bootstrap directory. The
wrapping creation path must be the selected AppRole's original `secret-id` path.
The native UI does not mount this directory. Auto-auth tokens remain in Agent
memory: the supplied configuration has neither a token sink nor a network
listener. The lifecycle continuation below uses an owner-only Unix socket.

Each of the three Agent templates reads an explicit KV v2 path and version:
ActionToken public JWKS, independent Gateway public JWKS, and the binding's
service client credential. The original KV `value` field renders into
`action-jwks.json`, `gateway-jwks.json`, and `service-secret` with mode `0400`.
Choose the delivery UID/GID so that this component's native UI can read those
files without world-readable permissions; do not share the directory between
unrelated bindings. Secret values never appear in Compose environment variables
or the non-secret query configuration. Agent rendering errors are not success.

The controlled delivery directory also contains `query.json`, the exact
`NativeQueryDelivery` consumed by
`wren-ui/src/apollo/server/services/nativeQueryAdmission.ts::loadQueryDelivery`.
Its three file references must name the rendered `/run/kailo-query/` files.
Other entries pin the actual binding/Tenant/Workspace, native project and
connection fingerprint, dedicated issuers/audiences/caller, exact Core PEP/token
endpoints and explicit transport limits. No request may choose these values.
The source directory is mounted read-only into the UI; the Agent alone receives
the rendering mount. Use the existing private platform protocol network for
Core/Gateway traffic; no additional public query listener or host port is added.

Public JWKS files must contain public keys only. The Gateway service identity,
short-lived ActionToken and service-client credential have separate consumers;
the platform browser's token is not forwarded. Result disclosure still asks
the original Core PEP after query completion. A changed native project account
is refused rather than silently followed under the old binding.

This delivery implementation does not prove that a production database role is
read-only, nor does it manufacture SecretStore request receipts for lifecycle
validation. Actual native scope/role evidence and the normal binding validation
consumer remain required before activation. The original SQL editor previews
described below consume the governed query chain. Other native browser or
AI-service operations are not automatically governed platform commands merely
because this overlay is present.

### Model and saved-view metadata access

The original model/view lists and detail pages keep their existing layout and
GraphQL data shape. Their server-side readers now resolve each native object
through the same Core HUMAN resource-selection endpoint, using the registered
`data_query.describe@v1` action and its `read` permission. Instance login alone
does not grant these object reads; `data_query.query@v1` execution permission is
not substituted for read permission. The approved release/action catalog must
actually contain that describe mapping, and the exact model/view must already
have an active Resource reference for this binding, native instance and project.

Only a valid Core `ErrorBody` with `DENIED` / `PERMISSION_DENIED` excludes
that object from the original list; authentication/scope or binding failures,
empty/malformed error bodies and unavailable SERVICE credentials remain errors;
direct detail access is refused. Model columns are loaded only for authorized
model IDs, and relationships require both endpoint models to be readable.
Reads are checked again before returning assembled model/list metadata. Missing
authentication, unavailable authorization or mismatched native reference facts
return an error rather than an apparently empty successful list. There is no
cross-user authorization cache, new page or duplicate resource directory.

Dashboard reads also retain their original complete item/chart definitions,
but disclose an item only when every model/view from the original planner's
deployment evidence is currently readable by that person. Assembled item,
deployment and source facts are checked again, followed by fresh source read
checks. An authoritative source denial filters the item; unavailable identity,
binding or authorization remains an error rather than a false empty dashboard.
This read does not execute SQL, allocate API History or submit a command.
It does not grant native project management or pin/write permission: those
remain the separate native identity/management release boundary.

The `humanAction` configuration contains only the existing result-exposure policy
id/version used by actual queries; do not configure a global Resource id/version
to bypass per-object lookup. These metadata reads do not execute SQL or create
an ActionExecution. Unregistered objects remain unavailable: this change does
not complete the separate REMOTE_ADAPTER native-object registration path.

### Original SQL editor preview and full-source admission

The original Adjust SQL, Fix SQL and Question/SQL Pair dialogs keep their native
forms, SQL editor, preview and submit controls. Their existing `previewSql`
mutation now carries an opaque retry key and the verified current preview scope.
Query and validation use the separate existing `data_query.query@v1` and
`data_query.dry_run@v1` actions. To enable the native validation consumer, deliver
`dryRunAction.resultExposurePolicyId` and `dryRunAction.resultExposurePolicyVersion`
for the actual registered dry-run action. It has the same closed id/version
configuration shape as `humanAction`, but does not inherit the query policy:
the two actions' output schemas differ. Missing dry-run delivery refuses
validation and does not fall back to direct SQL or a query policy.

The SQL body, frozen deployment and original native model/view source IDs stay
in Wren's existing `api_history` row. Before admission that row records native
input acceptance, without an ActionExecution or execution status. The first
authenticated adapter dispatch atomically attaches the existing AE/Operation,
sets UNKNOWN and claims that same native ID. Competing deliveries and transport
loss do not issue another query. Core/Temporal receive only the ContentReference
and revision, not a copy of the SQL. A changed SQL, scope, limit, deployment or
frozen source set cannot replace an existing intent.

Actual original planner/deployment sources are sent as `sourceResources` through
the existing execute PEP and successful execution response. They are metadata,
not grants or caller-selected credentials. The same AE/binding/Workspace must
authorize every source; the primary Resource alone does not authorize another
model, view dependency or hidden subquery. Completed HUMAN previews re-read
the same native history and sources, then pass those sources to the original
idempotency-key observation so Core checks current action and read/export policy
intersection before Wren returns the result body. Missing old source evidence
is refused, never backfilled to make a previous result readable.

UNKNOWN, malformed evidence and transport failure preserve the original opaque
browser retry key and do not validate or submit an SQL edit. Only a verified
completed dry-run with its native validation body may advance the original
submit flow; an HTTP response or terminal label alone is insufficient. Focus,
visibility, identity changes and superseded requests clear/fence rendered
results without deleting another pending intent. Browser storage contains
opaque IDs only, never SQL, tokens or results.

This source increment is not complete native-business acceptance. The new Java
source endpoint still rejects FunctionCall nodes, including ordinary count/sum;
Java compilation and actual Engine HTTP validation have not passed. Full
generated-answer Asking consumption, remaining native writes, complete native
Chinese/English coverage, real datasource/LLM operation and embedded browser
acceptance remain delivery gaps. Controlled TypeScript peers do not prove those
features, a deployed Wren instance, an ACTIVE binding or original-feature parity.

The saved-view query-reference export also selects its registered Resource
from the verified current human, binding and native view ID. Its existing
form takes only the row limit; it no longer asks the user to type a platform
Resource ID. The API checks the existing `data_query.query@v1` selection before
reading the frozen reference and again before disclosing it. Missing native
identity, unavailable/unregistered resources, denied execution selection,
revocation or changed Resource/version return an error, not an exported
reference. Export itself runs no SQL and submits no ActionExecution; subsequent
query execution retains its existing admission, approval and quota checks.

The original Asking cached-task candidates, candidate view field, thread
responses and their nested view fields also consume these exact view Resource
reads. They use the current trusted HUMAN/scope and native project, not a cached
task permission or caller-supplied view body. Native rows and Resource/version
are checked again before disclosure; denied views refuse the complete answer,
and a denied candidate is not first exported through finished-task telemetry.
Original question, SQL, answer, chart, display-name and GraphQL shapes remain.

The original Asking SQL, text-answer and chart preview controls now submit
the existing HUMAN query action with the verified current scope and a durable
opaque retry key. An answer that references an authorized saved view can query
that exact view through the existing native reference, deployment and history
chain. Its SQL must still equal the original saved-view statement; a generated
query or partial CTE is not silently executed as that view. Core receives the
reference, not the SQL or result body. The first checked statement is bound to
the original reference before a command is submitted, so changing the view
under the same ID cannot substitute another SQL statement, even if it changes
back before the final read. Retrying an existing key must match that statement's
frozen native revision rather than adopting a previous query's intent.
Native rows are shown only after the
same ActionExecution is complete, its original native history is available,
and current response/view/resource facts pass fresh checks. An unrelated
answer-stream update does not change the query intent.

An accepted or pending query is not a result. The existing result controls
can check the original query; UNKNOWN, transport failure or an invalid
terminal receipt retain that user's original key rather than starting another
query. Another user or native selection cannot consume or clear that key.
The same controls consume the existing platform TaskStatus values: RUNNING
remains pending, COMPLETED requires the original verified native result, and
FAILED, CANCELED, TERMINATED and TIMED_OUT close the original intent without
showing result rows. Unknown status values, contradictory completion evidence
or an external dispatch still marked UNKNOWN cannot close the intent. A failed
observation also hides a previously returned result rather than showing stale
success. These checks do not convert a Temporal close into a native business
terminal; the producer must still provide the original reconciled component
audit evidence.
Unavailable scope or browser retry-key storage refuses submission. The
necessary preview guidance uses Chinese by default and English when selected;
this does not claim complete Wren localization or browser visual acceptance.
These source changes have not been deployed as a Wren business instance.

In a platform-bound instance the original REST `run_sql`, `generate_summary`
and `generate_vega_chart` routes consume this HUMAN admission chain. Supply the
current authenticated native session and one UUID `Idempotency-Key`; reuse that key, request and thread
when observing an uncertain request. Middleware supplies the trusted private
identity hop, not caller-provided identity headers. Empty or invalid platform
delivery is an error, never a switch to standalone SQL. Successful REST response
fields are unchanged.

Summary generation stores its fixed AI task ID and query provenance in the
original `GENERATE_SUMMARY` history before dispatch. HTTP 202 is pending, not a
generated summary; `queryReceipt` describes only the underlying SQL action and
does not prove summary completion. Re-entry observes the same AI task without
another POST. Only its exact native stream completion can persist HTTP 200 and
the original summary, and History rechecks current source access before showing
it. A missing AI cache entry, interrupted stream or missing completion remains
uncertain. The original native queue cannot replay a lost stream: the Wren
instance operator must reconcile its original task/history rather than delete
the record or blindly regenerate. Automatic cache/process-loss convergence is
not accepted, so this source batch is not production readiness for that case.

Chart generation uses the original `question`, `sql`, `threadId` and
`sampleSize` request and returns the original `id`, `vegaSpec` and `threadId`
on verified completion. Its original chart renderer and Vega enhancement are
unchanged. The admitted query's actual data is supplied to the existing native
chart service; it must not execute SQL again through its SERVICE callback.
The original `GENERATE_VEGA_CHART` history owns the caller-fixed native task
before POST. Summary and chart cannot adopt each other's task under the same
key. Re-entry observes that task without another POST or SQL execution.

HTTP 202 and `queryReceipt` prove neither chart completion nor AI usage: the
receipt is only the underlying SQL action. Only native FINISHED with the
original valid chart schema can persist HTTP 200, after current source access
is rechecked. Actual FAILED and STOPPED remain distinct native failures without
provider details. Missing cache, unavailable GET, future status, foreign ACK or
missing terminal fields never fabricate success or failure. History checks the
same source references and retains its original chart-data sanitization. A
native process/cache loss still requires operator reconciliation of the same
task/history; this change does not provide durable AI-task recovery.

This covers saved-view reads inside Asking, not complete Asking execution:
arbitrary generated SQL, AI/native task side effects, dashboard and native write
authorization are not covered by these metadata readers. See the component
verification receipt for the acceptance boundary before publishing a release.

The original modeling diagram additionally checks `data_query.describe@v1`
read permission for every captured model and saved view before loading its
fields and again before the original MDL builder returns the complete graph.
This is a complete-graph read: one inaccessible object refuses the request;
nodes, relationships and calculated-field dependencies are not silently dropped.
Genuinely empty graphs avoid unfiltered column/relation queries. The original
modeling page uses its existing error presentation on refusal or transport
failure, without retaining a previously cached graph or displaying a failed
request as an empty successful graph. No AI/engine call or SQL execution is
added by the diagram reader.

The modeling sidebar's existing schema-change review also uses the same
`data_query.describe@v1` read checks for its captured native models, before
loading columns/relationships and again before returning the original impact
calculation. Inaccessible or unregistered models refuse the complete review;
they are not silently omitted. A failed read hides the old review dialog and
shows the existing error component while retaining the native sidebar hosts.
This covers reading an already-recorded schema change, not detecting a live
data-source change, resolving one, or authorizing native model creation.

Historical `getMDL(hash)` consumes the native object IDs captured from the
same model/view rows used by the original MDL builder. The original deployment
transaction stores that mapping in its own `deploy_log.native_object_refs`,
alongside the unchanged manifest/hash. The original manifest, GraphQL response
and pages do not acquire additional fields. Historical reads resolve every
captured object through `data_query.describe@v1`, check the persisted deployment
again, then reauthorize the same Resource/version before returning its original
encoded manifest. Missing mappings, incomplete or conflicting references,
unregistered objects, denial, revocation and changed evidence refuse disclosure.

The native migration leaves old deployment records unchanged with a null
mapping: model names alone cannot prove historical native IDs. Do not backfill
from current same-name objects or mark such records successful. Reused
same-hash deployments retain their original mapping; the read path does not
silently replace it with current IDs. Rollback refuses to discard any existing
native-object evidence. This closes historical metadata read authorization,
not native deployment/write admission or production component acceptance.

## Binding lifecycle validation

The same optional `query-governance.yaml` overlay now supplies
`WREN_PLATFORM_BINDING_CONFIG_FILE=/run/kailo-query/binding.json`. This is
controlled, non-secret deployment metadata, not a browser upload or a second
binding registry. It contains `binding` (the exact frozen Core validation
document, including binding version, tenant/workspace, release, service
principal, adapter reference, native instance/project scope, isolation mode,
normalized config/digest and SecretRefs), `componentTypeKey`, `artifactDigest`,
`protocolRange`, `secretSocket`, `secretNamespace`, `connectionSecretPath`,
`connectionSecretKey`, `serviceSecretPath` and `serviceSecretKey`.
`artifactDigest` is the Core release's lowercase 64-character SHA-256 value,
without an OCI `sha256:` prefix. The two distinct secret keys select the exact
connection and binding SERVICE entries in the frozen binding's SecretRefs.
The release type/digest/range must come from the actual approved source-built
release. The namespace is exactly `tenants/<tenantId>` and the socket is the
component's `/run/kailo-query/bao.sock`; neither comes from an incoming request.

This datasource validator accepts the design's `DEDICATED_INSTANCE` binding
with one existing PostgreSQL project and its connection plus SERVICE SecretRefs. The project
must be the same project selected by the original UI's `getCurrentProject`,
not a different project reachable only through an adapter-supplied ID. Other
isolation modes are refused. Dedicated deployment ownership, its database and
credentials remain controlled deployment facts; matching a project alone does
not prove infrastructure isolation. Its pinned KV v2 value has `connectionInfo` in the original
Wren Postgres shape (`host`, `port`, `database`, `user`, `password`, `ssl`). The
value stays in process memory and must equal the original project's decrypted
connection. It does not create or alter that project or database account. Other
datasource validators remain unavailable; they are not silently classified as
read-only. Native account provisioning and the actual datasource are required
before activation and are not performed by this overlay.

The original Agent uses its scoped AppRole in memory through a mode-0600 Unix
socket. It has no network listener, token sink or cache stanza. Each lifecycle
validation performs a new version-pinned read, returning the actual OpenBao
request ID for each of the two secrets. The SERVICE KV value's `value` must
match the credential file actually consumed by the existing PEP transport;
it is not enough to observe some other credential in the same namespace.
After fresh Core reauthorization, the actual project/configuration and the
consumed SERVICE credential file are checked again before returning both read
receipts. Core must still verify each original audit record, role, audience,
locator/version and lifecycle time. A previously rendered template alone cannot
satisfy that fresh audit requirement. The native UI and Agent must run with the
explicitly configured delivery ownership; mounting the directory does not grant
new OpenBao policy permissions.

Lifecycle execution mappings and the native `/execute` wire retain the catalog's
versioned `data_query.query@v1`, `data_query.dry_run@v1` and
`data_query.describe@v1` keys. Original MCP tool names remain unchanged and map
to these fixed versioned keys inside the same native consumer. ActionToken
comparison keeps the version; it never strips a caller's unsupported version.

The same HTTP `/execute` consumer accepts the registered describe operation
with its original empty input. It hashes the submitted target together with
that input and requires the verified ActionToken's exact Resource, rather than
silently substituting a different token target. The MCP consumer continues to
reconstruct its existing frozen target envelope from the subsequently verified
ticket. Describe reads only the authorized model's name and column metadata:
the original deployment must carry the builder's exact native ID/name capture,
and the original current-project model row must still match it. Legacy
deployments without that evidence cannot be inferred from current model names.
SQL, connection credentials and other models' metadata are not returned. Before
disclosure, fresh Core authorization, the captured deployment and the original
native model are checked again. Replaying an existing native history keeps its
original deployment even after a newer one becomes current; it never executes
the metadata operation again under a replacement deployment.

`/observe` returns the existing Adapter Protocol v1 execution-response envelope
(`execution`), including the original history identity and terminal timestamp
when recorded. It returns metadata only. Missing history remains `UNKNOWN`,
not a not-delivered proof; uncertain engine outcomes are not replayed and do not
gain a fabricated terminal status or query-cancellation capability. Runtime
reconciliation uses this original observe consumer; no separate native
reconciliation engine or endpoint is introduced.

The overlay's non-secret paths, versions and endpoint metadata are also in
the sole `deploy/local/.env` Wren section. Use the same file for both original
Compose inputs, never a second environment authority:

```sh
docker compose --env-file deploy/local/.env \
  -f data-query/docker/docker-compose.yaml \
  -f data-query/docker/query-governance.yaml config --quiet
```

After the real release/binding/native-role prerequisites are satisfied, the
same command with `up -d --no-build` is the existing runtime entry. Blank overlay
inputs reject that explicit launch; they do not provision an AppRole, namespace,
binding, service identity, grant or datasource. Successful config parsing alone
does not establish native login, read-only query execution or governed disclosure.

`/platform-adapter/v1/handshake` and `/validate_binding` require the existing
`application_binding.create` ActionToken for this exact binding and fresh Core
PEP; browser cookies/origin requests are rejected. Validation reads PostgreSQL
roles and privileges, including assumable roles, and refuses superuser/admin,
database/schema creation or temporary objects, table/sequence writes/ownership,
and executable non-system routines. The same native privilege check runs before
a Postgres query dispatch. No grants are changed and a failed check is not a
successful binding observation. Read-only credentials remain the database's
enforcement boundary; these checks are not a new general SQL authorization
engine or evidence of a live datasource's configuration.

## Original REST Ask and streaming Ask

When query governance is explicitly configured, the original `/api/v1/ask`
and `/api/v1/stream/ask` consume the same verified HUMAN identity and scope as
`run_sql`. Supply the original `question`, optional `sampleSize`, `language`
and `threadId`, plus one caller-owned UUID `Idempotency-Key`. Retain the same
key and unchanged input while observing an uncertain request. An explicitly
configured but empty or invalid delivery never enters standalone execution.
Without any query-governance configuration, the original standalone handlers
and response shapes remain unchanged.

The native API History row freezes the original task ID, current identity,
captured deployment and original thread references before the Ask POST. The
AI service consumes this fixed native ID and refuses duplicate creation.
Observation of a lost POST acknowledgement reads that same native task; it
does not POST a replacement. The original MDL consumer rechecks all captured
model/view Resource mappings, including before exposing progress or answers.
Generated SQL then uses the existing HUMAN query Action and original engine
source analysis, bound to that same captured deployment. SQL UNKNOWN cannot
start a summary. The summary receives the authorized query data, not a second
SERVICE SQL callback. Metadata read authorization does not stand in for SQL
execution or result disclosure authorization.

The original GENERAL answer and SQL summary streaming paths retain the
original content blocks. Only the native generator's completed provider call
can emit the exact task completion receipt. EOF, timeout, cache loss, foreign
IDs and unknown statuses do not complete API History or emit a successful
`message_stop`. Once native streaming is claimed, re-entry does not blindly
consume or restart it. An uncertain or interrupted stream requires the Wren
operator to reconcile that same native task/history; durable replay of lost
native caches remains unavailable. Completed history fields reauthorize the
same metadata, frozen thread references and SQL Action before disclosure.

These native REST consumers do not prove AI billing, trusted SERVICE SQL,
ordinary-function provenance or the existence of a deployed business instance.
They do not add a task table, public permission authority, Workflow or Core SQL
body copy. Actual release/binding, datasource/provider configuration and full
page/device acceptance remain separate prerequisites.

The original UI planning stream `/api/ask_task/streaming` also consumes the
current verified HUMAN and scope. GraphQL task creation captures the original
deployment's authorized metadata reference and stores the current owner in
the existing `asking_task.detail` JSONB before the fixed-ID native POST. The
original tracker checks current authorization again before that POST and
preserves the trusted owner when polling native results. Task reads,
cancellation, response binding and follow-up/rerun task selection consume this
same original evidence; the GraphQL context supplies the actual task
repository, not an actor field with no reader.

Planning content is freshly authorized before every native message. Only the
matching native reasoning pipeline's actual provider completion becomes the
original UI `done` event. This event completes the reasoning stream, not the
whole generated query, SQL execution or AI billing. EOF, a foreign completion,
cache loss, expiry or source revocation never manufactures `done`. The stream
uses the original delivered response byte budget and existing wait limit.

Old tasks without captured owner/deployment evidence remain in native storage
but cannot acquire a new owner by guessing a task ID. No SQL schema or duplicate
task table is added. This fork's UI and AI-service task-ID/completion changes
must be released together; an old AI service cannot prove the new fixed-ID or
completion behavior. A failed fresh check before POST keeps the original
non-dispatched task for operator reconciliation instead of pretending the
native provider failed. These consumers are not evidence that all remaining
native mutation, recommendation, SQL-pair or SERVICE execution paths are ready.

The original UI client now consumes that exact `done` separately from connection
closure. A partial GENERAL answer or reasoning stream followed by EOF, timeout,
invalid JSON or an unknown frame remains incomplete; the existing loading icon
and same-ID GraphQL observation are retained, without creating another Ask or
automatically reopening the once-consumed native stream. Only real `done`
enables the original completion footer. Queued events from a closed or previous
task cannot update the current answer. Selecting another task clears the prior
body and excludes stale polling results; a late create acknowledgement cannot
replace the selected task. Closing the original prompt stops its observations,
not the native operation: it invalidates pending create/rerun acknowledgements,
clears the selected task and closes the current stream, so late polling results
cannot reattach it. The original Stop/cancel action remains separate.
Missing native stream/cache evidence still requires
same-task operator reconciliation; this client does not manufacture replay,
SQL completion or AI billing evidence.

## Governed native SQL transport

The existing query delivery's `requestTimeoutMs` and `responseMaxBytes` now
reach the original QueryService and both native Ibis/Engine query and dry-run
requests, not only source analysis and the Core PEP. No endpoint, datasource,
deployment, SQL, credentials, query limit or response shape is replaced.
The limits come from the controlled binding delivery; callers cannot override
them in tool input. Original standalone consumers without those options keep
their original transport behavior.

A timeout, incomplete response or response beyond the delivered byte budget
does not prove SQL failed or was cancelled. The original admitted API History
record remains `UNKNOWN`, with the same execution, operation, deployment and
native ID. Re-entry with that execution key observes the existing record; it
does not issue another SQL request even if the native endpoint later recovers.
This is an HTTP wait/size bound, not database cancellation or durable recovery
of a lost native result. Database cancellation remains unsupported.

The adapter's binding SERVICE client credentials authenticate its call to the
existing Core PEP. They do not admit a SERVICE SQL actor: current business
execution still requires the original HUMAN or AGENT ActionExecution and
scope/result policy. SERVICE source-read grants do not authorize SQL, and no
new Workflow or task authority is introduced. This increment is not a live
business-instance/binding or production-readiness claim.

## Original dashboard query and cache observations

The original dashboard grid, widgets, layout, menus and cache refresh controls
remain native Wren UI. Opening an existing item and using its individual or
all-item refresh now consume the same existing HUMAN SQL admission/history
path as the original query editor. Only verified completed results reach the
original chart; incomplete or unknown receipts do not become empty successful
queries or expose stale cache times. Current-user changes, focus, visibility
return and unmount invalidate in-memory result disclosure without cancelling
the native operation. Returning to a visible/focused window revalidates the
current person and observes the original key again, including a settled key,
so the original chart is restored without starting another SQL execution.
Changed users or revoked permission cannot restore the previous chart body.

The browser retains only that person's opaque query key and original refresh
choice. UNKNOWN and lost responses reuse the same key; an explicit refresh
after a verified terminal gets a new key. Original cache-enabled/refresh choices
remain fixed during automatic window-return observations; observing a settled
key does not recreate its retired browser storage entry. Original cache choices
and hit/creation/overwrite metadata are preserved through the native SQL
history and its frozen opaque reference. Changing those choices or the native
item while observing does not authorize another query or disclosure. Neither
SQL nor result bodies are persisted in browser query-key storage or copied to
Core. Invalid configured delivery never falls back to standalone SQL.

The original pin-to-dashboard mutation remains native metadata management;
query permission and a completed SQL execution do not prove current native
project write authority, pin-write idempotency or recovery after a lost INSERT
acknowledgement. This increment does not introduce a platform pin Action,
browser permission authority, shadow ledger or a replacement management page.
SS-WRN-IDENTITY/native management authorization and the existing release
activation boundary remain open delivery requirements. No live Wren instance,
ACTIVE binding, iframe or Desktop/Mobile visual acceptance is established here.

## Native project permissions and management response disclosure

The original GraphQL pages, menus, settings and native management operations
remain Wren's own implementation. A configured binding now checks its existing
tenant/workspace `discover` permission before and after original metadata
queries, and `manage` before and after original project/model/view/dashboard,
instruction and SQL-pair management mutations. The scope is selected by the
authenticated binding, not a project or tenant ID supplied by the browser.
These fresh checks consume the original platform identity and SpiceDB authority;
they neither create a query ActionExecution nor install a local Wren ACL.

Current HUMAN identity, active tenant membership and workspace state are checked
along with the existing binding/release/generation/runtime projection fences.
A previously joined, now inactive workspace member cannot use a residual
workspace-admin tuple without current tenant management permission. Native
Resource bodies retain their separate current read checks: management permission
does not grant access to every model, saved view or returned dashboard item.
Malformed delivery, missing identity or unavailable authorization never switches
a configured service into independent standalone mode.

Pinning retains the original button, INSERT and complete response. In binding
mode its former unadmitted SQL cache warm is not executed; actual item viewing
and refresh continue through the existing governed HUMAN preview/cache path.
Current source read permission is checked before pin and before its full response
is disclosed. Item and layout updates also check their actual project/item
ownership and source bodies before writing and before returning the original
full result. This is not a new platform pin Action or proof of INSERT
idempotency, billing or recovery after an unknown write acknowledgement.

Release activation remains blocked by concrete remaining native lifecycle and
business gaps: reset/data-source replacement must reconcile the original new
project ID with the fixed binding scope; the separate REST SQL-pair validation
consumer remains outside the governed GraphQL dry-run path; newly created models/views need genuine
Resource registration before their bodies can be disclosed. Trusted SERVICE SQL,
ordinary-function/provider provenance and live multi-user component acceptance
are not established by these permission checks. No Wren business instance,
ACTIVE binding or embedded-page visual acceptance is claimed by this increment.

## Native creation with an unknown acknowledgement

The original model drawer, save-as-view modal and chart pin confirmation keep
their original layout and native mutations. In a configured binding, entering a
native write does not prove its transaction failed when a later scope check or
body read refuses. Those responses now carry UNKNOWN in the original GraphQL
error's `other` field, with only the actual returned native row reference when
one exists. The original formatter does not return the nested error, SQL,
credentials or response body. Only an explicit refusal before entering native
CRUD carries NOT_STARTED; an arbitrary GraphQL error is not that proof.

These three original create consumers no longer let Apollo's `onError` resolve
an unsuccessful mutation and close their original control. Their localised
warning keeps an uncertain write out of the success/failed presentation. On
re-entry with the same input they only read the recorded original model, view
or dashboard item through its existing current-user-authorised query. An absent,
denied or unreadable object stays UNKNOWN and does not cause another mutation.
The browser checks its current trusted identity and binding generation before
dispatch and before accepting a result; changing them cannot disclose an old
object or turn its uncertain write into a new one. A secondary diagram or deploy
refresh failure does not reverse an already verified model creation.

Browser intent storage contains an input SHA-256 digest and an original native
type/ID, not SQL, input bodies, results or credentials. This uses the browser's
standard Web Crypto and session storage. A secure HTTPS context with those
facilities available is a prerequisite; an ordinary non-localhost HTTP/LAN page
without `crypto.subtle` refuses before sending a native mutation, without an
insecure hash fallback or plaintext input storage. The current HTTP environment
is not acceptance of these create controls.

This browser marker is neither native idempotency nor a server execution ledger.
A fully lost acknowledgement without a native ID remains UNKNOWN; repeating
the original submission cannot safely recover that reference. Session loss,
another browser/client and the other native update/delete/reset consumers do
not gain durable idempotency or a complete recovery path from this increment.
Those remaining lifecycle/outcome gaps still prevent release activation. This
increment does not establish a live Wren instance, ACTIVE binding, iframe,
Playwright/installed Desktop/Mobile or production multi-user acceptance.

## Original question-SQL pair dry-run consumption

The original question-SQL pair modal and its Home/Knowledge create/update
callbacks retain their original controls. With a configured Kailo binding, the
modal passes the exact SQL editor dry-run's opaque key and current scope to the
existing GraphQL mutation. The server only observes that original
`data_query.dry_run@v1` execution: its original native history fixes SQL, limit,
deployment and source references, and current HUMAN/source/result checks still
apply. Missing, changed, unknown or incomplete evidence refuses the native
metadata write; it does not submit another SQL command. Its original question
and SQL remain the native business fields; the existing service additionally
consumes the trusted current context and opaque original submission key.

The optional GraphQL input fields are emitted by the original generator. A
bound older caller without the original dry-run identity fails closed; an
actually never-configured server retains the original independent dry-run
implementation. An empty or incorrect delivery configuration does not select
that independent path. Question-only edits do not execute an undefined SQL.

An admission/dependency refusal is not labelled a syntax error. Only the
original `INVALID_SQL_ERROR` selects that original message. Entering a bound
native metadata mutation without a verified `NOT_STARTED` refusal leaves its
result UNKNOWN if the acknowledgement is lost or unreadable. The original
modal stays open and warns in Chinese/English; closing it does not cancel work.
The dry-run AE is still not native-write authorization or native terminal
evidence.

Bound SQL-pair create/update/delete now persist their original intent and event
ID in Wren's existing API History, in the same transaction as the original
native row/reference. The original project row serializes this transaction;
there is no additional table, ledger, platform Action or database migration.
Only the first prepared intent sends the original AI indexing/deletion request.
The AI endpoint consumes that fixed native event ID; repeated requests with the
same ID cannot schedule another pending/finished event, and changed input is
refused. Every Wren retry only observes the original event. Only its explicit
`finished` evidence and fresh current management permission commit the native
metadata/history outcome together. A failed, absent or unfamiliar event is
UNKNOWN, including after cache loss; it never authorizes a replacement POST.

The original GraphQL modal, REST CRUD, list, API History and Ask SQL-pair
candidate consumers use this same history. Pending creates are not presented
as active pairs; pending edits/deletes retain the previous native row. The
initiating user's original list can observe and finalize their persisted event
from a reloaded or different client without issuing another write. A retained
browser native reference permits read-back only, not a repeat INSERT. The
original REST create/update validates SQL through the same HUMAN dry-run and
then observes that frozen validation before metadata write; it no longer uses
bare native validation in configured mode. Never-configured independent mode
retains the original implementation; present but bad delivery fails closed.

The real client configuration explicitly reports `nativeBindingConfigured:
false` only for a never-configured server. In that mode the original SQL editor
and modal call native dry-run, data preview and create/edit without a fabricated
scope, governed receipt or browser write key; they do not require WebCrypto.
Missing configuration facts, a configured server without its current scope,
or a binding introduced while a native preview is in flight do not select or
complete this independent path. The original trusted middleware forwards both
current HUMAN private headers to the SQL-pair index/positive-ID REST routes and
to the config handler. It still strips caller-forged private headers and does
not forward them to lookalike or unrelated paths.

This is not complete cross-client reconciliation. If all keys/references are
lost, a later client cannot distinguish a new create intent from an old
completed create; no exactly-once guarantee is inferred. A crash before native
dispatch, cache expiry or initiating-user revocation leaves the original
history UNKNOWN without blind redispatch; release activation remains blocked.
The original API History detail now has a user-selected bounded observation
consumer for persisted SQL-pair events, described below; that is not an
automatic operational reconciliation service. Other native
CRUD, trusted SERVICE SQL, dynamic Resource evidence, ordinary-function
provenance and real multi-user acceptance remain separate gaps. WebCrypto
requires the production HTTPS secure context; HTTP LAN UI acceptance is not
established. No Wren business instance, ACTIVE binding, iframe or visual/device
acceptance is established by these source changes.

### Original API History: check the recorded SQL-pair request

The original history table and details drawer are retained. Status 202 is
labelled `结果不明` / `Unconfirmed`, not green success or a definitive failure.
For original create/update/delete SQL-pair events, the details drawer's
`核验原请求` / `Check original request` reads that same persisted history ID
once through the original GraphQL query. It neither submits the CRUD again nor
creates another task. Listing a page does not poll all pending SQL-pair events,
and pending request/response JSON is withheld.

The server reuses current binding/project discovery and the original SQL-pair
proof's initiating identity, scope, generation and event reference. Only an
explicit native FINISHED followed by the existing metadata/history transaction
can produce a fresh completed row and readable bodies. A missing native cache,
unknown/failed provider result or unprovable pre-dispatch crash stays unresolved;
the check does not infer rollback or repeat POST/DELETE. Revoked membership,
foreign identity or changed binding cannot use an old result. Closing details
detaches observation; a late response cannot reopen it. This bounded consumer's
GraphQL schema/types, original list/detail consumers and targeted positive,
production-damage/restoration and type evidence are recorded in the
[History receipt](../fork/verify/native-integration.md#original-api-history-final-generated-and-targeted-evidence).
Those are SDK source checks, not a deployed business instance or browser
acceptance.

Both this page's list and selected details now use the original lazy query with
`no-cache`, not the global Apollo cache's old bodies. Current trusted scope and
generation are sent in the original `filter.queryScope` and `filter.generation`.
Before count, page or selected-event reads, the server compares both with the
request's trusted current identity and fresh binding discovery. Config checks
before/after reading are additional UI fences; they alone cannot prove the
identity of an intervening response. The GraphQL fields remain optional only
for never-configured standalone compatibility: bound native clients must
upgrade their schema and callers together, and missing/old request facts refuse.
A table record supplies only its ID; details open only from the fresh same-ID
response. Page generation,
Close and unmount detach late responses. Focus/visibility refresh clears private
display while checking; the existing selected drawer is restored only after
fresh same-identity list and detail reads. An identity change does not restore
the prior actor's selection. This is confined to the original history page,
not a new global authentication/cache layer. The original generated query is
unchanged; only its generated filter input type expands. The linked evidence
includes the real original GraphQL and Table/Drawer consumers, revocation,
request-scope/generation mismatch and no-redispatch checks. It does not establish
complete Wren functionality, an ACTIVE binding, iframe, screenshot or device
acceptance.

### Original models REST: captured metadata and current Resource reads

`GET /api/v1/models` retains the original `{hash, models, relationships, views}`
response and native API History. With a configured binding, its exact middleware
route forwards the verified current HUMAN identity, and the handler reads the
captured deployment through the existing MDL reader and current Resource read
permission for every native model/view. Scope, binding generation, current
project, controlled delivery and captured deployment are rechecked before and
after those reads, including after the asynchronous native History write.
Revocation or a changed reference withholds the response; it does not run SQL.

The original GET_MODELS History fields consume that same deployment/provenance
and current source permissions. Old bound records without trustworthy native
provenance refuse their bodies rather than inventing it. Provenance and metadata
remain in Wren's original database, not Core; no query Action or second history
is created. Never-configured independent mode keeps the original response and
history; bad or empty configured delivery never selects that mode. The original
signed middleware-to-handler, REST, GraphQL History and deployment readers passed
126 selected checks, with actual production-damage/restoration and original
type/format checks, in the [models receipt](../fork/verify/native-integration.md#original-models-rest-current-captured-mdl-and-history-disclosure).
This does not establish deployment, an ACTIVE binding, iframe, browser visual
acceptance, trusted SERVICE SQL or dynamic native Resource registration.

### Original SQL generation REST: HUMAN task and source disclosure

The configured `POST /api/v1/generate_sql` and
`POST /api/v1/stream/generate_sql` consumers now reuse the original native Ask
task and API History. They require the verified current HUMAN identity and
fixed idempotency key, freeze the actual deployment/source-read scope and
binding generation, and disclose the original SQL/SSE success only after the
same native task finishes and current source permissions still hold. These
consumers do not execute a database query, create a summary, issue a query
Action or enable trusted SERVICE SQL. Lost ACK, missing native cache and unknown
status retain the same event and return pending rather than dispatch again.

Never-configured mode preserves the original independent handlers. Present but
empty/invalid delivery refuses. The original optional dialect conversion also
preserves its empty-output fallback to the original generated SQL; the native
history records the actual converter output separately, so a 200 response does
not by itself certify that a dialect conversion occurred. Successful History
bodies recheck the same frozen metadata and current sources. Original 400
GENERAL/MISLEADING History bodies now use that same reader when the persisted
native task is explicitly FINISHED and the body exactly matches the original
native classifier. The original error/code and GENERAL explanation query ID
remain; the internal proof is not returned. Reading them does not submit a
query, regenerate the Ask task or rewrite the terminal history. A stored 400
without that native proof, unknown status or contradictory provider error is
not sufficient. Current actor, project, binding generation and source reads
must still match, including after the final same-row reread.

The [generation receipt](../fork/verify/native-integration.md#original-generate-sql-rest-human-task-and-current-source-consumers)
distinguishes the initial 128 passing checks from the latest restored 130,
including the two actual converter-output cases. Two private production-damage
runs caught three and five failures respectively; after restoration the original
TypeScript/format checks and two real isolated PostgreSQL CAS cases passed.
The later [400 History receipt](../fork/verify/native-integration.md#original-sql-generation-confirmed-400-history-consumer)
records 47 passing original generation/History checks, five actual protection
failures under private production damage, restored passing bytes and the
original type/format checks. It does not broaden disclosure to arbitrary
provider errors or UNKNOWN tasks.
This source increment does not establish a business deployment, ACTIVE binding,
browser/iframe acceptance, full original parity, dynamic trusted native Resource
registration or ordinary-function provenance. A permanently lost native cache is
not proof of failure and cannot authorize a replacement POST.

### Original independent model, view and MDL readers

When `WREN_PLATFORM_QUERY_CONFIG_FILE` has never been configured and neither
trusted native identity header exists, the original GraphQL model/view lists,
complete model/view details and current-project MDL body remain usable without
fabricated platform identity or Resource records. The original native fields,
relationships and response shapes are retained. Present empty/invalid
configuration, even an empty native identity header, or platform-correlated MDL
input cannot select independent mode. A binding configured while the original
columns/views load withholds that in-flight independent response.

Configured consumers retain current HUMAN/project and per-Resource read
authorization, captured native source/deployment facts and generation fences;
rejection never selects independent current-project behavior.
The [independent reader receipt](../fork/verify/native-integration.md#original-independent-model-view-and-mdl-readers)
records 171 passing original consumer checks, two actual production-damage
runs catching five and three failures, exact restoration and original
type/format checks. These are local SDK consumers, not business deployment or
browser/device acceptance. Dynamic native Resource registration still lacks a
trusted existing-object evidence consumer; bare CRUD IDs or `query_revision`
cannot replace scope/owner/type evidence. Static controlled native-resource
facts remain the existing supported path. Neither an ACTIVE Wren binding nor
complete original parity is established by this increment.

### Original Show original SQL: current HUMAN and source disclosure

The original SQL-tab toggle, data-source formatting and current-model conversion
remain, including undeployed model edits. In configured mode the original
`nativeSql` GraphQL query sends current `queryScope` and binding `generation`;
the server compares them with trusted request identity and fresh discovery,
reads every model/view captured by the same native MDL builder through existing
Resource read authorization, and repeats the checks before disclosing converted
SQL. A changed project, source, response, controlled delivery or generation
withholds the body. This is read-only conversion, not SQL execution, a query
Action, a new task or trusted SERVICE SQL.

The original hook avoids shared Apollo SQL bodies and detaches late responses
after Close, hide or unmount. Returning to the window restores the enabled view
only after a fresh same-identity read. Bound refusals use the existing Chinese or
English reference-error toast without SQL, MDL or provider error bodies.
Engine/Ibis converters consume the existing delivery deadline and response-size
bounds. The original Engine error outlet now actually throws instead of silently
returning `undefined`. Never-configured independent mode retains original
arguments, conversion and error behavior; empty/bad delivery never selects it.
Optional GraphQL identity fields preserve standalone compatibility only; bound
clients must upgrade generated callers together, and missing/old fields refuse.

The [native SQL receipt](../fork/verify/native-integration.md#original-show-original-sql-current-human-and-source-disclosure)
records original generation, final **280/280** checks across all three suites,
original TypeScript/format passes, two actual private production-fault runs
catching **12** and **8** failures, and exact restored inputs. Earlier fixture/
compiler failures and correction of a false-positive scope fixture are retained.
These are SDK GraphQL/hook and real local HTTP transport consumers, not business
provider, browser, iframe, multi-user or device acceptance. Dynamic trusted
native Resource adoption, ordinary-function provenance, trusted SERVICE SQL,
a live Wren business instance and ACTIVE binding remain unestablished.

### Original project boundary: explicit independent mode and one trusted identity

Original native project reads and metadata writes select independent mode only
when delivery configuration and both trusted identity fields have never been
set. A missing delivery file with either native identity field, even an empty
field, now refuses rather than entering the original ungoverned current-project
path. Configured calls retain the existing public discover/manage authorization,
fixed native project and separate per-Resource body checks.

The original request boundary retains the verified initial identity/token.
After asynchronous project loading it rechecks controlled delivery and that
same identity before entering native code. Final authorization uses the same
token; a changed identity cannot receive a successful body. Refusal before
native writing is NOT_STARTED; refusal after entering it remains UNKNOWN with
the original scope/generation, without replay or invented rollback evidence.
No query Action, new identity/permission store, native task, table or page was
introduced. Never-configured original settings and project editing remain.

The [project-boundary receipt](../fork/verify/native-integration.md#original-project-boundary-explicit-independent-mode-and-one-trusted-identity)
records final **175/175** original project consumers, **34** selected existing
scope checks, original TypeScript/format passes, **22** actual protection
failures under private production damage and exact restoration. It preserves
the initial fixture/timer and false-standalone failures. This closes this precise
native request bypass, not all Wren release gaps: actual business deployment,
ACTIVE binding, multi-user UI/iframe acceptance, dynamic trusted native Resource
adoption, ordinary-function provenance and trusted SERVICE SQL remain unproven.

### Original saved-answer and partial-step previews

The original question SQL, text-answer and chart result controls now also consume
the generated-response path, not only responses already saved as views. The
server derives SQL from its original `thread_response.sql` or `constructCteSql`
steps; the browser does not submit replacement SQL through these mutations.
Ordinary generated SQL and partial CTEs use the existing HUMAN SQL admission,
native deployment/source analysis, same-key `api_history` input, current Resource
permissions and verified result disclosure. They do not borrow a saved-view
ticket. Exact saved-view previews retain their existing snapshot consumer.

The original three pages keep their layout and controls. Their shared preview
consumer recognizes the same response and native history receipt, retains its
key for UNKNOWN, and never renders an unverified receipt as completed rows. A
genuinely never-configured independent instance retains the fixed upstream
AskingService previews and raw response, without inventing a platform receipt or
scope. Missing/empty/mixed trusted delivery does not select that branch; a binding
appearing before SQL dispatch or before return withholds the independent result.

The [saved-answer preview receipt](../fork/verify/native-integration.md#original-saved-answer-and-partial-step-previews)
records **555/555** original consumer checks, original TypeScript/format exit 0,
**9** failures after damaging actual private production guards and **555/555**
after exact restoration. These are SDK consumer checks with native-source and
authorization fixtures, not a real database/Engine/provider, browser screenshot,
ACTIVE binding or Wren business deployment. Ordinary-function provenance,
trusted SERVICE SQL and dynamic native Resource evidence remain fail closed;
the full original product and multi-user/iframe release are still unaccepted.

### Original Save as View: consume its admitted column query

The original Home Save as View button, modal, validation, SQL, native metadata
and returned view shape remain. In configured mode, obtaining its column list
is a real `data_query.query@v1` execution: the original shared SQL-preview hook
admits `limit=1` under the current HUMAN and retains the same native history/key
through UNKNOWN. Only its completed history ID is passed to `createView`.
The native resolver checks that history's project, binding, caller scope, SQL,
action and limit, then re-observes the original AE through `readHistory` before
using its columns. It never calls the original `describeStatement` to execute
the SQL a second time. Changed response, identity, project or delivery refuses
before native INSERT; an unverified query never closes the modal as success.

Metadata-write UNKNOWN re-entry keeps its existing original-reference read-back
and does not run the query or INSERT again. A never-configured independent
instance retains the original single native describe/INSERT, without a fabricated
scope or query history. Optional `CreateViewInput.queryHistoryId` preserves that
standalone compatibility only; bound GraphQL clients must upgrade together.

The [Save as View receipt](../fork/verify/native-integration.md#original-save-as-view-consumes-the-admitted-column-query)
records original GraphQL generation, **330/330** original consumer checks,
TypeScript/format checks, **20** failures under actual private production damage,
and exact restoration followed by **330/330** and types/format exit 0. These are
SDK consumers, not browser/screenshots, actual provider execution or deployment.
This does not register a newly created native view as a Resource: without the
existing trusted native-resource evidence, final Resource read remains denied
and the original write outcome remains UNKNOWN with its returned native ID.
Dynamic Resource adoption, cross-client metadata reconciliation, ordinary-function
provenance, trusted SERVICE SQL, ACTIVE binding and full Wren release remain open.

### Deliver the selected native Engine mode

The existing runtime environment option `WREN_EXPERIMENTAL_ENGINE_RUST_VERSION`
is delivered to the original UI as `EXPERIMENTAL_ENGINE_RUST_VERSION`. Explicit
`false` now reaches the original Ibis HTTP consumer: query, dry-run, dry-plan,
validation and model substitution select v2 and its original Java Engine rewriter.
Explicit `true` selects the original v3 path; it does not certify or activate that
engine capability. A never-delivered option keeps the upstream default `true`.
Empty or unknown values refuse UI initialization instead of silently selecting
another engine. The setting is read at process initialization, so an environment
change requires restarting the UI through the existing deployment workflow.

The original configuration merge now filters only `undefined`: explicitly
delivered `false`, zero and empty strings are not replaced by upstream defaults.
This does not add validation for every other setting or change their parsers.
The [Engine-mode receipt](../fork/verify/native-integration.md#original-native-engine-mode-reaches-ibis-http-consumers)
records **37/37** original SDK consumers, types/format exit 0, two actual production
damages caught and exact restoration. Axios is mocked there; no new UI image,
live native Ibis/Engine call, datasource, ACTIVE binding or iframe acceptance is
claimed. Dynamic Resource evidence, ordinary-function provenance and trusted
SERVICE SQL still remain closed release gaps.

### Original independent Model/View previews

An instance that has never configured `WREN_PLATFORM_QUERY_CONFIG_FILE` and has
neither trusted HUMAN token nor identity scope retains the original modeling
preview: the model uses its native column/reference names and original default
limit; the view uses its original SQL and requested limit. Both use the same
selected project's native manifest and return the original columns/rows. The
original Model/View metadata controls consume these raw rows, including model
column aliases, without inventing a platform receipt or a scope/retry key.

Defined-empty or invalid delivery, partial/mixed identity, or a bound intent never
falls back to that independent branch. Configured instances still use the
existing HUMAN query AE, native history, source authorization and same-key UNKNOWN
observation. A binding or project change during independent preparation or SQL
withholds the result without executing again. Switching native selection or
refreshing visibility fences late independent rows and the previous mutation's
error. No page/control or original standalone operation was removed.

The [Model/View preview receipt](../fork/verify/native-integration.md#original-independent-model-and-view-previews)
records this source restoration and its precise validation/release boundary.
It does not establish dynamic native Resource evidence, ordinary-function
provider provenance, trusted SERVICE SQL, a live instance, ACTIVE binding or
iframe acceptance.

### Original instructions REST project read and writes

`GET /api/v1/knowledge/instructions` retains the original complete instruction
array and API History record. In configured mode its private Next hop carries
only the verified current HUMAN token and identity partition; the handler uses
the existing GraphQL `Query.instructions` project `discover` authorization,
then rechecks the same project, delivery, identity and generation after the
original asynchronous History write and before disclosing JSON. Missing or
mixed identity, empty/invalid delivery, revocation and changed generation do
not fall back to the independent instance. Bound dependency errors are sanitized.

An instance that has never configured the binding and has neither trusted
private identity header still uses the original native reader and response,
without a synthetic platform receipt. A binding arriving while the original
project or History read is pending prevents disclosure. Exact index POST and
positive-integer-ID PUT/DELETE also consume the verified private hop and the
original GraphQL mutations' current project `manage` permission. Their original
payloads, native AI deployment and 201/200/204 responses remain; partial-update
and deletion reads are constrained to the current native project. Permission,
identity, binding or generation changes after native entry return the existing
sanitized 202 UNKNOWN proof, not a definite failure or blind second write.
The original instruction resolver also performs the wrapper's captured-generation
fresh check after its final current-project read and before entering the native
service. A refusal from that trusted server closure remains `NOT_STARTED`;
upstream error extensions are not accepted as evidence that dispatch did not occur.
Standalone original writes remain available only with no binding/private inputs.

This does not provide cross-client instruction write idempotency or reconcile
an UNKNOWN metadata write, activate a release, or prove
that original instruction History bodies are available through the bound History
reader. The [implementation and actual check receipt](../fork/verify/native-integration.md#original-instructions-rest-project-read-and-writes)
records the precise validation and release boundary.

The final original SDK run completed **792/792** checks across the three original
suites, `tsc --noEmit --incremental false` and all ten source/check Prettier inputs
with exit **0**. Five private production damages were caught by actual HTTP or
original resolver assertions and restored byte-for-byte before that final run.
Earlier zero-case type failures, two old-fixture failures and a format failure
remain in the receipt; they are not reported as passes. This evidence covers
these instruction consumers, not all native metadata CRUD: other model
create/update/calculated-field/relation/deployment first-write consumers still
need the same current permission/generation check. It does not include the
separate Model/View delete candidate, live public authority/provider calls, an
installed business instance, ACTIVE binding or iframe acceptance.

### SQL-pair native first-write request fence

Configured SQL-pair REST create/update/delete now call the same original public
GraphQL mutations as the native controls. The original resolver consumes that
request wrapper's captured project, trusted HUMAN identity and binding generation
after project/SQL observation, then passes the same server closure to the existing
native service. The original same-database row/API History transaction checks it
after its final asynchronous reads, before the first row/history INSERT. The
existing native AI dispatch checks it again after preparing the durable intent.
This is an authorized identity/governance seam, not a new Action, task ledger,
permission authority, SQL execution or product page.

Refusal before any native row/history write remains the original trusted
`NOT_STARTED`. If an intent already exists, a later identity/generation refusal
remains 202 UNKNOWN under that same event: it is not cleared, resubmitted or
declared failed. Existing same-event GET observation and confirmed-finish metadata
commit remain unchanged. Missing native event evidence cannot prove that an
uncertain intent was never dispatched. Neither an in-process closure nor 202 is
proof of a native terminal outcome.

Only an instance with no binding configuration and neither private trusted
identity input follows the original standalone CRUD and dry run. Present-empty,
invalid or missing delivery with either trusted input does not use that path.
Original payloads, native AI calls, 201/200/204 responses and complete controls
remain; there is no UI/schema change in this batch.

The [actual source and check receipt](../fork/verify/native-integration.md#original-sql-pair-native-first-write-request-fence)
records **455/455** original-suite cases, TypeScript/format exit 0, and three
private production mutations caught then restored byte-for-byte. These are
fixture-backed actual original resolver/REST/repository/service consumers, not a
new live PostgreSQL rollback, public authorization/provider or installed-instance
acceptance. Dynamic Resource adoption, ordinary-function provenance, trusted
SERVICE SQL and other native metadata first-write/UNKNOWN recovery gaps still
prevent a claim of complete Wren integration or an ACTIVE release.

### Original relationship metadata first-write consumer

The original `createRelation`, `updateRelation` and `deleteRelation` GraphQL
mutations now pass the existing request-scoped `nativeProjectCheck` to their
original `ModelService` methods. It consumes captured binding/generation and
current project `manage` permission **after** the service's own native reads and
before its first repository write, not only at the resolver entrance. Native
model/related calculated-field ownership remains in Wren's existing tables.

Relationship deletion retains the original calculated-field cleanup and native
relationship delete. If cleanup has already been dispatched, a fresh refusal
before the remaining delete preserves `UNKNOWN`, not `NOT_STARTED`. No SQL,
native write or native task is automatically retried by this consumer. A missing
trusted server closure in bound mode fails closed; the entirely unconfigured
independent original flow remains available. Existing original relationship
controls, payloads, telemetry and complete native responses are unchanged.

The [source and actual consumer receipt](../fork/verify/native-integration.md#original-relationship-metadata-native-first-write-consumer)
records final **44/44**, original TypeScript/three-file formatting exit 0, and
two private production mutations caught and restored byte-for-byte. The initial
fixture TypeScript failure had **0 tests** and is retained, not counted as a pass.
These are actual original public resolver/service consumers with fixture-backed
database and authorization transports, not live database/authorization or UI
acceptance. This batch does not provide cross-client metadata idempotency or
lost-ACK reconciliation, close other Model/calculated-field/deployment writes,
activate a release, deploy an instance, or establish full Wren integration.

### Original model creation and column-selection writes

The original `createModel` and `updateModel` GraphQL consumers now recheck the
existing request's project `manage` permission and captured binding/generation
after their last native lookup, immediately before the actual repository write.
Creation retains the original model, columns and nested-column inserts. Editing
retains the original primary-key reset/set, removed/new/type-changed columns and
nested-column replacement. In particular, the existing `updateModelPrimaryKey`
helper consumes the same permission closure before **each** native reset/set;
an early resolver check does not substitute for that write boundary.

Every later write uses the same current request check. If any earlier native
write was dispatched, a subsequent refusal remains `UNKNOWN`, not
`NOT_STARTED`; neither a native write nor SQL is automatically retried. Complete
native responses still pass the existing actual model Resource-read consumer.
The entirely unconfigured independent flow and the original three-argument
primary-key helper remain compatible. Controls, source-column transforms,
payloads, responses and telemetry are unchanged; no Core Action or new native
permission/execution record is introduced.

The [actual implementation and consumer receipt](../fork/verify/native-integration.md#original-model-creation-and-column-selection-write-consumers)
records **52 Model + 44 Relation = 96/96** after byte-for-byte restoration,
original TypeScript/three-file formatting exit 0, and two production mutations
actually caught. Database and authorization transports are fixture-backed,
not live instance or browser acceptance. This does not provide generic metadata
lost-ACK/cross-client reconciliation, calculation-field SQL admission, deployment
or all other modeling mutations, dynamic Resource evidence, ordinary-function
provenance, trusted SERVICE SQL, an ACTIVE release or a deployed Wren instance.

### Original model metadata editor write consumers

The original modeling `EditMetadataModal` still calls the same
`updateModelMetadata` mutation, with its complete model, ordinary-column,
nested-column, calculated-field **description** and relationship metadata.
The five original private helpers now consume one request-local current
project/manage and captured binding/generation check immediately before each
actual native `updateOne`, including after their own asynchronous row lookup.
An earlier native update in any helper prevents a later refusal from being
relabeled `NOT_STARTED`; it remains `UNKNOWN`, with no automatic write retry.

Original blank-to-null metadata removal, unrelated properties, native write
order, telemetry, `true` response and entirely unconfigured standalone editor
are preserved. This does not call calculated-field expression validation,
query/preview or create a new Action, database table, ACL or execution record.
The [actual five-helper receipt](../fork/verify/native-integration.md#original-model-metadata-editor-native-write-consumers)
records **91 Metadata + 52 Model + 44 Relation = 187/187**, original TypeScript
and two-file formatting exit 0, with two actual private production mutations
caught and restored byte-for-byte. Transports are fixture-backed, not live
instance/authorization or browser acceptance. Calculated-field SQL admission,
other native writes and generic metadata ACK/recovery, dynamic Resource evidence,
function provenance and trusted SERVICE SQL remain release gaps; no deployment,
ACTIVE binding or full original-product acceptance is established by this batch.

### Original View metadata editor write consumer

The original modeling `EditMetadataModal` still calls `updateViewMetadata` with
the same name, description and column metadata, and receives its original
Boolean response. Its existing request-local project/manage and captured
binding/generation check is now consumed after the native view lookup and
optional asynchronous name validation, immediately before the only native
`updateOne`. An entirely unconfigured standalone editor remains unchanged;
binding or trusted identity appearing during that read cannot adopt its write.
No SQL validation/preview, new Action, ACL, table or execution record is added.

The [actual View consumer receipt](../fork/verify/native-integration.md#original-view-metadata-editor-native-write-consumer)
records **34 View + 91 Model Metadata = 125/125**, TypeScript and two-file
formatting exit 0 after byte-for-byte restoration. Privately removing the one
new production call caused **20 actual failures**. Lost native responses,
forged upstream `NOT_STARTED` and post-write permission/identity changes remain
`UNKNOWN` without a retry; this is not cross-client metadata reconciliation.
Native databases and authorization transports are fixture-backed, not browser,
live instance or public authorization acceptance. The separately running
UI/AI source-build batch is fixed to `661415e9f103bd939d2b70505e64ca188d74bde5`
and does not include this later View change. No Wren deployment, ACTIVE binding
or complete-product acceptance is established; the existing Resource evidence,
function provenance, trusted SERVICE SQL and metadata recovery gaps remain.

### Original native UI source-build lint consumers

The first complete native UI source build from
`661415e9f103bd939d2b70505e64ca188d74bde5`, through the existing
`tools/build-upstream.sh data-query-ui` and constrained `kailo-core-data`
builder, exited **1** at the original Next lint stage. No UI image was recorded,
and the serial AI build was not started. Its dependency installation used the
network; this is not an offline-build result.

The actual unused local was removed without changing query behavior. Existing
Jest module loads now explicitly retain their real/mock module ownership and
reset/isolation semantics, and the existing View edit positive fixture calls
the real public manage wrapper. Original lint/configuration, pages and feature
scope are not relaxed. The [source-build consumer receipt](../fork/verify/native-integration.md#original-native-ui-source-build-lint-consumers)
records **1001 passed / 4 skipped**, ten passing suites and one skipped suite,
original Next lint/TypeScript/thirteen-file formatting exit **0**, plus one
actual private production lint failure and exact byte restoration. These are
source-consumer results, not a successful image, live database/authorization,
browser or deployment result. The final image must be built from the later
committed clean source; the failed fixed-661 artifact cannot contain this batch.
No UI/AI artifact pin, Wren business instance, ACTIVE binding, iframe acceptance
or complete-product readiness is established here.

### Original Save as View first native INSERT

The original Home Save as View Mutation now consumes its existing request-local
project/manage permission and captured generation immediately before the sole
native `viewRepository.createOne`, after its final asynchronous project read.
It retains the same completed HUMAN query history, SQL/columns and original
native response; neither creating the view nor retrying an uncertain metadata
write dispatches another SQL query. A genuine pre-dispatch refusal remains
`NOT_STARTED`; dispatched/lost-ACK or post-write permission failures remain
`UNKNOWN`, not a forged failed or successful write.

The [first-INSERT consumer receipt](../fork/verify/native-integration.md#original-save-as-view-first-native-insert)
records **27 passed / 677 target-filtered skipped**, two original passing suites,
TypeScript and two-file formatting exit **0**, a real private production guard
removal producing **7 failures**, and exact byte restoration with the same
**27 passed**. PostgreSQL/native services and public authorization calls in
these checks are fixture-backed. This does not establish cross-client metadata
recovery, dynamic Resource adoption, a native UI/AI image, a running Wren
instance, ACTIVE binding or browser/iframe/production acceptance. The separate
query-reference export identity repair is not covered by these results.

### Query-reference export current identity and generation

The existing governed reference export control retains its page layout,
selection and original reference payload; it does not execute SQL. Its exact
`GET /api/platform-query-reference` now requires the current `/api/config`
`queryScope` and `nativeBindingGeneration` as `queryScope` and `generation`
query parameters, in addition to `viewId` and `limit`. Client and server must
upgrade together: legacy incomplete requests fail closed, not fall back to an
unscoped or independent export. Original independent Model/View SQL preview
behavior is unchanged.

The real request consumes only middleware-verified HUMAN/identity private-hop
headers, compares the expected scope with existing `nativePreviewScope`, and
uses existing fresh discover/current-generation and actual query Resource
authorization before reading and before disclosing the reference. Two browser
configuration reads alone do not prove request identity; the actual handler
now rejects an intervening A-to-B-to-A identity/generation request. The native
reference still grants no Resource permission or execution approval.

The original component also suppresses changed actor/generation and detached
view/focus/visibility/unmount results; focus or hiding clears an already
visible reference without automatically replaying the request. The
[query-reference consumer receipt](../fork/verify/native-integration.md#query-reference-export-current-identity-and-generation)
records **33 passed / 718 target-filtered skipped**, three passing original
suites, TypeScript/six-file formatting exit **0**, real private production
comparison failures (**8 failed**), exact six-input restoration and the same
**33 passed**. These are source consumers and a private fixture JWKS endpoint,
not live Core/SpiceDB, browser/iframe, native product image or deployment
acceptance. The original Wren UI/AI source build still follows the final
committed clean source, serially, through the existing constrained builder.

### Original AI bootstrap process outcome

The original AI entrypoint now waits for its actual Uvicorn child PID, preserves
that process's nonzero exit, and forwards shutdown through cleanup that waits
for the child. A rejected or unconfirmed optional `force_deploy` exits without
leaving the AI child running or repeating the mutation. This is process startup
and shutdown evidence, not a SQL, model-deployment or platform Task terminal
receipt. Keep `WREN_SHOULD_FORCE_DEPLOY` empty for ordinary starts; enabling it
still requires inspecting native deployment state before a restart.

The [bootstrap consumer receipt](../fork/verify/native-integration.md#original-ai-bootstrap-process-outcome)
records the existing Python unittest's **14/14** passing cases, including six
real Bash/process consumers, deliberate production wait/signal corruption
causing **4 failures**, and exact five-input restoration with **14/14** passing
again. External `uvicorn`, `nc` and optional Python commands in these shell
cases are fixtures; no real model, Qdrant or native business deployment is
claimed. The concurrent source build remains fixed at `f25ea048`; that fixed
image input does not contain this later entrypoint change.

The actual sole local deployment file currently delivers only the independent
Compose project name. The existing `.env.example` already supplies the pinned
bootstrap/Ibis/Qdrant dependencies and original non-secret ports, versions,
SQLite and disabled-telemetry settings. These are not identity or permission
facts. The source-built Engine must replace the original Engine dependency for
the bound source-analysis producer. Real component OIDC/cookie registration,
DATA_KEY files, native provider configuration/credentials, AI client identity
and approved query/binding/Resource evidence still require controlled delivery;
none is inferred from the project name or generated here.

### Dedicated native browser and AI client registration

The existing local `deploy/local/bootstrap.sh` now exposes
`--register-wren-native-clients` for the explicitly delivered native browser
and AI clients. This branch uses the original local IdP admin API and controlled
secret files; it does not recreate the realm, change existing registrations,
rotate keys, mint instance claims, assign users/service accounts a role, or
activate an ApplicationBinding. Do not run it as a substitute for approved
instance admission. This implementation batch did **not** execute the branch
against the live IdP.

The existing sole `.env` must deliver `WREN_OIDC_CLIENT_ID`,
`WREN_NATIVE_IDENTITY_JSON`, `WREN_PUBLIC_ORIGIN`, `WREN_UI_PORT`,
`WREN_OIDC_SECRET_ENV_FILE` and `WREN_AI_IDENTITY_DIR`. The new registration
branch requires the original native verifier fields plus a distinct
`serviceAudience`, matching the existing AI `identity.json` `clientId`.
Neither native client may be a platform client. The origin/callback, issuer,
certs/token endpoints, private UI endpoint and mounted secret filename must
match the existing Compose/Gateway/AI consumers exactly. Owner-only regular
secret files are required; symlinks, shared native secrets and mismatches fail
closed before any client creation. No secret values belong in this guide.

The browser client retains confidential authorization-code/PKCE authentication;
the separate AI client only enables its original client-credentials flow.
Only the AI audience mapper is added. Its native secret and audience are not
borrowed from the browser or Core. A lost create ACK leads to native unique-ID
readback, not a second create in that invocation. Existing incompatible client
flags, secret or own audience mapper are refused, not overwritten. IdP redirects
are refused rather than forwarding login/client secrets or the admin bearer.
Readback does **not** certify other existing entitlement mappers or instance
authorization.

The original native middleware now consumes the optional separate service
audience, requires its signed `azp` association, rejects a mixed browser/service
audience, and retains the existing signed instance-claim requirement. A client
registration alone therefore still yields a denied native request without a
real grant. Existing browser-only configuration remains compatible. This does
not grant SERVICE SQL admission or replace current HUMAN/AGENT Resource,
scope, generation, approval, quota or result-disclosure checks.

The [actual client-registration receipt](../fork/verify/native-integration.md#dedicated-native-client-registration-and-audience-consumption)
records Python **23/23**, original middleware/ViewMetadata **300/300**, actual
production audience/authorized-party/redirect failures and exact restoration;
the final original TypeScript and four-file formatting commands both exited
**0**. The root-owned Ant Design alias check also proves its actual Chinese and
English row-limit component export/render, not a new Next bundle or screenshot.

Runtime delivery has progressed since the preceding bootstrap checkpoint:
the independent native project/data/UI-env paths and independent DATA_KEY files
have been delivered through the sole local `.env`. Those non-secret/storage
steps are not client registration or integration acceptance. Dedicated client
secret/cookie/AI identity delivery, a genuinely signed instance grant and its
authorization producer, native model/provider credentials, and approved
binding/SecretRef/Resource evidence remain separate prerequisites. No native
business service, ACTIVE binding, iframe or multi-user acceptance is claimed;
the root-owned fixed-source UI/AI build is independent of this later change.

### Native SQL response and correction boundary

The original AI `WrenUI.execute_sql` consumer now requires a confirmed HTTP
200, the actual original preview result shape and a valid GraphQL error shape.
HUMAN AE receipts, UNKNOWN, authentication/dependency failures and malformed
errors are not successful SQL validation and do not enter automatic correction.
Only dry-run with the existing `INVALID_SQL_ERROR` and a string message is
correctable; ordinary SQL execution never retries through that label.
The original Engine adaptor produces that label only from native HTTP 400 plus
structured `SYNTAX_ERROR`. Ibis dry-run can execute SQL, so a generic
`DRY_RUN_ERROR` is not proof of a side-effect-free validation refusal.

The [native SQL response receipt](../fork/verify/native-integration.md#native-sql-response-and-correction-boundary)
records original QueryService **22/22**, Python **28/28**, real production
shape/status/postprocessor mutations and exact restoration, with final original
TypeScript and formatting exit **0**. These are source/consumer checks, not
SERVICE SQL admission, an instance grant, approved binding, business deployment
or an iframe/multi-user acceptance result.
