# Kailo 工程根目录

`apps` 是 Kailo 一期实现工程的根目录，包含实施合同、Core、Worker、按功能命名的二开项目（协作底座与 Desktop/Mobile 客户端、Web 客户端、模型网关、Agent 运行时，ADR-16）、客户端共用代码（`client-kit/`）、契约、部署配置与验证工具。当前交付状态以本仓库的代码、追溯记录和门禁结果为准，不以本 README 代替验收证据。

产品语义与可行性结论由相邻的 [`.design`](../.design/README.md) 唯一定义；本目录只回答如何把已经冻结的设计安全地变成可运行系统。实施文档不得重定义 Tenant、Workspace、Resource、Action、Workflow、权限、状态或能力结论。

## 阅读顺序

1. [工程协作守则](AGENTS.md)
2. [实施总纲](00-实施总纲.md)
3. [工程结构与模块边界](01-工程结构与模块边界.md)
4. [纵向交付路线](02-纵向交付路线.md)
5. [验证、发布与验收门禁](03-验证发布与验收门禁.md)
6. [上游适配与升级](04-上游适配与升级.md)
7. [设计覆盖矩阵](05-设计覆盖矩阵.md)
8. [工程基线规范](06-工程基线规范.md)
9. [运行与运维基线](07-运行与运维基线.md)

## 三层权威

| 层 | 权威内容 | 位置 |
|---|---|---|
| 产品与架构合同 | 术语、实体、权限、状态、源码事实、接缝、阻断项 | [`.design`](../.design/README.md) |
| 工程实施合同 | 仓库边界、交付顺序、质量门禁、升级流程、设计覆盖与工件格式 | 本目录 |
| 可执行事实 | 代码、迁移、API schema、验证记录、构建锁文件、发布清单 | 本目录现有工程文件 |

发生冲突时，产品语义服从 `.design`；工程实现不得以代码现状反向改写设计。设计需要变化时，先按 `.design/AGENTS.md` 的证据纪律完成设计变更，再修改实现与测试。

## 当前确定边界

- 一期同时交付 Buzz Web、Buzz Desktop、Buzz Mobile 三端；它们是仅有的用户入口，能力按 `REQ-21` 分级。
- Platform Core/BFF 是单一模块化 Rust 服务，共享业务事务边界。
- Application Worker 是同仓库、独立部署的 Go 进程，使用 Temporal Go SDK `v1.48.0`；该版本是 Kailo 的选择，与 Server 内部依赖版本无关（`SF-TMP-04`）。
- Kailo 分平台核心与业务能力服务两层（`DD-87`）：平台核心强集成、不可替换，零业务能力 binding 时即是完整产品；文件存储、文档编辑、知识与数据查询是可缺席、可替换的业务能力，按能力类别与版本化能力契约接入（`DD-88`），内置的 Cells+ONLYOFFICE、WeKnora、Wren 只是参考实现。
- 平台级能力通过固定 Platform Port Client 或平台自身已编译的 driver 接入；业务能力服务只通过 Remote Adapter 或平台与该服务之间的标准协议接入，各自独立数据库与凭据（`DD-58`、`DD-93`）。
- 交付路线分平台核心链（Stage 0–5 与平台一期收口）与三个可选、互不依赖的能力扩展；一期生产总门禁只含平台核心（`DD-91`）。
- `.references` 是只读上游证据与差异来源，不是实现目录，不在其中开发、构建或打补丁。
- `BLOCKED` 能力不进入路由、菜单、Action、Tool、Workflow 或发布清单。
- `ADAPTER_REQUIRED` 能力只有在对应 `SS-*` 接缝实现、验证并形成可追溯构建产物后才能启用。

