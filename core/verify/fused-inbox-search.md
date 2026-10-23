# DD-138 第二阶段：组件通知并入收件箱、组件内容作为搜索来源（验证记录）

设计依据：design-authority `95ee06dca`（`.design/03` ComponentNotification、ExecutionConnector.search_source；
`.design/07` §4.8.3、§4.8.4、§5.2；`02` DD-138(9)；`16` V-SCN-227、V-SCN-228）。
能力记录：`tools/traceability/component.fused_inbox_search.yaml`。

## 源码范围（Core）

- `identity.component_notification`（迁移 `20261026030000_component_notification`，down 删表；
  回滚须与停用投递入口的 Core 一同发布，旧条目只是提醒，组件仍持有业务事实）。
- 服务面投递 `POST /service/v1/component-notifications/bindings/{binding}/notifications`：
  与成员目录同一认证（`component_directory::authorize`），另要求 `KAILO_EMBED`；接收人/触发者按目录范围
  解析（Workspace binding 再做 SpiceDB `discover`）；同 binding 咨询锁内做幂等（同摘要 200、异摘要 409）
  与 60 秒限流（`COMPONENT_NOTIFICATION_RATE_PER_MINUTE`，默认 600，超限 429）；不建 ActionExecution。
- BFF：`GET /api/v1/inbox/component-notifications`（只列 binding 仍 ACTIVE 且本人仍可 discover 的条目，
  90 天内，倒序分页与未读数）、`POST /api/v1/inbox/component-notifications/read`（本人已读）、
  `POST /api/v1/search/components`（`searchSource=SUPPORTED` 的 REMOTE_ADAPTER 扇出，逐 Resource
  fresh `read`，60 秒 Search Token，5 秒超时，来源整体采信或标为 UNAVAILABLE）。
- 发行登记：`executionConnector.searchSource` 可选，`SUPPORTED` 只接受 REMOTE_ADAPTER。
- 保留：发布对账节拍内按批删除 90 天前条目；Tenant 删除同删。

## 组件与客户端范围

- 云盘（`file-storage`）：投递 SHARED（Cell/工作区 ACL 给到个人）、COMMENTED/MENTIONED（评论与 `@登录名`，
  只发给能读该节点的人）、CONTENT_UPDATED（关注者，按父目录 60 秒聚合，覆盖上传完成）、TASK_COMPLETED
  （本人 ≥30 秒的后台任务）；Kailo 模式下铃铛与活动收件箱、邮件通知偏好、摘要邮件与分享邀请邮件均下线
  （服务端 mailer REST 拒绝用户触发的通知邮件）；adapter `search` 按 binding 根下文件/文件夹名检索。
  证据：`file-storage/fork/verify/native-identity.md`。
- 知识库（`knowledge`）：投递 SHARED（知识库/智能体新分享）、TASK_COMPLETED（≥30 秒且未被停止的问答）；
  Kailo 模式下不再轮询邀请数、不显示加入申请角标，⌘K 只保留新对话、知识库列表、智能体；adapter `search`
  只检索 binding 绑定的知识库。证据：`knowledge/fork/verify/member-directory-sync.md`。
- 问数（`data-query`）：`kailo_user` 增加 issuer/subject（knex 迁移 `20261024000000_kailo_user_identity`，
  可回滚）；新增「分享给成员」（对话与看板，SHARED）、问题被加入看板时通知提问人（CONTENT_UPDATED）、
  定时刷新失败通知管理员（TASK_COMPLETED）；adapter `search` 检索对话与看板项。证据：
  `data-query/fork/verify/kailo-embed-integration.md`。
- Kailo Web/Desktop（`client-kit`、`web-client`、`collaboration/desktop`）：收件箱组件通知行（全部/提及/需要处理）、
  打开即标已读并深链 `/applications/{binding}?path=…`、设置「通知」按类别提醒开关、「搜索全部」组件结果分组。
  证据：`web-client/fork/verify/web-surface.md`、`collaboration/fork/verify/desktop-client.md`。

## CI 记录（CI 节点 NVMe 暂存，提交 SDK 镜像 `local/kailo-check:7c1a6a13…`，2026-10-23）

| 范围 | 提交 | 结果 |
|---|---|---|
| `check.sh lint`（cargo fmt、clippy、gofmt、go vet、pnpm typecheck、web tsc、dart analyze） | `57b3de54` | 全部 PASS |
| `check.sh migrate+verify`（临时 PostgreSQL 16.15，迁移前进/回退/再前进、枚举漂移；cargo test 716 通过 / 63 ignored、go test、pnpm -r test 135 文件 1808 用例、web vitest 47 文件 714 用例、dart test） | `9a487a80` | 全部 PASS |
| 数据库测试（ignored）：`component_notification::storage_constraints_and_retention`、`component_directory::facts_read_only_active_humans_of_the_binding_scope` | `9a487a80` | 两项 ok（同批过滤到的其他 ignored 测试缺各自专用环境变量，与本批无关） |
| `check.sh contract` | `f78a9d3e` | PASS（四侧生成物同步） |
| `check.sh trace` | `2338c44f` | 本批项 PASS（实体 91 全部归属、注册表一致）；失败项为 design 8fc2abb4 第五轮裁定的 DD-142–148 与 V-SCN-232–237 未归属、其 `<owner>` markdownlint，以及暂存无 `dist/` |
| `check.sh seam/supply/security` | `f78a9d3e` | 失败均为暂存环境缺 `.references` 上游基准、`dist/` 与外层 GitNexus ignore，与本批无关 |
| 云盘 Go（`common/auth`、`frontend/web/...`、`broker/activity|mailer|chat/...`：gofmt、vet、test） | `bfaa9b14` | 全部 ok |
| 知识库 Go（build、vet；`internal/config|application/service|mcpserver|handler/session` test） | `57b3de54` | 全部 ok（`TestQueryEmbeddingConsumesManagedKBScope` 只在走下载代理时失败，无代理通过，与本批无关） |
| adapter `node --test`（知识库 368、云盘 2545 用例） | `57b3de54` | 全部通过（main 基线 362、2534） |
| 问数 wren-ui jest `src/kailo*`（7 套件 87 用例） | `f78a9d3e` | 全部通过；`tsc` 唯一报错在未改动的 `nativeQueryDelivery.test.ts` |
| 知识库前端 `surface.test.ts`（tsx --test） | `f78a9d3e` | 9/9 |
| Desktop `tsc` | `9a487a80` 与 main `e8a47a74` | 两者同为 55 条（均因暂存环境缺 `@tauri-apps/*` 依赖），本批无新增；Desktop node 测试同因缺依赖未能执行 |

## 未验证与边界

- 未构建镜像、未部署、未执行生产迁移，未做 qa-1/2/3 业务验收与同屏截图。
- 生产当前只有原生页入口 binding（ExecutionConnector=NONE），按 `07` §4.8.4 不贡献搜索结果；需登记带
  `searchSource=SUPPORTED` 的 REMOTE_ADAPTER release 并建立 binding 后才有组件搜索结果。
- 云盘前端 JS（铃铛、分享邮件入口）与 Desktop 原生通知点击只做了源码级检查。
