# 原版 Agents 团队、快照与目录（DD-131，源码候选，未验收）

本记录对应分支 `feat/agent-teams`（起点 main `9f66b7358`）。权威：`.design/02` DD-131(1)–(9)、
SF-BUZ-60、DD-42、DD-125(4) 修订；`.design/03` §3（TransferFormat、ExportPackage）、§5（resource
的 discoverer/reader 允许 `tenant#member`）、§7（AgentTeam）；`.design/05` §2.3、§2.12；
`.design/06` §5、§7.1；`.design/16` V-SCN-180..185；`.design/17` §8。本批只交付源码与在 CI 节点检查
镜像内的检查，没有构建、部署或业务验收，V-SCN-180..185 不记为验收通过。

## 权威、影响与异常

- 团队：平台核心 ResourceType `agent.team`（Tenant 级、HUMAN owner、`application_binding_id=NONE`、
  经 `tenant.delete` 销毁链删除），扩展表 `catalog.agent_team` 只存名称、说明与有序成员（同 Tenant
  AgentDefinition、去重、至多 64 个，库内守卫拒绝重复与跨 Tenant 成员，`DELETED` 墓碑不可改写）。
  原版团队级 instructions、内置 welcome 团队、`teams.json` 与 kind:30176 不进入运行链。
- 动作（05 §2.12，全部只接受 HUMAN 发起，没有 Delegation 消费者）：`agent.team.create/update/delete/
  share/unshare`、`agent.definition.share/unshare` 为 SYNC/EXPLICIT；团队写入 fresh 核对发起人对每个
  成员的 `read`；`update` 按 Resource 版本 CAS 并在准入事务内完成；`delete` 先写墓碑再删除目录授予。
  分享只写入或删除该 Resource 的 `discoverer`/`reader` 对 `tenant#member` 的关系，先持久化 UNKNOWN
  意图再写 SpiceDB，写后 FullyConsistent 读回；结果不明保持 UNKNOWN，由对账以同一冻结意图重写并查证。
  分享不授予或撤销任何 Installation 使用权。
- SpiceDB 投影核对：通用 Resource 投影接受定义/团队上的目录 `reader` 授予；原生 Tool 投影仍拒绝它
  （`spicedb::tests::native_tool_projection_requires_every_member_grant_of_its_own_tenant`）。
- 导出：`agent.definition.export`（TARGET_OWNER）与 `agent.team.export`（ALL_AFFECTED_OWNERS：团队与
  各成员定义的 owner）经 owner 审批（允许 owner 自批，但须显式决定），请求时冻结 owner 与版本；批准后
  的重新准入冻结确切成员版本，`ComponentTaskWorkflow(kind=RESOURCE_EXPORT)` 由 Core 生成包：
  ExportPackage 是被导出 Resource 下的 Asset，owner 为发起 HUMAN，只在 READY 且 fresh `read` 时可
  下载。清单沿原版 v1 形状（JSON 或 PNG tEXt），Kailo 可移植字段在 `kailo` 扩展段；不含 owner、公钥、
  Installation、绑定、`llm_route`、RuntimeProfile、Delegation、记忆、SecretRef 或密钥值。头像只在其 URL
  指向内容寻址媒体且不超过 2 MiB 时由 CONTROL 读取并内联。
- 导入：上传 `POST /api/v1/agent-snapshots/uploads` 只建立本会话暂存（30 分钟），解析原版 v1 包并给出
  映射预览与被丢弃字段；`agent.definition.import`/`agent.team.import` 只接受同一 PlatformSession 的上传，
  重算 digest，由导入人选择本 Tenant 的 RuntimeProfile 与模型路由，在准入时按草稿创建同一规则预检全部
  成员；`RESOURCE_IMPORT` 在一个事务内创建全部 Definition、DRAFT Version（与新团队），任一成员非法则
  没有任何新对象；成功后清空暂存字节。旧 `.persona.*`、zip、锁定卡与 v1 以外的格式拒绝，上限沿原版
  5/10/25/50 MiB。
- 审计：终态 OUTCOME 记录 `TRANSFER_PACKAGE_DIGEST`（version 为格式版本）、新建对象的 owner 关系与
  ZedToken，不存 instructions 或包正文；全部 `quota_policy=NONE`。
- 迁移 `20261021120000_agent_teams_snapshots`：down 在已有任何团队、导出包、暂存或 DD-131 动作记录时
  拒绝回退（停止发布的确定条件）。没有 sqlx 宏查询变化。

## 实际验证与证据

CI 节点检查镜像（按本提交 `tools/check.Dockerfile` 配方的既有镜像），对推送到 GitHub 的分支提交取码，
在临时树内先运行原 `tools/gen.sh`（生成物不回传、不提交），再运行：

- `cargo fmt --check`、`cargo clippy --all-targets -D warnings`：通过；
- `cargo test --workspace --bins --lib`：platform-core 637 passed、60 ignored；`-p contracts` 65 passed
  （含 `dd131_agent_teams_and_snapshots_preserve_fields_and_absence`）；
- 新增单元测试：`agent_snapshot::tests` 9 项（原版清单映射与丢弃、PNG 往返与同一文件两次解码、头像
  图像体、导出无身份/密钥/记忆字段、超限/旧格式/zip/锁定卡拒绝、团队任一成员非法整包拒绝、团队不导出
  instructions、不可见字符与非法头像、原版文件名）；`governance::agent_catalog::tests` 3 项与
  `governance::agent_transfer::tests` 3 项（参数闭集、HUMAN/EXPLICIT/Tenant 串行、导出无确认位、
  导入 ID 确定性与 slug 合法）；`spicedb::tests::catalog_share_requires_both_member_grants_of_its_own_tenant`；
- 隔离库：临时 PostgreSQL 上 `sqlx migrate run/revert/run` 通过；
  `agent_team_isolated_database_invariants`（重复与跨 Tenant 成员被拒、成员次序保留、墓碑不可改写、
  导出包字节与状态一致、上传只属于真实会话）通过；`check.sh` 同一枚举漂移检查 48 个命名约束逐值相等；
- Go：`gofmt`、`go vet ./...`、`go test ./...`（含 `TestResourceTransfer*` 三项与 `registry_test`）通过；
- TypeScript `pnpm -r typecheck`、`pnpm -r test` 与 Dart round-trip 通过（契约侧）。

## 缺口

- 生成物（四侧契约、Dart 文案）未提交，合并后需经 `kailo-ci gen` 产出并提交。
- 指定 owner 不是导入人时的导入审批（05 §2.12）未实现：当前导入的新对象 owner 固定为发起人。
- 频道模板的 team 条目（DD-125(4) 修订）未实现：`.design/03` 的 `channel_templates` 形状尚无 team 字段，
  须先改设计。
- RESOURCE_EXPORT/RESOURCE_IMPORT 尚无录制的 replay history；没有真实 SpiceDB/Temporal 端到端、浏览器或
  Desktop 业务验收。
