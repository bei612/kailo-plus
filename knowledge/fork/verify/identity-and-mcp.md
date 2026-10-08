# Independent knowledge service: identity delivery and MCP boundary

## Follow-up: existing native model credential delivery (not deployed)

This independent change follows DD-92 and `.design/03` §8, `.design/07`
component admission, and `.design/08` §9.2. It depends on the APPLICATION model
projection batch and the separately frozen authenticated-transport correction;
it does not change the currently building knowledge/Gateway source inputs.

1. **Authority and original consumer.** The pinned native source is WeKnora
   `2be7bd40631dda1dd485306038f07a62e9ee287e`. Its
   `internal/router/routes_infra.go::RegisterModelRoutes` already guards
   `PUT /models/:id/credentials` with `AdminOrSystemAdmin`.
   `ModelCredentialsHandler::Put` uses the original
   `ModelService::GetModelByID/UpdateModelCredentials`; native encryption and
   native database ownership remain unchanged. `middleware/auth.go::Auth`
   routes Bearer through the original `ValidateToken`, not the API-key path.
   The operator helper sends only this short-lived native session, never an
   `X-API-Key`, a Core identity, or a manufactured model-creation request.
2. **Impact and actual readers/writers.** The original Core model projection
   freezes a service-audience `serviceSecretRef` for the exact existing KV
   locator/version, registered reader, native scope and per-route random nonce.
   The Core-only SecretRef remains internal for key reconciliation; its audience
   is not relaxed. `application_binding_native::Adapter::model_reader_delivery`
   reads the existing controlled AdapterDirectory, including PROTOCOL_PEER.
   Original `provision.py model-reader` registers that exact read-only AppRole
   and emits an OpenBao Agent template, without reading/copying a key or creating
   a namespace/mount/model. Agent's same response provides value, KV version and
   request ID. OpenBao's pinned `go.mod` selects openbao-template `v1.0.1`;
   its `dependency/vault_common.go::Secret.RequestID` and
   `dependency/vault_read.go::fetchSecret` preserve this actual request ID.
   The service receipt is then verified by the existing
   `AuditObserver::verify_secret_reads` request/response pair and registered role.
3. **Side effects and completion.** `provision.py model-delivery` reads controlled
   input files, validates the existing native tenant/model/name/base URL via
   native GET, and sends at most one credential PUT when the stored value is
   known to differ. It rechecks the native row and reads the original credential
   subresource using a frozen nonce. Native Go and Core use standard HMAC-SHA256
   over `application-model-key:v1`, native tenant/model and nonce. No value or
   reusable unscoped key digest is returned. `configured=true` is insufficient:
   it cannot distinguish the intended fixed KV version from another key. The
   original runtime row gains an immutable metadata-only receipt (migration
   `20261005022000`); ACTIVE requires native proof plus original service-read
   audit, not HTTP success. The old binding scope is filled only at final
   activation, so provisioning consumes the already frozen native observation
   instead of requiring that final field prematurely.
4. **Failures and recovery.** Old native handlers which ignore the new nonce
   cannot receive a credential through this helper: lack of nonce echo rejects
   before write. Unknown/mixed request fields, foreign/builtin native models,
   different nonce/key/scope/version, missing service reader or audit evidence
   reject. A lost write acknowledgement is recovered only by read-back; retries
   first read the current value and do not blindly repeat a write. A proof from
   another nonce/generation cannot activate this generation. Replaying the
   identical verified receipt is explicitly idempotent ACK recovery, not a new
   operation. Existing verified receipts survive an audit-file rotation; they
   cannot be replaced or erased. Downgrade refuses while new projection/delivery
   facts exist. The constraint is NOT VALID for historical rows; existing ACTIVE
   rows without a delivery receipt are denied by the new runtime admission
   consumer, not silently backfilled or claimed delivered.

The controlled input contains `projection` (the original generation's nonsecret
model projection) and `models` (existing native model ID and exact endpoint for
each route). It is not a second catalog. Use the original deployment operator
to read the exact binding/generation metadata and merge the resulting
`model-delivery-receipt.json` into that peer/adapter's
`modelCredentialDeliveries` in the existing controlled directory. The helper
does not write Core's business DB, mutate the directory automatically, or set a
binding ACTIVE. Registered reader audience, native response and audit metadata
are all independently checked by Core. An operator must have a legitimate
native Admin session; no login or credentials are created by this code.

Implementation-first evidence is in the existing native entrypoint suite and
native handler tests, not another verification service. The original Python
suite first exited 1 because its execution copy lacked `render_proxy.awk`;
after including that unchanged production input, 20 tests exited 0. Removing
the production HMAC comparison made the wrong-key case fail (exit 1); exact
restoration and the same 20 tests exited 0. These are loopback synthetic HTTP
requests, not a live OpenBao/model run. The original four-side `tools/gen.sh`
and `--check` exited 0; Mobile catalog outputs remained byte-identical. Core
compilation and the Rust executable round trip remain pending at this receipt
point; native Go results follow below. No
live configuration, model request, credential, activation or deployment changed.

The additional original reader-provisioning consumer case then passed with the
same suite (21 tests, exit 0): fixed KV reference, no key read by the operator
helper, actual RequestID template, and refusal to overwrite a mismatched existing
policy. Logs under `codex-knowledge-model-delivery-20261005.UXbRcn` are
`native-delivery-positive.log` (incomplete-input failure),
`native-delivery-complete-input.log`, `native-delivery-mutation.log`,
`native-delivery-restored.log`, `native-reader-delivery-final.log`, and
`gen-check-format.log`. No other agent's source, runtime or shared Rust cache
was changed by these checks.

The original executable wire consumers subsequently passed in the same bounded
SDK: TypeScript 14 tests, Dart 15 tests and the Go contracts package, combined
exit 0 (`wire-ts-dart-go.log`). They reused existing dependencies and locks;
no installation, dependency upgrade or shared Rust compilation was performed.

Migration acceptance used only the owned isolated database
`application_model_union_xl5agt`, initially 85 successful migrations through
`20261005021000`. Within rolled-back transactions, original 22000 up/down/up
exited 0; the existing dispatch SQL fixture and the exact original model
projection guard test's SQL exited 0. Removing the production frozen-nonce
comparison made that target fail with `stale challenge activated model`
(exit 3). Exact restoration, cmp 0, and the same target passed, exit 0.
The original down migration correctly refused retained delivery facts, exit 3.
Final read-back remained 85 migrations, zero failures and no new receipt column.
Logs are `migration-up-down-up.log`, `migration-model-guards.log`,
`migration-model-mutation.log`, `migration-model-restored.log` and
`migration-delivery-down-refused.log` under the same receipt directory. These
are real database constraint tests with synthetic fixture facts, not a claim
that Rust provisioning, native signed delivery or live audit acceptance passed.

Source integration must preserve product provenance: all three existing
knowledge artifacts currently declare `inputs: [knowledge/]` without an
`exclude`. The original manifest consumer excludes the manifest and verify
documents, but includes `internal/handler` and `fork/deploy`. Applying this
follow-up therefore changes all three recorded source digests under that
declared boundary, even where a Dockerfile does not consume an individual
file. No active build input or recorded digest was edited to hide that change.

The independent follow-up also corrects these declared input boundaries without
rewriting artifact/source digests. The native UI context and all COPY sources are
inside `knowledge/frontend/`, including its lockfile, Dockerfile, ignore rules,
Vite inputs and nginx/entrypoint files. Its input is now that directory alone.
The document-reader Dockerfile copies only `packages/` and `docreader/`; its
locked Python dependencies and `generate_proto.sh` read within the latter.
Its inputs therefore retain those two directories plus the actual Dockerfile
and root `.dockerignore`. The backend has a broad `COPY . .`, original Go
embeds, anydoc sources, license bundling and shipped configuration/scripts;
its broad input remains, excluding only `frontend/` which the actual root
`.dockerignore` already excludes. This avoids a backend credential fix becoming
a frontend/document-reader source change without guessing away backend inputs.
Changing the declared boundary itself changes the digest recipe: existing
records remain historical and are not asserted valid under the new recipe.
No current build was restarted and no new product build was performed here.

At the 2026-10-06 00:00 UTC handoff, a read-only transaction through the
existing `kailo-knowledge-postgres-1` returned native migration `104`, dirty
false, and one active OIDC user with an active owner membership in native tenant
`10000` (user `116a8d6b-c7cd-4abb-b6a4-1bd8589eda24`, not system admin).
There were zero undeleted native model rows, including builtin models. Thus the
existing owner is a real management prerequisite, but there is no existing
model ID to bind to a platform route. This read did not fetch credential or
password columns and is not an HTTP authorization/session-validity test.
No model was created and no credential or role was changed.

The existing native Compose environment file is
`/volumes/data/kailo/tmp/codex-knowledge-runtime-20261005.o07j5k/apps/knowledge/fork/deploy/.env`;
its existing controlled delivery directory is
`/volumes/kailo/apps/deploy/local/secrets/knowledge-native`. Only whitelisted
nonsecret origin and file-location fields were inspected. The new
`KNOWLEDGE_MODEL_DELIVERY_INPUT_FILE`, `KNOWLEDGE_MODEL_CREDENTIAL_FILE` and
`KNOWLEDGE_NATIVE_ADMIN_SESSION_FILE` keys are currently absent. No short-lived
native session token was extracted or persisted. Before live delivery, the
original Core generation's real route/reader/challenge metadata, an existing
matching native model, an Agent-rendered fixed-version credential receipt and
a valid native Admin/owner session must exist. Synthetic fixture metadata does
not satisfy those prerequisites; this batch remains undeployed.

The original native handler target subsequently exited 0 (session 35469):
`go test ./internal/handler -run '^TestModelCredentialsDelivery' -count=1`.
It used the existing `kailo-knowledge-native-check-wkkigg` SDK, Go 1.26.8,
4 CPU/8 GiB/no extra swap, an independent `/tmp/model-delivery-UXbRcn`
execution copy and the existing native module/build caches. GOPROXY was off,
GOTOOLCHAIN local and GOFLAGS `-mod=readonly`; no dependency, lock or compiler
was installed or changed. The long original link was allowed to finish without
restart. The three tests consume the real original handler, not a replacement
HTTP implementation or a live credential write.

Removing only the production tenant equality check made the existing
`TestModelCredentialsDeliveryRejectsUnknownMixedOrForeign` fail with
`foreign model produced a proof`, exit 1 (60414). The execution copy was restored
with apply_patch; host cmp exited 0, and the complete original delivery target
passed, exit 0 (85508). Both canonical and container source SHA256 are
`28af3d6a8327d57a9c8f47668520e016c8b0e56c78475c8b95df9e93be331755`.
Original log digests in the same receipt directory are:

- `native-go-handler.log`: `b633a8b0d8e89e7d301311f08aa95a708d5089a775504d3b4793d3dd5792e53f`.
- `native-go-mutation.log`: `cc167488ab08aa41e6bccc76b0e2addba228d0bbb87d47050b1e664ef95ee9d0`.
- `native-go-restored.log`: `e6e9bc9e623fed84a6d4a8db824a57129f9975e1019b1cf1d514e76eddd66d52`.

