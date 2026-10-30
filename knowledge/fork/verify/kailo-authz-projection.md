# 知识库：Kailo 授权投影（DD-164）

设计：design-authority `1c803580` 的 DD-164 (1)(3)(4)③⑧(9)（`69fb480e` 起，`1c803580` 补充：Tenant 成员默认可创建、owner 始终可编辑删除分享自有资源、TENANT 可授 WRITE、既有原生共享先采纳；合同 `e957b11b`），`07` §4.7.2 `share`、§4.7.4（schema 2、分享意图、收敛回执、撤员时的原生令牌、“schema 2 角色派生”）。

## 改了什么

| DD-164 | 实现 |
|---|---|
| (2) 只读 schema 2 | `kailo_directory_sync.go` 以 `?schema=2` 读取；`types/kailo_directory.go` 严格解析 `schema: 2`、`tenantCreate`、`workspaces[].create`、`shares[]`，schema 1 回应整体拒绝、保持上次状态。升级前已记录的 schema 1 快照按原语义继续用于登录（`ParseRecordedKailoMemberDirectory`），直到第一份 schema 2 快照应用。 |
| (3) 角色派生 | `KailoScope.NativeRole()`：管理员 → `admin`；有 Kailo `create` → `contributor`；否则 `viewer`。Workspace `role=ADMIN` → 该 Workspace 空间 `admin`。目录未交付前仍为 `contributor`。Tenant 成员默认可创建（Core 写 `tenant#creator`），普通成员不倒退。owner（知识库创建者）不论空间角色始终可编辑、删除、分享自己的知识库（服务端所有权路径与前端一致）；`viewer` 对他人知识库只读、不能新建。“新建知识库/智能体”入口按 `hasRole('contributor')` 呈现，服务端 `POST /knowledge-bases`、`POST /agents` 为 `g.Contributor()`。 |
| (4) 分享投影 | `kailo_share_projection.go`：`shares[]` 中 `knowledge_base` → `WORKSPACE` 主体为只含该 Workspace 空间的 Kailo 管理组织（`organizations.kailo_share_ref = workspace:<id>`），`TENANT` 为 Tenant 组织；`READ`/`WRITE` → `viewer`/`editor`（`TENANT` 亦可 `WRITE`）；行带 `kb_shares.kailo_resource_ref`。只撤去 Kailo 管理行中已不在快照的 Resource 的行；原生行（`kailo_resource_ref` 为空）从不被投影删除。逐人授予（非 owner 的 `PRINCIPAL`）与已删除的知识库记为回执失败项 `SUBJECT_NOT_SUPPORTED`、`NATIVE_OBJECT_MISSING`。迁移 `000111`（Postgres）/`000030`（SQLite）。 |
| (4)⑧ 既有共享采纳 | 收敛 `shares[]` 前，Kailo 组织（Tenant 组织、Workspace 共享组织）上尚未受管的原生共享按知识库逐个 `POST .../share-adoptions`：owner 取创建者的 Kailo 身份，创建者不在目录时取共享人，仍无则记 `OWNER_NOT_MEMBER`；viewer→`READ`、editor/admin→`WRITE`；Workspace 空间的知识库带 `workspaceId`。得到确定回应且回读一致（新建 Resource 时授予表须与请求相同）后才把行标为该 Resource；Core 拒绝（4xx）记 `ADOPTION_REFUSED`、回读不一致记 `ADOPTION_MISMATCH`，行保持原样；回应不确定（5xx、超时）时本次不收敛、不记录快照、回执 `FAILED`，下一次读取重来。指向非 Kailo 组织的共享不被映射也不被触碰。本次采纳的 Resource 在下一份含它的快照到来前保留其行。生产验收知识库“r-accept-星河兰花温室”（共享给 Tenant 组织、仅查看）的场景由 `TestKailoDirectoryKeepsTheAcceptanceKnowledgeBaseShare` 复现：先不确定不收敛，再采纳为 `TENANT READ` 并保留，随后含该 Resource 的快照收敛后仍在。 |
| (4)② 分享入口 | `POST /api/v1/kailo/share-intents {knowledgeBaseId}`：知识库在调用者当前空间、调用者为空间管理员或创建者（不论空间角色）、空间是 Kailo 映射空间时，以目录 client 身份调 Core `share-intents`（`nativeType=knowledge_base`，Workspace 空间带 `workspaceId`），返回 `intentId`。设置弹窗“共享”页在 Kailo 模式下改为 `KailoShareEntry.vue`，把意图交给 `window.KailoEmbed.requestShare`（运行时缺该接口时提示在 Kailo 中打开）。原生 `POST/PUT/DELETE /knowledge-bases/:id/shares` 在 Kailo 模式下 403 `KAILO_MANAGED`。 |
| (4)⑥ 回执 | 每次应用（或应用失败、Tenant 不符）后 `PUT .../receipt`，同一份 `APPLIED` 回执不重发；回执失败不阻断同步；失败项持久在 `kailo_member_directory.receipt_failures`，重启后版本未变也能补报。 |
| (9) 显示名 | 目录同步以目录 `displayName` 刷新用户名与头像；登录时若此人在已应用目录中，不再用 IdP `name` 覆盖。 |
| 撤员令牌 | 撤员沿用既有路径：移出全部映射空间并吊销其全部原生会话（`RevokeTokensByUserID`）。WeKnora 的 API key 是空间级机器凭据（`tenant_api_keys` 无用户字段），不属于个人，不随撤员吊销。 |

## 验证（CI 节点，golang 1.26.8 容器，分支提交）

- `go test ./internal/types/ ./internal/application/access/ ./internal/middleware/ ./internal/router/` 全部 `ok`。
- `go test ./internal/application/service/`：本分支新增与改写的 Kailo 用例全部通过（含采纳、验收知识库保留、拒绝/不确定/owner 不在目录与所有权用例）；整包唯一失败 `TestQueryEmbeddingConsumesManagedKBScope` 在基线 `cc68544d` 上同样失败（`feat/authz2-weknora` 上整包结果相同）（SSRF 白名单全局状态的用例顺序依赖），与本改动无关。
- `go build ./internal/container/`（装 `libsqlite3-dev` 后）通过，依赖注入接线可编译。
- 前端（`node:22-alpine`，`npm ci`）：`vue-tsc --build` 无错误；`vite build` 成功（需 `NODE_OPTIONS=--max-old-space-size=6144`，默认 2 GB 堆在 vite 打包时溢出，与本改动无关）；`tsx --test src/kailo/*.test.ts` 47/47 通过（含 `share.test.ts` 4 项）。
