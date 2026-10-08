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
consumer remain required before activation. The native browser's original
internal queries are not automatically governed platform commands.

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
Deployment/MDL, Asking, dashboard and native write authorization are not covered
by these four metadata readers; see the component verification receipt for the
current acceptance boundary before publishing the component.

## Binding lifecycle validation

The same optional `query-governance.yaml` overlay now supplies
`WREN_PLATFORM_BINDING_CONFIG_FILE=/run/kailo-query/binding.json`. This is
controlled, non-secret deployment metadata, not a browser upload or a second
binding registry. It contains `binding` (the exact frozen Core validation
document, including binding version, tenant/workspace, release, service
principal, adapter reference, native instance/project scope, isolation mode,
normalized config/digest and SecretRefs), `componentTypeKey`, `artifactDigest`,
`protocolRange`, `secretSocket`, `secretNamespace` and `connectionSecretPath`.
The release type/digest/range must come from the actual approved source-built
release. The namespace is exactly `tenants/<tenantId>` and the socket is the
component's `/run/kailo-query/bao.sock`; neither comes from an incoming request.

This datasource validator accepts the design's `DEDICATED_INSTANCE` binding
with one existing PostgreSQL project and one connection SecretRef. The project
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
request ID; Core must still verify its original audit record, role, audience,
locator/version and lifecycle time. A previously rendered template alone cannot
satisfy that fresh audit requirement. The native UI and Agent must run with the
explicitly configured delivery ownership; mounting the directory does not grant
new OpenBao policy permissions.

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