No public Rust target was used. Core provisioning/Clippy and Rust roundtrip
still require their original checks after the shared compilation window opens;
native Go success does not substitute for them or for real credential delivery.

### Authorized native model initialization: actual endpoint refusal

At 2026-10-06 00:18:10 UTC, normal OIDC login and the original `/auth/me` API
confirmed the same tenant `10000` owner. The original `/models` list had no
matching row. One authorized native `POST /models` attempted to initialize a
nonbuiltin `KnowledgeQA`/`remote` model, with native provider `generic`, no
credential and no inference request. Its name was the real ACTIVE platform
virtual route `5c57957c-e7dd-4173-b286-1722af88209a`, not an invented provider
model. The existing Gateway ConfigResource source facts were provider
`vision-27b-uat-chat-ejyuhu`, revision 1, format `completions`, and model
`vision-27b-uat-chat-qwen-ejyuhu`, revision 1, native provider model `qwen`.
The selected model base URL was the actual Core runtime configuration
`http://agentgateway:18081/v1`; the original remote create branch performs only
native repository creation, not a model pull or completion.

The API returned HTTP 400/code 1000: the original SSRF check could not resolve
`agentgateway`. A subsequent normal API list read confirmed no matching model;
native model ID remains absent. There was no blind POST retry. Original receipt
`native-model-initialize.log` SHA256 is
`400a29d4f56198ca00213ec7936a087d78c548c1c36e08175eb6c0fbdb602d24`
in the same independent receipt directory (session 26757, exit 1).

Selective live deployment read-back explains the refusal: WeKnora app is only
on `kailo-knowledge_native_ui` and `kailo-knowledge_native_data`; the Gateway
is on the platform's app/edge/its-own-data networks. The actual Gateway publishes
only 8080 as host 58090 (browser/BFF) and 8091 as host 58091 (native `/api/`
BFF), not the strict-key LLM listener on 18081. Those published user endpoints
must not be guessed to be model endpoints. No existing dedicated APPLICATION
model endpoint was found in the selected deployment fields. Core's private
hostname is therefore not evidence of reachability from an independent service.
The missing production seam is controlled exposure of the existing Gateway
model listener to this independent component. This attempt did not join Core/DB
networks, broaden SSRF, bypass the Gateway, create a dummy model, extract a
session token, or write a credential. A model object is not registered ready.

## Historical native identity/source-delivery batch

The following original batch was not an approved `KNOWLEDGE@v1` implementation,
an active ApplicationBinding, or an exposed Kailo Tool. That batch did not modify
Core/contracts, the then-current component integration tree, live configuration,
or native data. The follow-up above does modify Core/contracts in its independent
candidate; the historical statement is not a description of that new slice.

The complete frozen fork is now present in the implementation workspace at
`apps/knowledge/`: 4088 source paths, including the native frontend, backend,
MCP implementation, migrations and Kailo packaging/evidence. No dependencies,
build cache or runtime secrets were copied. Fourteen unchanged upstream paths
hidden by parent ignore rules were compared byte-for-byte against the fixed
commit and explicitly included. The original `upstream_manifest.py diff
knowledge --check` reports zero undeclared removals, exit 0. This is source
delivery under ADR-15/16, not a Git push, running deployment or integration
acceptance claim. Native public-service and MCP acceptance gaps below remain.

The registered application and document-reader Dockerfiles now pin their
remaining original base tags to registry indexes actually read by
`docker buildx imagetools inspect` (all exit 0): Go 1.26 Bookworm
`sha256:a688600ca24f8a4d3ca77f95b0dd40704a9fc787c826660eb7ba0b641b8b175d`,
Debian 12.12 slim
`sha256:d5d3f9c23164ea16f31852f95bd5959aad1c5e854332fe00f7b3a20fcc9f635c`,
and Python 3.10.18 Bookworm
`sha256:ee0c7d26e2dba416773cb51c042496e9cffacc872459f57726935dd6833f2d96`.
Existing pinned Node/nginx bases are unchanged. This satisfies ADR-06/16 input
pinning without replacing the native recipes or claiming a new built image.

## Source and actual consumer

The complete native tree was imported from WeKnora
`2be7bd40631dda1dd485306038f07a62e9ee287e` (4072 original files). The independent
native identity/correlation batch below modifies nineteen explicit native
paths; the remaining engine, UI, MCP hosts, licenses, locks and layout are
retained. This is a source fork, not a packaging-only identity claim.

Authority is `.design/08` §5, §9, `.design/07` component admission, DD-58/63/70/71/93,
and apps ADR-04/15/16. The services remain independent native app/UI, native
PostgreSQL/vector store, Redis queue, and native document reader. No native
resource/action/role is mirrored as a second Core authority.

`fork/deploy/compose.yaml` really invokes `native_entrypoint.py`. That wrapper
reads private, bounded regular files into the exact environment names consumed
by `internal/config/config.go::applyOIDCEnvOverrides` and the existing native
database/Redis/crypto clients, then `execve`s the original
`scripts/docker-entrypoint.sh` with `./WeKnora`. The original entrypoint drops
privileges through `gosu appuser`; native migrations/lifecycle remain native.

The AES input is exactly 32 UTF-8 bytes. Invalid/missing secrets, an ambiguous
direct environment secret, disabled OIDC, Lite Redis mode, or a substituted Core
database endpoint refuse process start. No secret is printed, put in argv,
generated, stored in the repository, or fetched directly from OpenBao. The
adjacent `.env.example` contains file references and nonsecret configuration only.
OpenBao Agent supplies the actual files. File change requires native app restart;
it is not a DATA_KEY re-encryption or automatic key-rotation implementation.

Redis receives the native Agent-rendered configuration file, not `--requirepass`
with a password in process argv. Its thin entrypoint copies a private file to
private tmpfs with ownership for the native `redis` user, then invokes the
official image's original privilege-dropping entrypoint. This addresses local
Compose file-secret ownership without changing the host file or leaving another
credential on the database volume. App/Redis file rotation requires restart;
matching password/config outputs must come from the same authority/version.

Native OIDC uses an independent registered client and the native
`internal/handler/auth.go::OIDCStart/OIDCRedirectCallback` authorization-code
flow. The callback derives scheme/host from the request. The frozen native
`frontend/nginx-api-proxy.conf` sets `X-Forwarded-Proto $scheme`, which replaces
HTTPS ingress with internal HTTP. The new actual frontend entrypoint retains
the original UI process but renders only the two verified Host/protocol lines
from one configured native public origin. It does not trust a browser-supplied
forwarded origin; a changed or duplicate template refuses startup. The original
UI/nginx/SSE implementation remains intact.
Native tenant/KB membership remains managed by WeKnora, not inferred from Kailo
membership or granted by this Compose. No account/client/credential was created.
There is no shared platform DB, network, Docker socket, or sandbox deployment.

## Official images: actual reads, not a source claim

Public Docker Hub tag and Registry v2 manifest/config GETs succeeded. Values
below are observations only; they are **not** installed into the Compose:

| Official image | Tag/index digest | linux/amd64 manifest | OCI revision |
| --- | --- | --- | --- |
| `wechatopenai/weknora-app` | `v0.8.0`, `sha256:14953fcb990c59b2546f00e94673d2a4c88689e3319bfcf2b06f82feaccec9b4` | `sha256:d266bb3cb6b9de071b78d133e9b68592826d42be63bae7a6b4374b8d0ce1bdc5` | `1edcd54b43606d9079bb36650efe3f68707a79ea` |
| `wechatopenai/weknora-app` | `main`, `sha256:e0ef924e759fac5b67ce48c23af0659bee1a328577dfb43e1892f4ef139fe46e` | `sha256:9ca0ddac88edc3a9b748ddba77ed5117a8f53a37b6823719020606a77c3d7277` | `bccb4b151bae403508da77fbb174efc79dc47c1a` |
| `wechatopenai/weknora-ui` | `v0.8.0`, `sha256:c7154f157479ee9edcf1cd420afe8bdb015bbad5b8cc1cf237b77c78ff6a61ee` | `sha256:1dd91e6311ae8996c000262aa033143ecb7b19f74cb809fb825716ce5f656578` | Not independently read |
| `wechatopenai/weknora-docreader` | `v0.8.0`, `sha256:59e26f98f17c296c5f4bd216404558f51d31991b580cfef1d204903a01e4b46b` | `sha256:546aa7902310144e851a6e8dfd5a3e713aca4e7ca4456782a1efc69e7359708b` | Not independently read |

Neither read app revision equals the design evidence pin. The local `v0.8.0` tag
also resolves to `1edcd54b43606d9079bb36650efe3f68707a79ea`, not the pinned commit.
Changing a tag name or reusing its immutable digest would not repair that fact.

The two native infrastructure versions selected in the upstream Compose were
also independently read from official Docker Hub: `paradedb/paradedb:v0.22.6-pg17`
index `sha256:58bf87d2a6f1e72f56590b0f0ae1467e82c3f99ca203dde646672c8ac13148b2`
and `redis:7.0-alpine` index
`sha256:c9d92d840fd011c908f040592857c724ae6d877f2aba5c40ad963276507386b2`.
These exact dependencies, not mutable tags or invented digests, are in the new
Compose. No image layer was downloaded or service started.

