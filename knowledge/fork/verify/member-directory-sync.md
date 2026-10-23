# Kailo member directory sync (DD-133(4), source stage)

## Authority

- `.design/02` DD-133(4) and `.design/07` §4.7.4: the read contract and the
  WeKnora mapping table (design-authority `1bd1d4771326b64b79ecb2e99a8cf53738264fb0`).
- Wire contract: `contracts/api/component_member_directory.schema.json`
  (Core: `core/crates/platform-core/src/component_directory.rs`).
- Shared component rules (the same for Cells and Wren): binding id, own
  directory client, release-written credential file, Core service origin,
  interval 10–3600 s (default 60); any failed read changes nothing.

## Mapping implemented (07 §4.7.4 WeKnora table)

| Kailo | Native | Rule |
|---|---|---|
| Tenant | space `kailo_scope_ref = "tenant:<Tenant id>"` + organisation `kailo_tenant_ref = <Tenant id>` | Space and organisation names follow the directory `tenant.name`. Every member of the snapshot is a member of the space. |
| Workspace | space `kailo_scope_ref = "workspace:<id>"`, `editor` member of the Tenant organisation | Every Workspace in `workspaces[]` gets its space (also with no member yet). Names follow the snapshot. Spaces of vanished Workspaces are kept, but their members are removed. |
| Tenant `ADMIN` | `admin` of the Tenant space and of every Workspace space | Never `owner`, never system administrator. |
| Tenant `MEMBER` | `contributor` of the Tenant space and of their own Workspace spaces | A Workspace-level `ADMIN` does not raise the native role. |
| Not in the snapshot | — | Every mapped membership is removed (soft delete, audited as `kailo-org-sync`), and every native session of the person is revoked. The account and its knowledge stay. |

- **Pre-provisioning**: for every identity whose `issuer` equals the configured OIDC issuer and has no account yet, an account is created with the same shape as a first OIDC login:
  - no personal space, OIDC-only login, random unusable password;
  - username = Kailo display name, then `<name> (<8 hex>)`, then `kailo-<digest>`;
  - avatar = directory `picture`.
  The directory carries no email (07 §4.7.4), so the unique, required native email column gets the reserved placeholder `kailo-<32 hex of sha256(iss\0sub)>@directory.kailo.invalid` (RFC 2606). The first login replaces it with the OIDC email only if `email_verified=true` (07 §4.7.3).
- **Other issuers**: identities of other issuers are ignored. An identity reserved by a deleted account is skipped with a warning rather than blocking the snapshot.
- **Role changes**: a role change (for example a demotion) takes effect on the next request, because `middleware/auth.go::resolveTenantRole` reads `tenant_members` every time. Only removals revoke sessions, which is the design's "移出时撤销该人全部组件会话".

## Rules

- **Read** (`internal/application/service/kailo_directory_sync.go`):
  - Runs on start and every interval, one read at a time, from the dig-started `KailoDirectorySyncRunner`.
  - Token: `POST` to the token URL with `grant_type=client_credentials` and HTTP Basic auth. The secret file is read per request (≤4 KiB, so rotation needs no restart). No proxy, no redirects, 10 s timeout. Only `200` with a Bearer `access_token` is accepted.
  - Directory: `GET <core>/service/v1/component-directory/bindings/<binding>/members` with a Bearer token, no redirects, 30 s timeout, response ≤16 MiB.
  - Any of the following changes nothing and keeps the last applied state, logging a category only (never a token, credential or body):
    - a non-200 status (503, 401, 403, 404);
    - a transport failure;
    - a JSON or contract mismatch (strict parse, unknown fields refused: `types.ParseKailoMemberDirectory`);
    - another `bindingId`;
    - a `tenant.tenantId` other than `KAILO_TENANT_ID`.
