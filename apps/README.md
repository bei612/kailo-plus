# Kailo 工程根目录

`apps` 是 Kailo 后续实现工程的根目录。当前只保存实施合同，不包含产品代码、构建产物或部署配置。

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
| 可执行事实 | 代码、迁移、API schema、验证记录、构建锁文件、发布清单 | 后续在本目录建立的工程文件 |

发生冲突时，产品语义服从 `.design`；工程实现不得以代码现状反向改写设计。设计需要变化时，先按 `.design/AGENTS.md` 的证据纪律完成设计变更，再修改实现与测试。

## 当前确定边界

- 一期同时交付 Buzz Web、Buzz Desktop、Buzz Mobile 三端；它们是仅有的用户入口，能力按 `REQ-21` 分级。
- Platform Core/BFF 是单一模块化 Rust 服务，共享业务事务边界。
- Application Worker 是同仓库、独立部署的 Go 进程，固定使用 Temporal Go SDK `v1.48.0`。
- 平台级能力通过固定 Platform Port Client 接入；应用级组件通过 Remote Adapter、Embedded Driver 或已证明的 Protocol Peer 接入。
- `.references` 是只读上游证据与差异来源，不是实现目录，不在其中开发、构建或打补丁。
- `BLOCKED` 能力不进入路由、菜单、Action、Tool、Workflow 或发布清单。
- `ADAPTER_REQUIRED` 能力只有在对应 `SS-*` 接缝实现、验证并形成可追溯构建产物后才能启用。

## 检查

修改本目录任何文档后运行：

```bash
tools/check-docs.sh            # 默认读取 ../.design
tools/check-docs.sh /path/to/.design
```

它覆盖禁用词、相对链接、设计 ID 闭合、覆盖矩阵三项计数、`V-SCN-*` 覆盖与 markdownlint，失败以非零码退出。

## 工具链

本目录的工作流工具状态（`.trellis/` 下除 `spec/` 外的内容、`.claude/`、`.codex/`、`.agents/`）不进版本库，新克隆后自行重建：

```bash
npm install -g @mindfoldhq/trellis@latest
trellis init --claude --codex -u "<你的名字>" --workflow native
```

固定使用 `native` workflow。

`.trellis/spec/` 是唯一入库的 Trellis 目录。它是从**已有代码**提炼的编码约定知识库（函数签名、字段、边界行为），提炼时机在任务完成之后，用于后续会话自动注入上下文；它不是先于实现的规格，与 `.design` 的产品合同是两回事。入库的原因是这些约定属于工程资产，必须随仓库分发并进入 code review，而不是只存在于某台机器上。

其中 `backend/` 与 `frontend/` 下的文件当前是空模板，随首批代码落地后逐步填写；`guides/` 由 Trellis 模板提供，升级工具会覆写它，产生的差异按普通改动评审。仍然成立的约束：进入 `.design` 或本目录实施文档的结论以那两处为准，`spec/` 只记录代码层面的约定，不得在其中重新定义产品语义或能力状态。

代码检索与影响分析使用 GitNexus（`gitnexus analyze` 建索引）。

## 当前阶段

当前阶段是 Stage 0。ADR-01 至 ADR-07 已全部「已接受」（见 [工程基线规范](06-工程基线规范.md) §6），[实施总纲](00-实施总纲.md) §6 的工程决策门禁已解除，Stage 0 的工程基线代码可以开始写：目录骨架、`contracts/`、追溯清单、基础库、`tools/check.sh` 与供应链。

**业务代码**——即 Stage 1 起的领域逻辑——的先决条件是 Stage 0 退出条件逐项达成，并通过 [验证、发布与验收门禁](03-验证发布与验收门禁.md) §5 的合并门禁。两者不是同一件事：Stage 0 的交付物本身就是代码，它不以自己为前提。