The official GitHub [Build and Push run 35327306319](https://github.com/Tencent/WeKnora/actions/runs/35327306319)
has exact `head_sha=2be7bd40631dda1dd485306038f07a62e9ee287e`, completed/success,
including app/UI/docreader jobs. Its public metadata is readable; anonymous
`GET /actions/jobs/105550523835/logs` returned HTTP 403. The page requires login
for logs, and output summaries contain no image digest. Artifact archive digests
are **not** OCI image digests. No digest for that exact source has been proved,
and no authentication bypass, product build, or image pull was attempted.

Deployment image inputs are required, never `latest`; unbuilt source artifact
fields remain `none`. Kailo builds this adapted source under the existing
delivery authorization. An official image cannot replace that source-built
artifact, and obtaining upstream build logs is not a development prerequisite.
The observations above preserve the original investigation; they do not ask
for new build permission or certify this changed source.

## MCP: do not open an incomplete governance path

The frozen source contains two different MCP surfaces:

- `internal/router/router.go::NewRouter` registers native `/mcp/:endpoint_id`
  before native API middleware. Its native credentials/KB allow-list remain
  native authority; direct ungoverned Kailo Agent access is excluded. The current
  `.design/08` §10 selects this native server through AgentGateway, not a second
  same-purpose MCP implementation (SF-WEK-14).
- The official standalone Python `mcp-server/weknora_mcp_server.py` has a native
  `MCPServer`, `run_http`, and `WeKnoraClient.hybrid_search`. It is a reusable
  upstream host, not a reason to invent a second MCP SDK/server or knowledge engine.

The standalone host's `MCPAuthMiddleware` validates a native shared bearer.
Its registered tools include native tenant/KB mutation and native chat/Agent
operations. A scoped native API key/KB allow-list does not replace Gateway
ExtMcp, Delegation, Approval, or fresh Core PEP. `PROTOCOL_PEER` applies that
governance on the Gateway/Core side without requiring the native MCP endpoint
to accept a Core ActionToken. `REMOTE_ADAPTER` still requires its own Adapter
contract. Native historical ContentReference verification remains unclosed;
no result wrapper is used to circumvent it.

Consequently this candidate adds no MCP service to the exposed Compose, no
Gateway route, ToolDefinition, ComponentRelease, CapabilityContract, registry
entry, or ACTIVE binding. The next actual seam must reuse this official host and
the existing application Tool caller: exact scoped native credentials and KB,
Gateway identity/ActionToken, both PEP phases, and a verified result/reference.
Those public Core/schema changes belong to a separately coordinated batch. This
identity/correlation batch does not claim any of them complete.

## Verification status

`test_native_entrypoint.py` contains eleven post-implementation cases using the
actual production functions and ephemeral files: exact delivery/exec, malformed
AES, absent/private files, symlink/path refusal, independent database/Redis,
OIDC inputs, direct-secret ambiguity, command override refusal, and the actual
proxy renderer's exact origin mapping/unknown template refusal. They ran in the
fixed limited SDK: eleven passed, destructive production-guard mutations failed,
and exact restoration passed again. Original records are
`codex-knowledge-integration-20261005.lWhn4K/validation-{baseline,mutation,restored}.log`.
No Compose up, remote native OIDC login, model request or Tool result has been
claimed successful; the new native source verification is recorded separately.

## Native image build impact — 2026-10-05

### Source-built repository delivery correction

The independent Compose originally fixed all three application repositories to
official `wechatopenai/*` images. Supplying a digest from the Kailo registry
therefore still addressed the wrong repository. Under DD-87/93/94 and ADR-06/16,
the frontend, app and document-reader now each require a nonsecret
`KNOWLEDGE_*_REPOSITORY` as well as the existing `KNOWLEDGE_*_DIGEST`; Compose
joins them with the literal `@sha256:`. Repositories and digests must come from
the corresponding adapted-source artifact records, never from an official tag.
The configuration example is the producer; the three Compose image fields are
the only consumers found by repository-wide search. Existing digest keys retain
their meaning, with no fallback for a missing repository. There is no currently
deployed independent instance to migrate. No native DB, platform contract,
Workflow, secret, port, permission, UI or runtime state changes. Web/Desktop
still consume the same native page; Mobile does not host it.

Docker Compose 2.40.3 `config --images` actually resolved all three supplied
repositories with their exact digests (exit 0). Six independent missing-input
checks (each repository and digest) each exited 1 naming the missing key.
Passing the previous, unmodified indexed Compose through the same native
renderer caused the repository assertion to fail (exit 1); the current Compose
then passed again and both production-file SHA256 values were unchanged.
Nonsecret `.invalid` fixture repositories were used only for configuration
rendering: no image pull, container start, secret read or network request.
`git diff --check` exited 0. Original log:
`codex-application-core-worker-release-20261005.2Co1Ge/knowledge-source-image-config.log`,
SHA256 `5ed07dcba3c2665b172730de0176c2a1e718a26e86f9317ee09b8bcf6ca3e9f3`.
This closes repository selection, not source-image or native-service acceptance.

### Original baseline build investigation

1. Impact: only this complete `knowledge/` source and its existing image source
   record. Core, Gateway, protocol/schema, credentials, deployed containers and
   independent native accounts are unchanged. An image is not MCP acceptance.
2. Investigation: `docker/Dockerfile.app` and `scripts/build_images.sh` compare
   byte-for-byte with `2be7bd40631dda1dd485306038f07a62e9ee287e`; original Go
   `go.mod`/`go.sum` also compare equal. The complete app recipe retains its
   BrowserSkill pinned source and default `WITH_ANYDOC=1`, not a lite substitute.
3. Delivery: reuse original `tools/build-upstream.sh knowledge-service` and its
   source/stage/registry/record algorithm. The source record lists original
   nonsecret `*_ARG` version inputs so the native Dockerfile receives them;
   no native source or Dockerfile is modified. `GO_VERSION_ARG=unknown` makes
   no claim about a host toolchain; compilation uses the original builder image.
4. Execution boundary: actual `kailo-core-data` BuildKit is running at 8 CPU,
   16 GiB memory and equal memory+swap, cache bound to
   `/volumes/data/kailo/buildkit-core-state`. Preflight shows no build executor,
   34612740 kB host available memory, CPU PSI avg10 4.49 and memory PSI 0.07;
   Data disk has 92 GiB available. Inputs and native dependency/recipe hashes
   are captured before and after. Real build outcome is recorded below.

## Native identity and causal trace source batch — 2026-10-05

1. Impact: nineteen native paths implement the existing identity boundary
   (`03`, DD-63/93, `08` §5) and SS-WEK-ASYNC-TRACE/SS-WEK-LLM-CTX. Native
   accounts, tenant/KB permissions, JWT sessions, UI and native task execution
   remain WeKnora authority. There are no Core/schema changes, live account or
   role writes, model requests, new MCP server, or platform permission inference.
2. Source evidence: fixed `2be7bd40631dda1dd485306038f07a62e9ee287e`
   `internal/application/service/user.go::LoginWithOIDC` resolved by email and
   discarded authenticated issuer/sub. The actual consumer now resolves the
   immutable pair, persists it in the initial native User INSERT, and checks
   UserInfo against a verified ID-token identity. Email collisions refuse; email
   changes retain the same account and native roles. Original HTTP/Asynq/model
   callers now carry W3C context independently of the optional Langfuse exporter.
   Static model headers cannot replace live trace or provider authentication.
   Correlation does not authorize a call or establish a billable operation.
3. Compatibility: PostgreSQL 104 and SQLite 24 add nullable native identity
   columns, completeness/uniqueness and immutable-update guards. Local and
   legacy OIDC rows stay unbound; no email-based backfill or silent linking is
   provided. An unbound legacy account's colliding OIDC login refuses. Bound or
   soft-deleted identities stop rollback and cannot be reassigned. These are
   native schema changes, not changes to platform contracts or Workflow payloads.
4. Verification: the original Go 1.26 builder digest
   `sha256:a688600ca24f8a4d3ca77f95b0dd40704a9fc787c826660eb7ba0b641b8b175d`
   reports Go 1.26.8, running at 4 CPU/8 GiB/no extra swap with readonly source
   and dedicated Data caches. Original `go.mod`/`go.sum` hashes remain
   `f0ab6d3332e84426733166abdc947e337c581eb4cf7951b232939f0947ffea31` /
   `2f0de87d3eb808b1697c4c8745d7966698728998eae4bbe2eae08ef751193be9`.
   Locked `go mod download` exited 0; subsequent tests/vet used `GOPROXY=off`
   and `-mod=readonly`. Four actual packages passed 25 top-level tests (six
   nested subtests), then `go vet` and gofmt checks exited 0. Tests call the
   real LoginWithOIDC, native repositories/migration and Gin→Asynq→HTTP header
   consumers; local HTTP fixtures do not establish deployed OIDC acceptance.

Original Data records are under
`/volumes/data/kailo/tmp/codex-installation-runtime-rootcause-20261003.e4agxD/knowledge-native-identity-20261005.WkKIGG/`:

- `native-targets-first.log`: initial cached Go 1.27 offline dependency lookup
  failed before compilation, not a production-toolchain result.
- `native-go126-targets-first.log`: exit 1, real login exposed the GORM acronym
  column-name mismatch. Explicit native column mappings corrected it; the login
  fixture also executes the actual identity migration. SHA-256
  `cab6cbbbf83c4876ff955e45696b23a5f22a8420d066ed1be3fd1c4cf651fc7b`.
- `native-go126-production-mutation.log`: exit 1; replacing the actual identity
  lookup with email and restoring exporter-gated task injection causes both
  production-consumer assertions to fail (including all three collision forms).
  SHA-256 `8232a09671ea379350c0096a1ad7d2c29ed9e2ca4ea1ab15216b070b056f6308`.
- `native-go126-mutation-restore-cmp.log`: exact saved-source comparison 0.
  `native-go126-restored-final.log`: original four-package tests plus vet exit 0,
  SHA-256 `aea207c62d94dd0e32386a31d193d3f9d0a9f18b2e038680eaa7d47716ac53b1`.
- `native-sqlite.log` exited 0. The isolated `knowledge_identity_wkkigg` database
  on the existing network-isolated PostgreSQL exercised actual 104 up/down/up,
  duplicate/partial/empty/rebind refusal, profile change, soft-delete retention
  and rollback refusal. `native-pg104.log` / `native-pg104-constraints.log`
  record final exits 0; the first prematurely started negative runner exit 90
  is retained separately. This is a bounded identity-DDL check, not a full
  native PostgreSQL migration chain or service acceptance.

At this native identity check, the separately running original-source image
build was only a baseline build and could not attest this changed source;
the changed fork's artifact fields were `none`. The subsequent native UI image
result is recorded below. Neither result establishes deployment, shared OIDC
user membership, Gateway Tool, Adapter/ContentReference, Temporal/ExternalExecution
or provider usage acceptance. Those public-service seams remain separate work.

## Native UI image delivery — 2026-10-05

The original `./tools/build-upstream.sh knowledge-native-ui` completed with
exit 0 (execution handle 57751). It built the unchanged native frontend recipe,
exported and published the image, and wrote the actual source/artifact pair to
`knowledge/fork/upstream.yaml`:

- Source: `sha256:e22029ae174debaf6bfaadc080d4ff2202630a215a068afc407bbdbc386e46ee`.
- Image: `sha256:4cef6713f4b631b7bdfa6c438484e46e5c4c13fa818282ebb0540bef56aea371`.

The existing `kailo-core-data` BuildKit enforced 8 CPU, 16 GiB memory and equal
memory-plus-swap; its cache remained `/volumes/data/kailo/buildkit-core-state`.
The actual preflight recorded 33,155,292 kB available host memory, CPU PSI
avg10 0.42 and memory PSI avg10 0.00. The native Node build retained its
4 GiB heap setting. Windows packaging shared that bounded builder; no separate
unlimited executor or host SDK was used.

Native npm reported **8 vulnerabilities: 3 moderate and 5 high**. They are not
remediated by successful compilation. Vite also reported chunks over 500 kB;
the recipe and warning threshold were not changed to hide the warning.
Raw command, preflight, build output and publication record are retained at
`/volumes/data/kailo/tmp/codex-application-core-worker-release-20261005.2Co1Ge/knowledge-native-ui-build.log`,
SHA256 `08b65dd0f05af61c175eb62729048c289186d8cb68bae01214f14a986a871461`.

This is one source-built native UI artifact, not a deployed WeKnora instance.
The app and document-reader artifact fields remain `none`; no app/docreader
image, OIDC login, authenticated browser, component binding or governed MCP
business acceptance is covered by this result. Earlier failures and their
original evidence remain above.

### Canonical Git input correction — 2026-10-05

The joint full check exited 1: the archived source digest differed from the
first native UI build. `git ls-files --eol` identified exactly two CRLF working
files with LF indexed bytes, `knowledge/mcp-server/Dockerfile` and
`knowledge/mcp-server/requirements.txt`. Mechanical normalization to the
existing `.gitattributes` rule made the unchanged original source calculator
match the Git archive; no input range or digest algorithm was altered.

The original `./tools/build-upstream.sh knowledge-native-ui` then exited 0
(handle 54321), publishing and recording this actual replacement pair:

- Source: `sha256:70fa2b6f9b429fcff426e630e80306c4fd65d267b9d7943669fe6760565b823a`.
- Image: `sha256:fe86075f63f92527715144b079141447b87005e8697ea5b353d736d4915bc0f4`.

The same bounded BuildKit and Data cache were used. The retained log is
`/volumes/data/kailo/tmp/codex-application-core-worker-release-20261005.2Co1Ge/knowledge-native-ui-canonical-build.log`,
SHA256 `232b29ea1e56dbee1a5df200a9a6cd62843a17e53d13b02b4c9df625a5790c86`.
The failed full and first build remain historical evidence. This correction
does not establish a deployed service, backend/document-reader artifacts,
vulnerability remediation or component business acceptance.

### Native runtime credential delivery — 2026-10-05

Implementation base: `57adcd1612bfd421c8b93d843deae7c4b66604bb`.
The private implementation and receipt directory is
`/volumes/data/kailo/tmp/codex-knowledge-runtime-20261005.o07j5k`.

Four-step impact and authority review:

1. Authority: DD-71/93 and design 08 §5/§9 retain the independent native
   accounts, OIDC login, UI and database. `fork/deploy/provision.py` consumes
   the original Keycloak administrative API and OpenBao KV v2/AppRole/Agent,
   not Core, a new identity service or a component activation operation.
2. Impact: only the existing standalone Compose, configuration references,
   provisioning consumer and its existing entrypoint evidence are extended.
   `KNOWLEDGE_UI_BIND_ADDRESS` replaces the loopback literal; no app API,
   protocol contract, business database, binding or Tool is created by it.
   Existing operator credential files are never mounted into native services.
3. Side effects: only an exact independent confidential OIDC client and a
   dedicated OpenBao namespace/path/policy/AppRole are created. Existing
   callback/client/key mismatches refuse rather than overwrite. KV creation
   uses CAS 0; rerun first reads the same client and KV version. Uncertain
   HTTP writes are not retried inside the consumer. No native admin, platform
   membership, application binding or model permission is granted.
4. Exceptions: absent/ambiguous client, wrong callback, malformed private
   file, wrong AES byte length or secret mismatch refuse. Agent delivery is
   wrapped, single-use AppRole authentication and exact versioned reads;
   `error_on_missing_key` and `exit_on_retry_failure` are enabled. Operator
   errors never print upstream bodies or credential values. Native startup
   still requires the independent PostgreSQL, Redis and document reader.

Fixed upstream evidence was rechecked read-only:

- `2be7bd40631dda1dd485306038f07a62e9ee287e`,
  `WeKnora/internal/handler/auth.go::OIDCRedirectCallback`,
  `WeKnora/internal/application/service/user.go::LoginWithOIDC`, and
  `WeKnora/internal/container/container.go::initDocReaderClient`.
  The callback remains `/api/v1/auth/oidc/callback`. Native support for a
  disconnected document reader is not used as a deployment fallback.
- `735723da5628148f232497a48a35a137b6512103`,
  `openbao/internal/command/agent/config/config.go::parseAutoAuth` and
  `openbao/website/content/docs/agent-and-proxy/autoauth/methods/approle.mdx`,
  `secret_id_response_wrapping_path`: Agent validates the exact AppRole
  secret-id creation path. Templates read KV with `?version=1`, not a
  write-style `secret` template argument.

Actual controlled development operations:

- `python3 knowledge/fork/deploy/provision.py` exited 0. The independent
  native client UUID is `fdf173f1-3b00-45a6-9234-9f8df19a52e3`, namespace
  `knowledge-native`, KV version 1. Two subsequent lookup-first runs kept
  that same client and version; they only issued fresh one-use Agent delivery.
- The existing fixed OpenBao image
  `sha256:7d26314820a535ef346f1e63911809e4d356b48068fef00a9dcb3400bb9e11b6`
  ran native `bao agent -config=…/agent.hcl` with 1 CPU, 256 MiB memory,
  equal memory/swap, UID/GID 1000, all capabilities dropped, and one private
  delivery-directory mount. It exited 0 after rendering six native secret
  files and the original Redis configuration. No sink token or operator
  credential is mounted into the native application.
- Original failures are retained: the first JSON Agent configuration was
  rejected (exit 1); the initial version argument selected a write request,
  which the read-only policy correctly rejected with HTTP 403. That Agent
  was stopped, not made more privileged. The corrected HCL plus versioned
  GET completed. No policy permission was broadened to make it pass.

Post-implementation validation used the existing fixed SDK
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`
at 4 CPUs/8 GiB, original Data cache, no build or package installation.
`python3 fork/deploy/test_native_entrypoint.py` passed 14 tests. Removing
the production exact-client comparison caused the callback mismatch test
to fail with `ConfigurationError not raised` (exit 1); byte restoration
then passed all 14 (exit 0). The earlier mutation first exhausted its mock
response list; that inadequate negative fixture was corrected before the
actual guard-failure result was accepted.

Receipt SHA-256 values (files under the directory above):

- `native-provision.log`: `d614afd46abb8639987488779c0b4ee6862e630c0961a45d7badaa2f177ef86b`.
- `native-delivery.log`: `ec2dfb8a3d107910f70631a869c22e9639e5c0c0157b5019bf686037848fa10b`.
- `native-delivery-hcl.log`: `1b37d5d3638699cea2d5cb6a20ebd0d5391f1bcc2af5fbc52669e9cde4f605aa`.
- `native-delivery-versioned.log`: `d0984a1a4c5c9fa5bde2aea1d523207a1825f0d2431be33590953e8dde0b421c`.
- `native-entrypoint-mutation-final.log`: `22293f065739558014d4590268db292125437b76af1d876c454ecaf44218b612`.
- `native-entrypoint-restored-final.log`: `f2985e54ed7498e534ca07a638a380f94819d7ef07a591c42b4d610e91704378`.

This record proves provisioning and file delivery, not native login or
knowledge use. At this receipt point no native service, public MCP Tool or
Kailo binding has been activated, and no model request has been made. The
document-reader build is still running. Runtime-wrapper changes made after
its initial input staging require final frozen-input artifact reconciliation;
the first build's late record write cannot establish that new input's origin.

The independent Compose also explicitly delivers `AUTO_RECOVER_DIRTY=false`;
the existing native entrypoint rejects a different value. At the same pinned
WeKnora commit, `WeKnora/internal/container/container.go::initDB` otherwise
defaults this switch to true, and
`WeKnora/internal/database/migration.go::RunMigrationsWithOptions` can force
the recorded migration version. Disabling that native recovery prevents an
unknown migration result from being treated as completed. This runtime
switch is registered in the implementation operations baseline §1. Native
database version/dirty readback is still required after startup; health alone
does not establish migration success. The final entrypoint check passed all
14 tests, exit 0 (`native-entrypoint-final.log`, SHA256
`98e2c1e6dafa9adb3a4f63f209231ed30ebe6a2630338bfd8598bb714b880db7`).
Removing this dirty-recovery guard from the isolated execution mirror caused
the existing startup refusal case to fail (14 tests, 1 failure, exit 1);
byte-for-byte restoration passed all 14, exit 0. Receipts are
`native-dirty-mutation.log` (SHA256
`9470dbe466ca37cd6f1aa06be6b586b903b732a7a10ae681de6ee635c3a0915d`)
and `native-dirty-restored.log` (SHA256
`f9ef00017caa2702daf282381ab6c7f1ab6d560d0023b5d78f4f51e57461cbf8`).

The already-built app's binary was read from its exact immutable image and
inspected with the existing SDK's `go version -m`, without executing the app.
Its actual build metadata is Version `2be7bd40631d`, CommitID
`6112fdb6dfbdee9897a34e374988e6d79f37406c`, BuildTime
`2026-10-05T13:21:51+00:00`, and GoVersion `go1.26.8`. These are artifact facts,
not a claim that the private runtime candidate has already been built.
`native-app-binary-metadata.log` SHA256 is
`a4e20313428cb5aeabe24d4ebdb02ba7fa85fc3e6c66805c40d7e818eaee194b`.
The original `knowledge/Makefile` build target injects these environment
values into the binary; the original `knowledge/scripts/build_images.sh`
supplies the native GOPROXY default. The original build log did not retain
all five effective build arguments, so complete historical argument identity
is not asserted.

The original document-reader build (handle 98126) subsequently exited 0 and
published `127.0.0.1:55000/knowledge-document-reader:2be7bd40631d` at
`sha256:96c3b7fca577682e6550ca235116c987180907d1b06ce17be081e5370d3b7dc9`.
`docreader-build.log` SHA256 is
`4c5cb5203ae8250b29ac16f783f050d2a653edb9ad6fcba4d6d1f1d808cd8086`.
It used the original full LibreOffice and Playwright WebKit dependency steps;
the intermediate missing-library warning was followed by the original
`playwright install-deps webkit`. This first build consumed the initially
staged source, before deployment-wrapper edits; its late manifest write is
not accepted as final frozen-source evidence. Final original-helper source
reconciliation is still required.

The first actual native Compose `up -d` failed before any container existed:
Docker's predefined address pools were fully allocated. The retained
`native-compose-up.log` SHA256 is
`f450e8a2d3c1509f0db460fdba4803757c6d8f06ef7a4735638943a0e37b18ff`.
The original Compose now requires explicit UI/data IPAM subnets. Development
delivery selected `10.200.0.0/24` and `10.200.1.0/24` only after checking every
Docker IPAM range, the host's LAN/VPN routes and the operational manual's
Pod/Service CIDRs. No existing network or global Docker configuration was
modified. The next original Compose invocation (87021) has created these
two project networks and four native volumes; at this receipt point container
creation is still running, not a healthy-service or login result.

Model integration was checked independently of document-reader availability.
At fixed WeKnora `2be7bd40631dda1dd485306038f07a62e9ee287e`,
`WeKnora/internal/handler/model.go::ModelHandler.CreateModel`,
`WeKnora/internal/models/chat/chat.go::ConfigFromModel`, and
`WeKnora/internal/models/rerank/reranker.go::ConfigFromModel` consume the native
base URL, credentials and headers. Design 08 §5/§9.2 requires an authorized
`PLATFORM_LLM_ROUTE`, configured through this native management surface.
The current Core `model_route::provision`/`resolve` still bind credentials to
`catalog.agent_model_binding` and an AgentInstallation; release/binding
admission still accepts only `allowedModelCallModes=[NONE]`. Thus an existing
Agent key, an arbitrary model URL, or a falsely declared NONE mode cannot
establish WeKnora model integration. No such credential reuse, default model,
model request or public knowledge Tool was introduced by this runtime batch.

### Independent native login: actual deployment and corrected SSRF delivery

At 2026-10-05 19:16:56 UTC the original five-service Compose was running and
normal browser OIDC login completed at
`http://192.168.0.193:58094/platform/knowledge-bases`, title `WeKnora`.
The original startup handle 87021 exited 0. This is independent native
service use, not a Kailo `ACTIVE` binding or a platform Tool activation.

The first browser run exited 1: `/api/v1/auth/config` and
`/api/v1/auth/oidc/config` returned 200, but `/api/v1/auth/oidc/url` returned
403. Its structured error explicitly identified the IP-literal IdP discovery
URL as rejected by native SSRF protection. At fixed commit
`2be7bd40631dda1dd485306038f07a62e9ee287e`,
`WeKnora/internal/utils/security.go::loadSSRFWhitelist` and
`WeKnora/internal/application/service/system_setting.go::applySSRFWhitelist`
consume the deployment-owned `SSRF_WHITELIST_EXTRA`; the latter preserves it
when native system settings are loaded. The original Compose now passes that
existing setting from `KNOWLEDGE_SSRF_WHITELIST_EXTRA`. This deployment supplies
only the exact already-approved IdP host `192.168.0.193`, not a subnet or a
wildcard. Native SSRF remains enabled. The whitelist applies to all native
outbound clients, not solely OIDC; it must not be expanded implicitly from
user-supplied URLs. No credentials or roles changed to make login pass.

Original `docker compose ... config --quiet` and `up -d --no-deps app`
exited 0 (handle 21525); only the existing native app was recreated, with
the same immutable image. No platform container or database was restarted.
The restored browser run (62541) exited 0: OIDC authorization URL 200,
callback 302, followed by actual native `auth/me`, `knowledge-bases`,
`models`, `organizations` and other page data requests all 200. Console
errors, page errors and failed requests were all zero. The selected anchor
and `main` counters were zero and do not establish navigation completeness;
the final native route, title and authenticated API results establish login.
The existing bounded browser container and normal identity-provider form
were reused, without cookies fabricated or exported. Only normal login
side effects occurred; no model, knowledge content, Tool, quota or platform
permission write was performed.

Original receipts under
`/volumes/data/kailo/tmp/codex-knowledge-runtime-20261005.o07j5k/`:

- `native-login.log` (failure, exit 1), SHA256
  `cfeef73a9d1d0b38cd8334e311c03bdf7176ca419a697f5901995e9783d78c58`.
- `native-oidc-config-up.log` (exit 0), SHA256
  `ab152bbb8e3e4dfd520ae61935b766a5c4e37c85b4f60dcdd6c4d3475b0b7812`.
- `native-login-restored.log` (exit 0), SHA256
  `2b5729259d15660c322eb7e4ad5bfcbc56b5b35f194b1b911b35013332796db1`.

Native page/login acceptance does not prove model completion, retrieval,
document processing, embedded Kailo presentation or native MCP governance.
The independent APPLICATION model consumer is a separate unaccepted batch.
Runtime wrapper edits are still not covered by final frozen-source image
reconciliation; existing artifact digests were not changed to disguise that.

The native database was also read through its own existing Postgres container:
`select version,dirty from schema_migrations` returned `104|f`, exit 0.
`native-migration-readback.log` SHA256 is
`c700b955b3290e83a6864dd54557ed4bc6999f15f4fc4d8087a2163192a321bc`.
This read did not modify business records or migration bookkeeping.

## 2026-10-06 independent model transport and native model initialization

This slice changes deployment wiring, not the pending model credential delivery
or APPLICATION authorization implementation. Source is the selected deployment
files from the `lciVUS` working tree over `306aa41b`; the exact `before/` and patch
are retained under
`/volumes/data/kailo/tmp/codex-knowledge-edge-20261006.hk1xfO/`.

Four-step implementation boundary:

1. Authority: DD-92 / design 03 and 07 §9 permit the independent native service
   to consume the existing Gateway model route. Apps 07 §1 forbids publishing
   LLM/admin host ports. The existing edge network is used; no new Gateway,
   proxy, Core/database network attachment or shared service identity is added.
2. Consumers: the sole platform `.env` supplies `PLATFORM_EDGE_NETWORK` and the
   existing derived `AGENTGATEWAY_MODEL_BASE_URL`. Platform Compose uses that
   network name and model-host alias. The new native `start.sh --platform-model`
   actually consumes the optional Compose overlay and only recreates `app`.
   Standalone startup without the argument has no platform prerequisite.
3. Effects: the original native entrypoint adds only the exact model URL host
   to the existing `SSRF_WHITELIST_EXTRA`, preserving approved IdP entries.
   Fixed WeKnora `2be7bd40631dda1dd485306038f07a62e9ee287e`,
   `internal/utils/security.go::{ValidateURLForSSRF,IsSSRFWhitelisted}` and
   the native system-setting merge consume this field; no global SSRF disable,
   wildcard, CIDR, new policy database or model credential is introduced.
   This native host exception applies to outbound clients generally, not only
   models, and is not a per-port firewall or model authorization grant.
4. Failures: invalid URL/host, missing sole inputs or failed Compose validation
   refuse startup. External edge must already exist. Native databases, reader
   and frontend never join edge. Unknown native POST outcomes are read back,
   not retried; model keys and inference remain outside this transport step.

Operational entry: first start the independent service with
`bash knowledge/fork/deploy/start.sh`. To integrate an existing service, use
`bash knowledge/fork/deploy/start.sh --platform-model /absolute/platform/deploy/local/.env`;
add `--validate` for render-only validation. Keep the native `.env` beside its
Compose file. Set the platform's new network field to the inspected existing
edge name, preserving that network rather than creating a replacement. Do not
copy platform model URL or network values into the native `.env`. No build or
identity bootstrap is performed. Gateway LLM strict Bearer authentication and
the Core APPLICATION model checks remain required independently.

Post-implementation checks used existing 4 CPU / 8 GiB SDK containers, without
Cargo, image build or full. The original native unittest module passed 18 tests.
Removing the actual exact-host guard caused three malformed-host cases to fail
with exit 1; exact restoration passed all 18. The original `step_security`
host-alias/network-name block passed on the candidate Compose; hardcoding its
model alias caused exit 1, restoration passed. This is a targeted block check,
not the whole security/full gate. Actual Compose rendering proved only app
joins the existing external edge and no new app host port is published.
The first Python run had two missing original nginx-fixture errors; corrected
execution paths passed. A first security-block run lacked PyYAML in the native
SDK; the existing check SDK supplied it, without installation. Failures remain
in `native-positive.log` and `security-fragment.log`.

Authorized runtime delivery changed only one nonsecret line in sole `.env`:
`PLATFORM_EDGE_NETWORK=platform-local_edge`. First start exited 1 because the
running image had no local repository-digest reference; the existing app kept
running. The same immutable registry manifest was HTTP 200, pulling that exact
image exited 0, and the original start entry then exited 0. Only WeKnora app was
recreated, retaining image
`sha256:db4ec09f76ee61b403cc79cf56c131dbfb6810e473dc7fadb0fb21ff2f08a8c8`;
Gateway, native frontend, PostgreSQL, Redis and reader IDs/start times did not
change. App is healthy and its actual networks are native UI/data plus existing
edge. From that app, unauthenticated `GET /v1/models` returned 401. Gateway still
publishes only its previous 8080/8091 listeners, not LLM/admin. Reachability and
strict rejection do not prove model inference or credential delivery.

At 00:35:30 UTC normal native OIDC login verified the existing owner and tenant
10000. Model listing first found no corresponding object, a single native
`POST /api/v1/models` returned 201, and exact `GET` returned 200. Native model
`54b825a1-e74a-4e56-b691-59d7c0b6fb57` is the nonbuiltin `KnowledgeQA` / `remote`
model for the existing virtual route `5c57957c-e7dd-4173-b286-1722af88209a`,
provider `generic`, base URL `http://agentgateway:18081/v1`. Its native `active`
field is only the original model-record status, not a Kailo ACTIVE binding or
successful inference. No key was written, no inference requested, and the old
native runtime still lacks the pending credential-proof implementation.
Receipt: `native-model-initialize.log`, SHA256
`f68665e0339ee41346bf61e646b24e92c9a088acf28e7dc60efe7d65aafa1437`.
The deployment uses private wrapper files; source commit/push, whole security,
full, product source reconciliation and model business E2E remain unclaimed.

## Current unbuilt source declaration (2026-10-06)

The final source tree incorporates the transport, credential-delivery and edge
changes above. All three existing artifact recipes declare `inputs: [knowledge/]`;
their historical images therefore do not attest to this current source tree.
Following `06` section 2's existing unbuilt-artifact semantics, the current
manifest records both digests as `none`. No checker, source scope, capability
exposure, recipe or feature code is removed or relaxed. `04`'s reference-service
boundary and `03` section 6 keep this implementation's release/binding unopened
without blocking the independent platform source delivery. This is not a completed
reference-service release or a declaration that the historical images disappeared.

Historical manifest pairs retained exactly (source digest / artifact digest):

- Service: `sha256:2a5df0ee4bb58329ebead428b981e3d32383bbd04fe29d1a7406b1a56e922087`
  / `sha256:f3f11f0623e16ea560cc04c08f2ee0ab27e33115237051a3f208a7ff573a3ccf`.
- Native UI: `sha256:b67e28596c8c993fd55305339fe933c44a005283505b0076d358a3395704f858`
  / `sha256:c38540cdaba49f1ee7bfb4a8418579c1108ee47ea762f9ea88ddcbc7c78dc6d8`.
- Document reader: `sha256:31317e92482af6ef75d8a19c5487f91f802b37448d4fc34704f39352819706a7`
  / `sha256:96c3b7fca577682e6550ca235116c987180907d1b06ce17be081e5370d3b7dc9`.

The root's existing read-only production transaction found no rows in
`catalog.component_release`, `catalog.application_binding`, or
`projection.application_runtime`; no platform binding or approved release was
withdrawn or activated here. The independent native service and prior login
remain separate facts. Runtime image references, credentials and native data are
unchanged. The running historical build keeps reading the unchanged lci worktree;
these source/manifest edits are held in the separate final Git index. Any later
artifact must be recorded against its actual frozen input, never relabeled as
this source revision without a matching build. Platform Web/Desktop/Gateway
artifact requirements are unchanged.

## Matching backend artifact — 2026-10-06

The existing credential-delivery and native model consumers above were already
implemented. This batch changes no application behavior: it builds the backend
from clean Apps commit `a2f2316bbf008923681af99d67e512b94829581e`, against original
WeKnora `2be7bd40631dda1dd485306038f07a62e9ee287e`, using the unchanged
`tools/build-upstream.sh knowledge-service` and native Dockerfile. Native UI and
document-reader are not rebuilt or re-attested. Their `none` digests remain.

Impact is limited to this backend artifact and its source receipt. Native DB,
identity, original complete UI, model rows, Core authority, quotas, permissions,
protocol/schema and the running independent deployment are unchanged. There is
no temporary credential, model, binding, shared administrator identity or relaxed
credential proof. Model delivery remains closed until its original frozen
generation and native proof consumers can receive actual controlled inputs.

The single original invocation completed with `BUILD_EXIT=0`, including image
export, registry push and source-record update. Actual outputs:

- Source digest: `sha256:2dbd78795c9ff1135e6e8d33e1d02a2d15ce7eb444dd2baf6bcaf8866b3cdc4e`.
- Registry artifact: `127.0.0.1:55000/knowledge-service@sha256:5771d363eba6eb9b12c474ee40ecbdb8398137aa55a8be357ce832e496558d6c`.
- Actual daemon image ID and registry RepoDigest both match that artifact digest.
- Original AnyDoc step completed in `240.8s`, main Go build in `1540.1s`,
  BrowserSkill step in `1076.9s`, and final OCI export in `112.7s`; these are
  individual concurrent stage durations, not a sum or end-to-end duration.

Execution used existing `kailo-core-data` BuildKit, actual 8 CPU / 16 GiB and
equal memory+swap, with original cache at
`/volumes/data/kailo/buildkit-core-state`. Available Data space initially measured
about 16 GiB, briefly approached 3 GiB and was about 5.5 GiB after export.
High I/O pressure slowed native layer installation. No cache was removed, no
second build was started, and no Cargo parallelism or original feature was
reduced. The root's separate failed full-check exit trap removed only its own
reconstructible source copy and released space; this is not a cache-cleaning
claim. Actual base layers, apt/pnpm/Cargo dependencies were downloaded, so this
was not an offline/cache-only build. A transient original AnyDoc rsproxy TLS
error was followed by that script's successful completion without restarting
the build. The final Dockerfile warning was `RedundantTargetPlatform`.

Original logs and bounded input facts are retained under
`/volumes/data/kailo/tmp/knowledge-backend-release-20261006.o3OhTi/`:
`build.log` (SHA256 `38f0dcd09b05196b22d0b82bd325b89597d843def56ed9922c0b35a3d926eb82`),
`build-knowledge-service.S0ivEf.log`, and `input-facts.md`.

Read-only inspection identified the actual running Compose directory as
`codex-knowledge-edge-20261006.hk1xfO/runtime/knowledge/fork/deploy`; its `.env`
has no `KNOWLEDGE_MODEL_DELIVERY_INPUT_FILE`, `KNOWLEDGE_MODEL_CREDENTIAL_FILE`
or `KNOWLEDGE_NATIVE_ADMIN_SESSION_FILE` entries. Filename-only inspection of
the existing controlled `deploy/local/secrets/knowledge-native` directory found
native application/OpenBao outputs, not those three model delivery objects.
This is a bounded observation, not a claim that no matching authoritative
object exists elsewhere. No credential content was printed or new native token
requested. The native app was still running historical image
`sha256:db4ec09f76ee61b403cc79cf56c131dbfb6810e473dc7fadb0fb21ff2f08a8c8`.

No deployment or live model initialization was performed. The existing operator
flow remains `provision.py model-reader` → original OpenBao Agent →
`provision.py model-delivery`, followed by the original directory/projection
readback. Build success is not native credential delivery, model inference,
ApplicationBinding activation, resources/tools access, full UI or MCP acceptance.
No full check or repeat application test run was performed in this artifact-only
batch; the original implementation tests retain their earlier evidence boundary.

### Subsequent single-service deployment and native login

After the artifact-only receipt above, the same registered backend was actually
deployed. This is a later result, not a reinterpretation of the earlier build.
The original live directory was
`/volumes/data/kailo/tmp/codex-knowledge-edge-20261006.hk1xfO/runtime/knowledge/fork/deploy`.
Its `compose.yaml`, `start.sh` and `native_entrypoint.py` matched the fixed
`a2f2316bbf008923681af99d67e512b94829581e` source byte-for-byte. The existing
environment file was backed up owner-only in the receipt directory; only
`KNOWLEDGE_APP_DIGEST` was changed to the registered `5771d363...` digest.
No secret value, tenant identity, model configuration or permission was replaced.

The existing `start.sh --platform-model /volumes/kailo/apps/deploy/local/.env`
completed with `DEPLOY_EXIT=0` (session 69205; original `deploy.log` in the
receipt directory above). It uses the original Compose app-only
`up -d --no-build --pull never --wait --no-deps app` path. Actual container
`kailo-knowledge-app-1` reads back the complete registered
`sha256:5771d363eba6eb9b12c474ee40ecbdb8398137aa55a8be357ce832e496558d6c`
image, `running=true`, `health=healthy`. Native PostgreSQL, Redis, frontend and
document-reader containers were not recreated. No second build, Core/Worker
restart, image pruning or shared-cache deletion was performed. These existing
frontend/reader containers still do not constitute matching-source artifact
acceptance for their current manifests.

A fresh Playwright session followed the original Chinese login page's OIDC
button to the existing Kailo IdP, used the existing ordinary bootstrap user's
controlled credential and completed the normal callback to
`/platform/knowledge-bases`. A normal authenticated `/api/v1/auth/me` read and
a subsequent browser refresh/read returned HTTP 200 and the original native
user `116a8d6b-c7cd-4abb-b6a4-1bd8589eda24`, tenant `10000`, active owner
membership and `systemAdmin=false`. This is native service ownership, not a
manufactured platform administrator or shared fallback identity. Browser tokens
were not printed or persisted to delivery files. The final screenshot
`native-sso-refreshed.png` was opened and inspected: it shows the original
Chinese knowledge-base page, its original navigation and empty native data,
without an onboarding overlay. Earlier `native-sso-knowledge.png` and
`native-sso-ready.png` retain the actual onboarding states. This verifies one
ordinary identity's native login and refresh, not all users or every UI action.

The newly deployed original model credential subresource was exercised in its
read-only verification mode for existing native model
`54b825a1-e74a-4e56-b691-59d7c0b6fb57`: a request containing only a random
verification nonce returned HTTP 200, nonce echo, `apiKeyConfigured=false` and
no proof. No credential PUT payload or inference request was sent. The original
MCP management GET returned HTTP 200 with zero existing endpoints; its original
tool catalog GET returned HTTP 200 with 12 entries. Catalog presence is not
an authorized MCP endpoint or successful AgentGateway tool execution.

The remaining delivery prerequisite was checked at the actual authority, not
inferred from missing files: an explicit read-only Core database transaction
returned zero rows in each of `catalog.component_release`,
`catalog.application_binding` and `projection.application_runtime`. Allowlisted
inspection of live Core environment also found both
`APPLICATION_ADAPTER_DIRECTORY_FILE` and
`COMPONENT_CONFORMANCE_ENVIRONMENT_FILE` absent or empty. No application
registration, approval, runtime generation or adapter directory was created by
this deployment. Consequently there is no existing binding's frozen
model-projection reader/nonce/serviceSecretRef to export into the three absent
`KNOWLEDGE_MODEL_DELIVERY_INPUT_FILE`, `KNOWLEDGE_MODEL_CREDENTIAL_FILE` and
`KNOWLEDGE_NATIVE_ADMIN_SESSION_FILE` inputs. Creating arbitrary files would
not establish those authority facts. This is not evidence of a missing remote
model-provider password, nor permission to reuse an unrelated credential.

The next existing path remains native endpoint setup, original component
registration/conformance/approval, controlled adapter-directory delivery and
the original binding/model projection, followed by the native OpenBao delivery
and credential proof described above. No fake release, binding, endpoint,
resource, session, default tenant or model key was introduced to make these
checks pass. Native login/deployment are now verified; governed tools/resources,
model execution, ApplicationBinding activation and complete three-service
integration are not. No full check was rerun in this deployment-only follow-up.

### Native prerequisites for the five-key knowledge adapter (2026-10-06)

This source-only increment implements two concrete gaps required by `DD-108`
and the knowledge contracts in `.design/07` §2.4; it is not an approved
Remote Adapter or an enabled AgentGateway endpoint. The existing native MCP
server remains the only MCP implementation. Its authenticated endpoint and
native knowledge repository remain the credential and document authorities.

The readonly upstream was rechecked at
`2be7bd40631dda1dd485306038f07a62e9ee287e`:
`internal/application/service/knowledge.go::GetKnowledgeFile`,
`internal/handler/knowledge.go::DownloadKnowledgeFile`,
`internal/application/service/knowledge_create.go::CreateKnowledgeFromManual`
and `internal/mcpserver/tools_ingest.go::Server.handleAddDocument` resolve at
that commit. The download already supports original file bytes and manual
Markdown; the MCP catalog did not expose it. Manual creation already owns its
row, metadata, processing task and status, but repeated MCP requests created
different documents.

The native `export_document` tool now consumes `GetKnowledgeFile` with the same
Editor requirement as the original download. It requires explicit endpoint
enablement; existing default tool lists do not acquire export access. It
rechecks the endpoint scope, Editor access and precise original `UpdatedAt`
after reading the original bytes. Concurrent revision changes, revoked access,
missing originals and the existing native file-size policy fail before a
successful result. The original native MCP settings have corresponding English
and Chinese tool descriptions; no replacement UI or second MCP server was added.

The existing `add_document` text path accepts an optional UUID idempotency key.
The authenticated native tenant and endpoint plus this key determine the original
document identity. `CreateKnowledgeFromManual` freezes an input digest inside
the original document metadata, reuses an identical row and rejects a different
KB or input under that identity. This server-only creation identity cannot be
injected through the public REST JSON payload. Native edits preserve the frozen
creation evidence; retrying the original request does not undo later edits.
Concurrent inserts converge on the original primary key and do not enqueue a
second task. Native soft deletion prevents recreation under the same key. URL
ingestion with this new text-only key is refused before dispatch; the existing
URL path without it is unchanged. Hard-purged documents and original native
processing recovery are not newly certified by this increment. Pending native
processing remains pending, not a successful platform operation.

Impact and boundary: no Core document body, new database, migration, quota,
workflow or registration authority is introduced. Existing callers without a
creation key retain their original behavior. Desktop/Web continue to consume
the original native service; Mobile hosting is not added. Tool allowlists and
native scope checks run before document access. Missing terminal evidence must
still become the platform's unknown/unavailable result in the forthcoming
adapter consumer; these MCP responses alone are not ActionExecution terminal
proof. The complete five-key HTTP adapter, conformance, release approval,
binding/model projection and AgentGateway execution remain unaccepted.

Implementation preceded the checks. In the existing native SDK
`kailo-knowledge-native-check-wkkigg` (4 CPU / 8 GiB, original Go 1.26.8 and
Data caches), the following command completed with exit 0:

```sh
GOCACHE=/cache/build GOMODCACHE=/cache/mod GOPROXY=off go test \
  ./internal/types ./internal/mcpserver ./internal/application/service \
  -run 'Test(DefaultMCPEndpointTools|MCPEndpointCapabilitiesForTools|ExportDocument|AddDocumentRetryKey|ManualCreation)' -count=1
```

Final output was `ok` for all three packages. The service case uses the existing
SQLite repository fixture, including actual creation, duplicate reuse, changed
input rejection, metadata-preserving edits and soft deletion. Private-SDK
mutations removed the export revision comparison and weakened the stored input
digest comparison: `TestExportDocumentUsesOriginalBytesAndEditorScope/changed`
and `TestManualCreationReusesNativeIdentityAndPreservesOriginalInput` both
actually failed, exit 1. Both SDK files were restored from formal source and
compared byte-for-byte (`cmp` exit 0), then the three-package command passed
again. No formal source was left mutated.

Original logs are in
`/volumes/data/kailo/tmp/knowledge-seed-handoff.UdwSmF/`:
`knowledge-native-adapter-seams-verified.log`,
`knowledge-native-adapter-seams-mutation.log` and
`knowledge-native-adapter-seams-final.log`. Earlier logs retain the read-only
SDK formatting failure and the corrected native repository not-found mapping;
these failures were not erased. No frontend build, image build, full check,
deployment, live document creation or model call ran for this increment.

## Native frontend frame ancestors (2026-10-07)

Authority: DD-87 and design `07` §4.6 at separately committed design
`b4f7d1971c95ffaae61d90e7c6dd8c4bb69e3f47`. The complete adapted native SPA
is displayed in Kailo's main content pane; its API authentication, native
authorization, database and MCP authority remain unchanged. This is a header
and deployment seam, not a replacement knowledge UI or a new identity system.

The existing frontend entrypoint consumes runtime `KAILO_FRAME_ANCESTORS`, a
space-separated exact HTTP(S)/Tauri origin list. It rejects credentials, paths,
wildcards, CSP injection and invalid ports before generating configuration.
Only the frame-ancestor policy and conflicting X-Frame-Options are changed;
empty configuration retains SAMEORIGIN and `frame-ancestors 'self'`. The original
nginx server, SPA fallback and static asset locations consume the same values;
the separate native embed-chat route keeps its original behavior. No schema,
business state, token transfer or second authorization authority was added.

Actual post-implementation validation mounted the new entrypoint/template into
the existing frontend image
`sha256:fe86075f63f92527715144b079141447b87005e8697ea5b353d736d4915bc0f4`,
with no network and a 1 CPU / 512 MiB cgroup. The test parent origins were
`http://kailo.example.test:58090` and `http://tauri.localhost` (fixtures, not
deployment defaults). `wget -S -O /dev/null http://127.0.0.1/` returned 200 and
the exact configured frame-ancestors, without X-Frame-Options; existing other
headers remained. A separate empty-config container returned 200, SAMEORIGIN
and self-only CSP. `https://host.example.test;script-src *` and port 65536 each
exited 78 with `Invalid KAILO_FRAME_ANCESTORS origin` / `port`, respectively.
Both running verification containers were stopped after the checks.

Failures are not omitted: the first direct-entrypoint container could not start
because the mounted source script is not executable (the image normally chmods
it); the verification invocation was corrected to `/bin/sh`. A later Tauri
scheme probe mistakenly invoked the startup entrypoint inside the already
running container; the second nginx process failed to bind its occupied port.
That exit 1 is not counted as a successful Tauri scheme HTTP check. No product
source workaround or authentication relaxation was introduced for either issue.

These are actual nginx/header checks, not a new image build, deployment,
browser screenshot, cross-site cookie or signed Windows acceptance. Desktop
native sessions and all complete component business flows remain unverified by
this increment. Web/Desktop host frame-src and shared content routing must ship
with the service configuration; adding a parent origin alone grants no access.

## Original Agent delivery crash recovery (2026-10-08)

The existing `fork/deploy/provision.py::adapter_reader` writes its original
AppRole ID, single-use wrapped SecretID and Agent HCL through `write_private`.
The old writer used one fixed `.pending` file with `O_EXCL`; process death before
replacement left that file behind and every subsequent operator delivery failed
with `FileExistsError`, even with correct, unchanged binding inputs. The same
writer is also consumed by the existing native/model delivery, not a new secret
store or component lifecycle.

Four-step impact and boundaries:

1. Authority remains DD-70/71/93 and the existing private Agent delivery contract.
   The reader still resolves existing namespace, KV, role and fixed SecretRef
   versions; it does not create platform identities, resources, bindings or
   native business credentials. Fixed OpenBao
   `735723da5628148f232497a48a35a137b6512103`,
   `internal/command/agent.go::AgentCommand.Run` (template namespace setup at
   lines 305–310, template server setup at line 692), was rechecked read-only:
   auto-auth namespace reaches the template consumer. No namespace workaround
   or shared root credential was added to the adapter.
2. All `write_private` call sites were inspected. Only that original writer and
   its existing post-implementation checks change; there is no contract, schema,
   migration, Workflow, page, API or four-language generated-type change. Linux
   is already the original deployment host. Web/Desktop/Mobile and the
   components' independent databases and entrances are unaffected.
3. A nonblocking lock on the existing directory serializes this writer across
   atomic replacements. A concurrent writer refuses without altering files;
   process death releases the OS lock. Recovery removes only the exact staging
   name when it is a single-link, current-UID, mode-0600 regular file. Symlinks,
   hardlinks and nonprivate staging files refuse and remain untouched. A failed
   write removes its own stage and preserves the old delivered file; successful
   replacement synchronizes both file and directory. No secret value is logged.
4. A crash residue converges on the next invocation of the existing delivery,
   before writing that original input; no queue, retry daemon, new authorization
   or persistent recovery state is introduced. Unsafe residue remains an
   explicit operator configuration failure, not a successful startup. Remote
   creation results, native side effects, UNKNOWN executions and receiver-owned
   synchronization state are unchanged.

Actual verification reused the existing `kailo-agent-receipt-xvkujx` SDK,
uid/gid 1000, actual cgroup `cpu.max=400000 100000`, memory and memory+swap
8 GiB, and its original Data-backed candidate/cache. The only two Python source
files were copied; no dependencies, complete tree or image were rebuilt.
Before execution, MemAvailable was 32,590,396 KiB, memory PSI avg10/60/300 were
zero, and existing build processes were checked. Data had approximately
294 MiB available.

In the original `knowledge/fork/deploy` input, the actual command was
`python3 -m unittest -v test_native_entrypoint`:

- `knowledge-adapter-reader-recovery-final.log`: exit 0, 29 tests, 0.955 s.
  The real `adapter_reader` runs against its existing isolated native management
  HTTP fixture with all three bootstrap `.pending` files present, then consumes
  their recovered original outputs. Additional checks exercise failed atomic
  replacement, unsafe staging, hardlinks and a held directory lock.
- `knowledge-adapter-reader-recovery-mutation.log`: private candidate removed
  the real stale-stage unlink. Both the actual `adapter_reader` and interrupted
  delivery check failed with `FileExistsError`; exit 1, two errors. The formal
  source was not mutated.
- `knowledge-adapter-reader-recovery-restored.log`: original source copied back
  and both files compared byte-for-byte, then exit 0, 29 tests, 0.962 s.
- `git diff --check` on the two source files exited 0. An initial host SHA command
  used brace expansion under `sh` and failed to find the literal brace path;
  rerunning with the three explicit existing paths produced the hashes below.

All three original logs are under
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/`:

| Log suffix | SHA-256 |
|---|---|
| `reader-recovery-final.log` | `274014c71632df25854a21ab0051d80b8561e7131720c35b7ff11d33ed36b289` |
| `reader-recovery-mutation.log` | `4a01fa6858d4c2fa33fb3f22b3533795f9f866b026db2e21af09156bba223e5f` |
| `reader-recovery-restored.log` | `16c85f5d600a575f4648300e616c5b2f327a531753a1230ff4f055b82632cb53` |

No actual operator credentials, AppRole or native data were changed. These are
the real provisioning consumer's isolated HTTP/filesystem checks, not live
OpenBao auto-auth, native MCP access, component release registration, binding
activation, full check, screenshots or deployment acceptance. Those gates remain
separate; an adapter process or configuration alone is not an active component.

## Full native UI artifact and independent frontend update (2026-10-08)

This increment retains the fixed WeKnora source
`2be7bd40631dda1dd485306038f07a62e9ee287e`. Its native
`frontend/src/views/knowledge/wiki/WikiBrowser.vue` and
`frontend/src/components/css/wiki-graph-drawer.less` were inspected read-only.
The original shared LESS file is still consumed by the original Wiki browser;
the native page's template, script, layout, controls and stylesheet declarations
are not replaced with a Kailo-specific page.

Four-step impact and boundaries:

1. Authority is the existing native UI preservation requirement, DD-87's
   component host boundary and the original source/artifact manifest. A frontend
   artifact or standalone service entrance does not authorize a component
   release, binding, native resource or tool. No platform configuration records
   or user/model credentials were invented to make the entrance appear active.
2. The only native UI source change moves the original graph drawer LESS
   reference from a separate external style block to an import inside the
   existing unscoped LESS block. Both native graph consumers retain the same
   stylesheet. The original build failed in Vue's external-style processing;
   this is a packaging compatibility correction, not a redesign or reduction.
   The original backend Dockerfile also gains cache mounts at its existing
   AnyDoc target and Go build cache. AnyDoc, BrowserSkill, original build tags,
   upstream version and Cargo parallelism remain enabled and unchanged.
3. Web/Desktop still use the existing component host; Mobile remains a
   non-host. No database, resource model, workflow type, schema, generated
   contract, permission authority, menu, CSP origin, CSRF policy or shared
   cookie is added or relaxed. The deployed backend, database, Redis and
   document reader are not restarted by this frontend-only operation.
4. Failed or unfinished builds are not matching artifacts. The old backend
   digest remains explicitly historical while current backend inputs build.
   Missing model credentials, embedding models and approved release/binding
   remain blocking gates; a styled page or HTTP 200 is not business acceptance.

The frozen release inputs are under
`/volumes/data/kailo/tmp/knowledge-main-release-20261008.wtyNzc/apps`, based on
`b7e2c621739edbc12ae1a1d7e042cff7bc7594f1` plus the exact source corrections
above. The original `tools/build-upstream.sh` and
`tools/upstream_manifest.py record` produced and recorded:

| Artifact | Declared source SHA-256 | Image manifest SHA-256 |
|---|---|---|
| `knowledge-adapter` | `4e399f3a95cd99ce83b3059bf29c6425f542f684c4482e226ccd20b15eb7e350` | `588c713c15b96b5adcab70c53b1cd106961d18cb484614d5e288755cd216fcf1` |
| `knowledge-native-ui` | `f6cf1238013fa17ffecaa1b1396a1b3ff71c512196d1c891f42604e6ab913438` | `dd0d8c706573854c6d07aecb8f2295aa3385071013e577eebe1fd446910cf31b` |

Both builds exited 0; the UI transformed 6,626 modules and Vite reported
`built in 51.13s`. Docker image readback independently matched both image
digests. An isolated read-only, network-disabled artifact inspection confirmed
both original `index.html` and `embed.html`, and the graph drawer selectors in
both emitted native consumer stylesheets. It did not execute a new backend or
claim a component tool call. Actual build logs in the release directory:

| Log | SHA-256 |
|---|---|
| `adapter-build.log` | `c880af55264c9fc444bdffaef3dd6f18f3a4d3ddd18ecbf91c55163ad45c67dc` |
| `ui-build-retry.log` | `cc2064e7c8427ed0fb3106871aed5827d78dd0e94ec009ea6f65bef1c352be84` |
| `ui-build-style-fixed.log` | `1c4b1c6cfedeec8245d5ab213c7dfa1f442a0ec69e70c33631957c3a2adf3ba0` |

Failures remain evidence. The preceding UI attempt exited 1 with
`[vite:vue] Cannot read properties of undefined (reading 'scoped')` for the
shared external LESS style; it is not counted as a pass. A preceding cancelled
attempt is likewise not a completed build. The original dependency install
reported 14 vulnerabilities (2 low, 3 moderate, 8 high, 1 critical), and three
unapproved dependency build scripts; this increment does not resolve those
release gates. The backend build is unfinished at this checkpoint. Although
existing local images and Data-backed caches were reused, it fetched uncached
base layers and Debian packages: it was not an internet-free build.

The existing deployed UI Compose environment received only the new
`KNOWLEDGE_UI_DIGEST`. Its existing entrypoint/proxy inputs compared unchanged
with the formal source. The original Compose command, with the existing private
environment file, ran
`up -d --no-build --pull never --wait --no-deps frontend` and exited 0.
Only the frontend was replaced. Before/after running-container records each
contain 68 containers; comparison of container IDs and images found one changed
entry, `kailo-knowledge-frontend-1`, while the other 67 IDs/images were unchanged.
Those records have SHA-256
`76f1a4cbf3f23c266e9cdae3f7c62c13cbe6753a02cecc5ca3b92633aa88a299`
(`containers-before-ui.log`) and
`71b0e08ad33bc2e6641abee26728c8a9ab869033592b9c9fa762bc110b32c112`
(`containers-after-ui.log`).

The new frontend container is
`f46e2a37f41bbb4c339bbb26afedaf1039bf86d662eb463fd325bcfd5992a328`,
started at `2026-10-08T20:10:30.187082568Z`. Both its actual image and requested
pinned image match the UI manifest digest above. The native entrance
`http://192.168.0.193:58094/` returned HTTP 200. This container has no Docker
health-check field; successful Compose wait and HTTP readback are reported
instead of inventing a health-check result.

The named `playwright-cli` session `knowledge-main-delivery` used the existing
normal SSO login, without injecting identity, cookies or storage state. After
the update it reloaded the actual service and preserved the logged-in native
user. The following screenshots were saved and individually opened for visual
review in `apps/.playwright-cli/` (filename prefix
`kailo-knowledge-updated-`, suffix `-20261008.png`):

| Screenshot middle | Actual state | SHA-256 |
|---|---|---|
| `models` | Original model management | `a31f4b4b3b017f7f430591c4e4abdc352b84cf7a46d42ea524ec2928486ab63d` |
| `list` | Original knowledge-base empty state and sidebar | `c17f4d31af33df531bd2a7fa19c68d94014241258a8d18f750edf2da1e951499` |
| `create` | Original knowledge-base creation dialog, cancelled | `1eb741807b8294c0d8316b6a6fe64e4f22bc51426e51cac5f699822be9cd87dd` |
| `agents` | Original built-in Agent presets | `5bb1d88ec0fe0f89655da1376e1b6278dd5b437fd3cd5881c48c30f1cccaf8ce` |
| `artifacts` | Original filters, search and empty state | `a4f2ddbf3481b3ad3f1a3e89bfb2fa853492682fd20da277223d8087d1b47347` |
| `shared` | Original shared-space entrance and controls | `630213907fcc033aff29bb4a2a8262eeee8ad79431e01cc69ba1391d0f04babf` |
| `chat-clean` | Original new-chat composer after normal guide dismissal | `d9ece9080b45369cef40c296a6f0fd53c48b2f68c8d287dd96e2bae839439b8e` |
| `general` | Original Chinese general settings | `83f94a58b53c13b7da34b5beb7ca1911769cc109be3ca2e7938db28ced5f127c` |
| `general-en` | English chosen through the original language control | `aabe4f90073c496ddbf8d986cbe372d5729dc6a14d499b931b71c5e9f35239ef` |
| `general-zh-restored` | Chinese restored through that same control | `54abf3e5fd138769e81f75e8be2848d38a761340d854b9da92dda347a8316fea` |

The browser console reported one informational autofocus message, zero errors
and zero warnings. Two initial automation actions failed (a duplicate Settings
close locator and a guide overlay intercepting the menu); normal visible
controls were used to dismiss the top dialog/guide before continuing. They are
not counted as successful actions or hidden by modifying the application.

These selected original page states retain actual layout, styles and controls;
they do not establish all-page or all-state equality, complete localization,
Windows/Mobile acceptance, iframe cookie/CSP/revocation acceptance, platform
Agent integration or a real knowledge-base ingestion/chat result. Native model
readback still lacks the required model API credential and any embedding model.
No chat was sent and no knowledge base, model, secret or component binding was
created. The adapter artifact is not deployed or activated. Full check and
production acceptance remain separate and are not declared passing here.

The later backend build did not complete. At approximately 20:29 UTC the root
agent terminated its exact verified buildx request after disk-I/O contention
held narrow mainline checks. The original log `service-build.log` retained
`ERROR: failed to build: failed to receive status: rpc error: code = Canceled
desc = context canceled`. No new backend digest was recorded or deployed, no
running application service was stopped, and existing caches were not pruned.
It will not be restarted in this source-integration checkpoint. This preserves
the live previous backend; it is not a successful matching backend build.

## Native import settings preserve receiver-owned recovery (2026-10-08)

This increment continues the fixed WeKnora source
`2be7bd40631dda1dd485306038f07a62e9ee287e`. The read-only original symbols are
`internal/application/service/datasource_service.go::DataSourceService.UpdateDataSource`,
`internal/application/repository/datasource_repo.go::DataSourceRepository.Update`,
`internal/handler/datasource.go::DataSourceHandler.UpdateDataSource`, and
`internal/types/datasource.go::DataSource`. The original frontend's
`frontend/src/api/datasource/index.ts::updateDataSource` accepts a partial
native data-source object; omitted connector type is therefore a real caller
shape, not an invented platform API.

Four-step impact and boundaries:

1. Authority is `.design/13` sections 3, 4 and 7: native import checkpoints,
   deduplication and deletion tracking belong to the receiving knowledge
   service. A settings request must not erase retained native write/delete
   evidence. No platform entity, workflow, permission authority, queue or
   component lifecycle is introduced; this does not make an inactive binding
   available.
2. The impact search covered every native `dsRepo.Update` caller and the
   separate `UpdateSyncState` path. Partial settings edits now canonicalize
   the connector type from the existing authorized native row before binding
   checks, credential filtering, config validation, persistence and scheduling.
   The settings repository excludes last-sync observations, creation and
   deletion columns from its actual SQL update, including when a worker has
   advanced after the service's read. The existing explicit false-value write
   for `sync_deletions` remains. Both settings and checkpoints retain the
   database-returned timestamp precision needed by the existing version fence.
3. A malformed or empty selected resource set cannot bypass the file-storage
   validator merely by omitting type. Forged or stale cursor/result fields
   cannot overwrite the worker's retained native references. The original
   `UpdateSyncState` remains the runtime write consumer; there is no second
   synchronization authority and no Core copy of source content. Web and
   Desktop continue using their existing component pages; Mobile does not gain
   a component host. No contract, schema or migration is changed.
4. Invalid configuration and missing native rows remain precondition failures;
   scope/permission failures remain denied. Concurrent worker checkpoints keep
   their original version-conflict behavior. Timeout or unknown native side
   effects remain unknown and are not replayed, cleared or turned into a
   successful import by this change. Quota/size limits and blocked component
   gates are unchanged. Native settings do not create a new recovery state,
   deadline or retry scheduler: retained intents still terminate only through
   the existing authorized observation/cancellation path.

The four source files are `internal/application/repository/datasource_repo.go`,
`internal/application/repository/datasource_repo_test.go`,
`internal/application/service/datasource_service.go`, and
`internal/application/service/datasource_service_test.go`. The added checks
follow the implementation. They exercise omitted-type valid and invalid
configs, attempts to supply runtime observations, a settings/worker interleave,
false `sync_deletions`, missing rows, and actual database timestamp readback.
The Cells implementation teammate reviewed the completed production change
against all existing runtime/settings consumers and found no additional
determinate issue; that review is not runtime verification.

`git diff --check` on these four source files exited 0. The original
`kailo-knowledge-native-check-wkkigg` SDK was checked running with its existing
4-CPU/8-GiB limit, read-only source mount and original Data-backed module/build
caches. The exact four changed files were synchronized to its existing private
candidate after the other connector files, `go.mod` and `go.sum` compared
unchanged. Its single narrow request runs the original `gofmt` on these four
files, then `go test ./internal/application/repository
./internal/application/service` with `GOPROXY=off` and the original module/build
caches. The selected names are
`TestDataSourceRepositorySettingsCannotOverwriteNativeRecovery`,
`TestDataSourceRepositorySyncStateRetainsTheCurrentNativeVersion`,
`TestDataSourceRepositoryUpdatePersistsDisabledSyncDeletions`, and
`TestFileStorageEditValidatesResourceConfigurationWithoutNativeCredentials`,
with `-count=1`. The formatter completed and the four read-only candidate inputs
compared byte-for-byte with formal source. The original request subsequently
exited 0, reporting:

```text
ok github.com/Tencent/WeKnora/internal/application/repository 6.343s
ok github.com/Tencent/WeKnora/internal/application/service 0.519s
```

After implementation and that positive result, only the existing private
candidate was deliberately damaged: the repository's column exclusion and the
service's omitted-type canonicalization were removed. The same two relevant
original checks ran with the same offline caches and `-count=1`, and exited 1.
The repository recovery check rejected the forged deletion/settings result;
the service check rejected two wrong persisted connector types and five invalid
omitted-type configurations that incorrectly returned no error:

```text
FAIL TestDataSourceRepositorySettingsCannotOverwriteNativeRecovery
FAIL TestFileStorageEditValidatesResourceConfigurationWithoutNativeCredentials
FAIL github.com/Tencent/WeKnora/internal/application/repository 0.507s
FAIL github.com/Tencent/WeKnora/internal/application/service 0.547s
```

Both private production changes were restored with no formal-source mutation.
All four candidate/formal files compared byte-for-byte before rerunning the
full original four selected checks. The restored request exited 0:

```text
ok github.com/Tencent/WeKnora/internal/application/repository 0.500s
ok github.com/Tencent/WeKnora/internal/application/service 0.531s
```

These are native service/repository checks, not a real cross-service import,
PostgreSQL acceptance, frontend screenshot, or production deployment. The
native handler's existing HTTP error envelope was not changed; this increment
does not claim that every native error has been mapped to the platform's six
error classes. No duplicate in-flight request was started.

The earlier concentrated `./tools/check-docs.sh` launcher subsequently exited
0; its log `docs-phase.log` under
`/volumes/data/kailo/tmp/knowledge-main-release-20261008.wtyNzc/` reports all
seven dimensions passing, including 277 closed design references and zero
markdownlint issues. That invocation preceded this receipt and does not verify
this newly appended section. The existing full check against committed
`dfc7a33835174bbaa9e43e0e335c2f12959edfeb` subsequently exited 2; its final
output was `Got socket error trying to find package test at https://pub.dev.`
It does not include these uncommitted source inputs and is not a passing
production gate. This increment has passed its targeted positive, production
damage and restoration checks; global acceptance, commit and deployment remain
separate and are not claimed at this checkpoint.