`apps/` 是唯一开发工程根，也是独立 Git 仓库根；`core/`、`worker/`、`contracts/`、`tools/` 等直接位于仓库顶层，远端沿用 `bei612/kailo-plus`。原提交与 tag 保留原路径，不重写历史。外层目录、上游证据和工具缓存不是开发项目；设计版本、历史路径与 CI/hook 边界见 [ADR-07](docs/adr/ADR-07-ci-and-branch-protection.md)。

新克隆须同时准备相邻的 `.design` 权威与只读 `.references` 证据；本工程不包含它们的正文。CI 从 [.github/workflows/check.yml](.github/workflows/check.yml) 的 `DESIGN_COMMIT` 读取保留历史中的固定设计版本。设计变更单独复核与提交，随后更新该版本，不以缺少设计目录为由跳过门禁。安装本仓库的共享 pre-push 入口：

```bash
git config core.hooksPath .githooks
```

## 检查

`tools/check.sh` 是本地、CI 与 pre-push 的唯一门禁入口；宿主调用只负责启动资源受限的检查容器，不在宿主运行项目 Cargo、Go、Node 或 Dart。检查镜像定义在 [`tools/check.Dockerfile`](tools/check.Dockerfile)，按配方摘要查找，实际执行记录不可变 image ID。

执行配置提供 `TMPDIR`、`CHECK_CPUS`、`CHECK_MEMORY`、`CHECK_NETWORK` 和 `CHECK_CACHE_ROOT`；两个目录必须可写且实际位于 `/volumes/data`。镜像首次构建还需要已有受限 `BUILDX_BUILDER`，由共用 [`container-safety.sh`](tools/container-safety.sh) 核对实际 BuildKit CPU、内存、swap 与数据缓存；不退回默认 builder，不降低 Cargo 并行度。完整规则与 CI 仓库变量见 [运行与运维基线](07-运行与运维基线.md) §2.1。

配置就绪后，全部门禁或单步检查使用：

```bash
tools/check.sh --full
tools/check.sh contract
```

修改本目录任何文档后至少运行同一检查容器的文档快路径：

```bash
tools/check-docs.sh            # 默认读取 ../.design
tools/check-docs.sh /path/to/.design
```

它覆盖禁用词、相对链接、设计 ID 闭合、覆盖矩阵三项计数、`V-SCN-*` 覆盖与 markdownlint，失败以非零码退出。

## 本地环境入口

非密配置只维护 `deploy/local/.env` 一份，入库模板为 [`.env.example`](deploy/local/.env.example)。展示名、主机名、端口、realm 与数据库名分别只填一次；保留样例中的派生表达式，组件环境、回调、邀请链接和受控数据库连接串由这些输入生成，不在各组件另填副本。密钥仍留在受控文件与 OpenBao，不向前端公开整份配置。现有环境的字段迁移与适用范围见 [运行与运维基线](07-运行与运维基线.md) §2。

现有 Compose 本地拓扑由 [`deploy/local/init-local.sh`](deploy/local/init-local.sh) 统一补齐数据库迁移、密钥与上游初始化、Core/Worker 启动、首位管理员的业务 Tenant，以及 Platform Catalog Tenant 的首位平台管理员。首次执行前填写 [`deploy/local/.env.example`](deploy/local/.env.example)，其中 `BOOTSTRAP_USER` 是业务 Tenant 首位管理员，`PLATFORM_ADMIN_USER` 是 Catalog 的平台管理员（发起 Tenant 暂停与恢复，`DD-96`），`VERIFY_USER` 专供临时 Tenant 走查，三者两两不同；准备受 CPU/内存 cgroup 限额约束的 `BUILDX_BUILDER` 和固定版本镜像。重复执行不清数据；需要不可恢复地重建这个测试环境时，显式加 `--fresh --confirm-delete=platform-local`，绝不用于旧 K8S。完整前提、删除范围和验证边界见 [运行与运维基线](07-运行与运维基线.md) §2。

## 工具链

项目工具链只来自检查与发布镜像，不另装宿主 SDK。Trellis 与 GitNexus 是协作、源码检索工具，不是项目编译入口；使用当前环境已核验的 runner，不能把它们的工具缓存作为项目源码或发布输入。