- **Apply** (`kailo_directory.go::ApplyDirectory`):
  - An unchanged `directoryVersion` for the same binding is a no-op.
  - Otherwise every membership is reconciled under the projection's mutex, with idempotent per-person transactions shared with the login path (`syncLocked`).
  - The snapshot row (`kailo_member_directory`: versioned migration 000110 / sqlite 000029) is written only after everything succeeded. A failure leaves the old version, and the next interval redoes the whole snapshot.
- **Login** (`user.go::LoginWithOIDC`):
  - With the directory configured and a snapshot recorded for that binding, the membership comes from the snapshot.
  - An identity outside it is refused with `Success=false` and the fixed message, before any account is created.
  - With no directory configured, or none applied yet, the login keeps the previous behaviour (contributor, no administrator).
  - The recorded snapshot survives restarts.
- **Deployment**:
  - The native env keys `KNOWLEDGE_DIRECTORY_{BINDING_ID,CLIENT_ID,CLIENT_SECRET_FILE,TOKEN_URL,CORE_URL}` (plus the optional `_INTERVAL_SECONDS`) must be given together; anything else is refused by `start.sh`.
  - When they are present, `start.sh` overlays `compose.member-directory.yaml`:
    - app joins `KNOWLEDGE_ADAPTER_PLATFORM_NETWORK` (Core's service listener);
    - the credential is a compose secret at `/run/secrets/kailo_directory_client_secret`.
  - `native_entrypoint.py` validates the in-container `KAILO_DIRECTORY_*` group: binding UUID, dedicated client id, URLs, interval, and a private non-empty regular file. The credential never enters the environment.
  - The release writes the credential file (0600, owner uid 1000 = the image's `appuser`).

## Verification (CI node 10.203.193.2, ubuntu, containers, no sudo)

The script is `~/dirsync/knowledge-test.sh <sha> [pkgs] [run]`. It does the following:

1. Takes a `git archive` of the pushed commit.
2. Runs in the builder image of `docker/Dockerfile.app`, `golang@sha256:a688600c…`. Like the Dockerfile, it installs `libsqlite3-dev`, then runs as uid 1000.
3. Runs `gofmt -d` on the changed Go files.
4. Runs `go vet` and `go test -count=1` for `./internal/application/service ./internal/config ./internal/types ./internal/database ./internal/container`.
5. Runs `python3 -B -m unittest test_native_entrypoint` in the CI check image, with no network.

Raw results at `db11af23a757e282d820325e87ad1b832f8273c5`:

- gofmt: no diff. `go vet`: exit 0.
- `go test`:
  - `internal/config`, `internal/types`, `internal/database` (SQLite migration version 29 with the new table) and `internal/container`: `ok`.
  - `internal/application/service`: one failure, `TestQueryEmbeddingConsumesManagedKBScope` (`knowledgebase_search_fanout_test.go:888`, the model-delivery embedding call). Baseline (2026-10-23, CI node NVMe `~/scratch/dirsync-knowledge`, same golang image, ubuntu, no sudo): run alone it passes on main `04e4665e` and on this branch `afe2408d`; in the full-package run it fails identically on both (main: 2710 PASS + this one FAIL; branch: 2716 PASS + this one FAIL). It is a pre-existing order-dependent failure of main, not introduced by this branch.
  - Every Kailo test passes: the new `kailo_directory_test.go` and the existing `kailo_org_test.go`.
- Python: `Ran 40 tests … OK`. This includes the new directory-group entrypoint test and the `start.sh` overlay test.

New tests:

- `TestKailoDirectoryPreProvisionsMembersRolesAndWorkspaces`: pre-provisioning, other issuer ignored, Tenant admin is admin of every Workspace space, member/Workspace-ADMIN mapping, no owner or system admin, organisation spaces, recorded version, an unchanged version is not reapplied.
- `TestKailoDirectoryFailuresKeepTheAppliedState`: 503, 401, broken JSON, unknown field, other binding, other Tenant, missing fields and a refused token all leave the version and roles unchanged.
- `TestKailoDirectoryRemovesDemotesAndRenames`: removal revokes sessions and keeps the account; demotion; Workspace rename.
- `TestKailoLoginFollowsTheAppliedDirectory`:
  - before delivery, the login is a contributor;
  - the first snapshot removes an earlier login that is not in it;
  - the admin keeps the role across logins, and the verified email replaces the placeholder;
  - a non-member is refused and no account is created;
  - a restarted projection follows the recorded snapshot;
  - a snapshot of another binding is ignored.
- `TestParseKailoMemberDirectoryIsStrict`, `TestKailoDirectoryDisabledRunnerDoesNothing`, `internal/config` `TestKailoDirectoryEnvIsOneGroup` / `TestKailoDirectoryUnsetIsNotDelivered`.

## Not accepted yet

None of the following has been done:

- image build;
- deployment;
- a real IdP directory client;
- a binding re-registered with `--directory-client-id`;
- a live Core read;
- three-person business acceptance (admin → native admin, removal → sessions gone).

Postgres migration 000110 has not been run against a real database in this batch.

## DD-138 第二阶段：通知投递、⌘K 收口与统一搜索（2026-10-23，源码阶段）

依据：DD-138(4)/(5)，07 §4.8.1、§4.8.3、§4.8.4、§5.2；契约 `contracts/api/component_notification_delivery.schema.json`、`contracts/adapter/protocol.v1/search_*.schema.json`。

### 改了什么

- 通知投递（组件 → Core）：`POST {core_url}/service/v1/component-notifications/bindings/{binding}/notifications`，令牌复用成员目录 client（client-credentials、同一 token URL 与密钥文件）。启用条件与目录同一组配置（Kailo 模式 + 五项目录配置齐全），否则全部 no-op。
  - `internal/application/service/kailo_service_token.go`：目录读取的取令牌代码抽出为共享函数（目录读取仍每次新取，行为不变）；通知侧缓存到 `expires_in` 前 30 s，401/403 时作废并重取一次。
  - `kailo_notify.go`：有界内存队列（4096，满则丢最旧并按计数告警）+ 后台 worker（4 并发）；201/200 完成，400/404/409 及重取令牌后的 403 不重试，429/5xx/网络错误同键同体退避重试（共 5 次，约 3.7 分钟）。日志只含 binding、category、HTTP 状态。投递前按契约自检（键字母表与长度、标题/摘要长度与控制字符、路径规则、actor≠recipient）。
  - 事件 SHARED：新建知识库共享（`kailo_notify_share.go` 以 dig `Decorate` 包装 KBShareService，上游代码不改）；接收人 = 目标组织各成员空间的 active 成员，排除共享人与来源空间成员（他们原本就能用），最多 2000 人；只对 users 表中有 OIDC iss/sub 且 active 的人投递。键 `weknora.kbshare.<sha256(shareId,iss,sub) 前 40 位>`；路径 `/platform/knowledge-bases/<kbId>`。已存在共享的权限变更不重复通知。智能体共享同理（`weknora.agentshare.*`，路径 `/platform/agents`）。
  - 事件 TASK_COMPLETED：`completeAssistantMessage`（普通与 Agent 模式唯一完成出口）调用 `internal/handler/session/kailo_notify.go`；仅当回答耗时 ≥ 阈值（默认 30 s，`kailo.long_answer_notify_after` / `KAILO_LONG_ANSWER_NOTIFY_SECONDS`）、非用户停止（停止处理器空 query；Agent 取消分支加 stopped 标记）、渠道为 Web 时通知提问人。标题「知识库问答已完成」，摘要含问题摘录（≤60 字）；键 `weknora.answer.<sha256(messageId,iss,sub)>`；路径 `/platform/chat/<sessionId>`。
  - 邮件：代码中无 SMTP/邮件发送实现，无需关闭。
- 原生提醒面：Kailo 模式下 `stores/auth.ts` 的 `fetchPendingInvitationCount` 直接置 0 返回（App 轮询与 WorkspaceOnboarding 均不再请求）；`components/menu.vue` 隐藏组织“待审批加入申请”角标并不再为它拉取组织列表。邀请铃铛此前已 `v-if="!kailoMode"`。
- ⌘K：`kailo/surface.ts` 改为 Kailo 模式白名单 `KAILO_PALETTE_COMMANDS = new-chat / open-kb-list / open-agents`；移除组织、设置、产品引导以及今后上游新增的跨产品命令。知识/会话/智能体搜索分组不变；检索设置抽屉仍仅管理员可见（DD-138(6) 第三阶段迁移）。
- 统一搜索（Core → adapter）：`adapter/src/search.mjs` + `query-revision.mjs` 路由 `POST /platform-adapter/v1/search`；Origin/Cookie → 403；`searchArguments` 400、`verifySearchToken` 401；只在 resources[] 指向本 binding 知识库（nativeId = nativeKnowledgeBaseId 且 nativeType ∈ {knowledge_base, knowledge.base}）时检索，其余忽略。用原生 `list_knowledge_bases`（名称命中 → KNOWLEDGE_BASE）、`search_knowledge`（限本库）与 `read_document metadata_only`（标题）；每文档一条 DOCUMENT，摘要 ≤200 字，路径 `/platform/knowledge-bases/<kb>?knowledge_id=<doc>`。无 PEP、无 ActionExecution。
  - 原生 MCP 端点对绑定端点的每次调用都要求 Core PEP 证明；搜索没有 ActionToken，故新增 `internal/mcpserver/platform_search.go`：proof 的 operation 为 `search` 时，原生端用 adapter 交付的 JWKS 独立校验 Search Token（ES256、iss/aud、≤60 s、token_use、tenant、binding、请求体哈希、无 Agent/委托/目标类声明），且只放行本库的 `search_knowledge`（query 与请求一致）、`read_document metadata_only`、`list_knowledge_bases`。
  - `fork/release/manifest.json` 的 `executionConnector` 增加 `"searchSource": "SUPPORTED"`，其余字段未动。

### 测试（已编写，未在本机运行）

- Go `internal/application/service/kailo_notify_test.go`：httptest Core 桩覆盖 201/200/409/400、403 重取令牌一次后终止、401 重取后成功、429 同键同体重试、503 五次后放弃；令牌缓存；契约字段；接收人（排除共享人、来源空间、停用、无 OIDC 身份、暂停成员）与 actor；长回答阈值与未知用户；非 Kailo 模式 no-op；队列满丢最旧；路径/文本/键校验；共享装饰器只通知新共享。
- Go `internal/mcpserver/platform_search_test.go`：Search Token 只放行只读工具与本库，且不调 PEP；binding/tenant/token_use/哈希/时长/过期/aud/iss/action 声明/resources/签名错误均拒绝。
- Go `internal/config/kailo_test.go`：`TestKailoLongAnswerNotifyAfter`。
- Node `adapter/test/search.test.mjs`：有效请求结果与路径、limit、resources 不属本 binding 时不触达原生、401 各类令牌、400 请求体、Origin/Cookie 403、路径与摘要清洗。
- 前端 `kailo/surface.test.ts`：⌘K 白名单（含未来上游命令被排除）。

### 尚未验证

- 以上测试均未运行（本机不编译不测试），待 CI 节点 `go test ./internal/...`、`node --test`、前端 `tsx --test`。
- 无镜像构建、部署、真实 Core 通知接口与 Search Token 联调；Core 为知识库 Resource 下发的 nativeType 实际取值未核实（已兼容 `knowledge_base` 与 `knowledge.base`）。
- 无三人业务验收（共享通知送达、长回答通知、⌘K 与提醒面在嵌入页中的表现）。
