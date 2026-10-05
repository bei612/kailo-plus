# Independent knowledge service: identity delivery and MCP boundary

This candidate is not an approved `KNOWLEDGE@v1` implementation, an active
ApplicationBinding, or an exposed Kailo Tool. It does not modify Core/contracts,
the current component integration tree, live configuration, or native data.

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