本目录的工作流工具状态（`.trellis/` 下除 `spec/` 外的内容、`.claude/`、`.codex/`、`.agents/`）不进版本库，新克隆后用已有 Trellis 工具初始化：

```bash
trellis init --claude --codex -u "<你的名字>" --workflow native
```

固定使用 `native` workflow。

`.trellis/spec/` 是唯一入库的 Trellis 目录。它是从**已有代码**提炼的编码约定知识库（函数签名、字段、边界行为），提炼时机在任务完成之后，用于后续会话自动注入上下文；它不是先于实现的规格，与 `.design` 的产品合同是两回事。入库的原因是这些约定属于工程资产，必须随仓库分发并进入 code review，而不是只存在于某台机器上。

其中 [backend/quality-guidelines.md](.trellis/spec/backend/quality-guidelines.md) 与 [frontend/quality-guidelines.md](.trellis/spec/frontend/quality-guidelines.md) 已记录真实工程约定，其余模板不能据此称为已补齐。`guides/` 由 Trellis 模板提供，升级产生的差异按普通改动评审，不把自动稿覆盖当作知识库更新完成。进入 `.design` 或本目录实施文档的结论以那两处为准，`spec/` 只记录代码层面的约定，不得在其中重新定义产品语义或能力状态。

代码检索与影响分析使用 GitNexus；源码根、Git 归属、凭据和运行数据排除、索引 freshness、编辑前 impact 与提交前 detect 的约束见 [AGENTS.md](AGENTS.md)「代码检索与影响门禁」。当前独立 Git 不依赖父仓库；根核对失败时停止工程操作，不能把外层索引或缓存安装树当作本工程的完整审查证据。

## 当前阶段

**Stage 0 历史基线验收**：当时十项退出条件记录为达成，`tools/check.sh --full` 退出码 0（21 项通过、2 项无适用对象）。这是基线时点的结果，不是当前工作树、全部业务能力或生产发布的验收结论。

已就位：四门语言的契约生成与 round-trip（Rust/Go/TypeScript/Dart）、Core 的六个模块 schema 与可回滚迁移、Temporal Worker 的 history replay 回归、四层 network 的本地拓扑、追溯记录与能力注册表的校验器、上游 baseline manifest 校验、发布单元与 SBOM/provenance、CI 与 pre-push 钩子（同一入口）。

当时两项 SKIP 是无适用对象而非遗漏：Stage 0 尚无用户可达能力的追溯记录，runbook 当时按 `07-运行与运维基线.md` §6 的适用性判定。当前已有生产路径的追溯记录；现阶段是否通过须读取实际记录与本轮门禁，不能继续沿用 Stage 0 的零记录判断。

**当前正在开发 Stage 2，尚未生产就绪**：Stage 1 的身份与协作主链已有实现，但不能宣称其退出门禁全部闭合。`DD-70/72` 要求的 `tenants/<tenant_id>` OpenBao namespace、独立 KV/AppRole/policy/token 已在本地真实生命周期与跨 Tenant 拒绝探针中验证；旧 `platform/kv` SecretRef 的兼容读取保留，迁移及旧版本处置尚未完成，见 [SecretRef 核验](core/verify/secret-ref.md)。Stage 2 的 Governed Action、审批、角色、邀请及任务只读投影已有实现；本人任务取消与重跑已通过 Core、Temporal、Worker 的真实拓扑联调及 Web 真实浏览器走查。Desktop/Mobile 原生会话端到端证据与 Stage 2 其余能力仍未闭合，Stage 3–5、平台一期收口与三个能力扩展未交付。当前优先收口 Web，再推进 Stage 2；以 [纵向交付路线](02-纵向交付路线.md) §1.1、§3–4 的端规则和退出门禁逐项验收，不得把 Web 通过当作三端和全阶段通过。
