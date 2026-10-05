## Service

- `wren-engine`: the engine service. check out example here: [wren-engine
  /example](https://github.com/Canner/wren-engine/tree/main/example)
- `wren-ai-service`: the AI service.
- `qdrant`: the vector store ai service is using.
- `wren-ui`: the UI service.
- `bootstrap`: put required files to volume for engine service.

## Volume

Shared data using `data` volume.

Path structure as following:

- `/mdl`
  - `*.json` (will put `sample.json` during bootstrap)
- `accounts`
- `config.properties`

## Network

- Check out [Network drivers overview](https://docs.docker.com/engine/network/drivers/) to learn more about `bridge` network driver.

## How to start with OpenAI

1. copy `.env.example` to `.env` and modify the OpenAI API key.
2. copy `config.example.yaml` to `config.yaml` for AI service configuration.
3. start all services: `docker-compose --env-file .env up -d`.
4. stop all services: `docker-compose --env-file .env down`.

### Optional

- If your port 3000 is occupied, you can modify the `HOST_PORT` in `.env`.

## How to start with custom LLM

To start with a custom LLM, the process is similar to starting with OpenAI. The main difference is that you need to modify the `config.yaml` file
that we created on the previous step. After modifying the file, you can restart the services by running `docker-compose --env-file .env up -d --force-recreate wren-ai-service`.

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
  Gateway ports; admin remains bound only to loopback. `HOST_PORT` is the
  existing public port input. The UI private port 3000 follows its original
  Dockerfile's `PORT` and `EXPOSE`, not a new platform listener.
- `WREN_OIDC_ISSUER`, `WREN_OIDC_CLIENT_ID`: the native service's dedicated
  OIDC registration, not the platform browser client.
- `WREN_OIDC_REDIRECT_URI`: the externally reachable native origin followed
  by `/oauth/callback`, registered exactly at that issuer.
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

This first datasource validator supports an existing PostgreSQL project as a
`NAMESPACE` and one connection SecretRef. It does not echo other isolation-mode
claims as proven. Its pinned KV v2 value has `connectionInfo` in the original
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
