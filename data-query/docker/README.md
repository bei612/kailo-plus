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
   `WREN_UI_IMAGE`, `WREN_AI_IMAGE` and `WREN_GATEWAY_IMAGE` digest references.
   The fixed Engine/Ibis/bootstrap/Qdrant dependencies preserve the original
   GenBI recipe, not an original UI/AI replacement. Registered build entries
   already exist as `tools/build-upstream.sh data-query-ui` and
   `tools/build-upstream.sh data-query-ai-service`; run them only in the normal
   resource-checked release batch with the real registry supplied.
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
