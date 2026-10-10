# Session / Invocation 原事实读取

本批是已有 Installation 管理详情的只读消费者，不是原版 Transcript、Working bar 或完整 Agent 会话体验的完成记录。基准 `590431e4b8a88691350b4b91121622e628067cea`；未部署，未做新页面截图或原生设备验收。

## 变更依据与影响

1. 权威：`.design/17` §7–8、`.design/19` §4、DD-47/65。Session/Invocation 仍是原 `catalog.agent_session` / `catalog.agent_invocation`，执行权威仍为 Temporal，正文仍属于原 Codex。新 GET 不调用 runtime start、ensure、resume 或 rollout 读取。原 UI 来源为 Buzz `779af8886caae1317b4de962082429867ab61503` 的 `desktop/src/features/agents/ui/ManagedAgentSessionPanel.tsx::SessionHeader`；新增治理详情不能据此声称原会话面板已还原。
2. 影响面：原 BFF 两个 Installation 子路由、原 Installation 的 `read_view`、原任务 `observation`、四个 JSON Schema、四侧生成物及共源管理详情。没有新表、状态、注册表、Workflow、凭据或迁移；旧 Session generation 保留，游标不改写旧记录。原任务详情仍独立实时授权，`canReadTask` 只控制当前发起人的入口。
3. 副作用：查询只读。每页解析真实 HUMAN，复用 Workspace 准入和 Installation fresh read；Invocation 只返回本人执行或实际 AE 目标的 fresh audit 允许项。Automation 的 AE 目标不同于 Installation 时，不能拿 Installation 权限代替。没有 runtime 正文、prompt、tool result、reasoning、secret 或成本暴露。
4. 异常：非法游标、筛选或 generation 为前置条件拒绝；身份/scope/权限缺失拒绝；数据库、SpiceDB、投影事实或未知枚举不可核验即不可用。游标绑定 Tenant/HUMAN/Workspace/Installation/root/generation；分页采用配置上限和原记录稳定键，无新硬编码阈值。过滤后空页保留 nextCursor，重复 GET 无执行副作用。返回前重读身份及 Installation；UNKNOWN、投影落后和 cancelPending 复用原任务事实，不呈现为成功或已取消。响应 no-store。

Web 与 Desktop 使用同一管理面 BFF 和 TypeScript 消费者。Mobile 仅获得同源生成契约，不据此宣称原生 Session 页面已交付；它仍非组件宿主。

## 实际检查及边界

- 原生成入口 `bash tools/gen.sh`：以正式 `apps/contracts` 完整冻结输入执行，Rust、Go、TypeScript、Dart 四侧均 `OK`，exit 0。SDK image `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，实际 4 CPU / 8 GiB、Cargo 16，缓存与临时输入在 Data 盘。
- 原注册表生成器：`python3 tools/gen-registry.py` 输出 `24 条能力，20 个封闭 workflow kind 参与校验`，exit 0；只新增两条原能力下的 GET 路由，不创建新能力权威。
- 首次生成使用了过时的私有契约快照，错误移除了已有 Workflow description；UI tsc 实际 exit 2。已改为正式完整契约重新生成，保留原 description 消费者，未弱化类型检查。旧 Core 检查在缓存读取阶段终止，exit 143，不能计为通过。
- `contracts/samples/agent-session-control.sample.json` 是实现之后的四侧往返样例，覆盖 UNKNOWN、审计读者无任务入口、可选原生引用缺省，以及原 ContentReference 与本批元数据 inputJson 两种输入。
- 当前记录不证明实库授权、运行中撤权、分页并发、原生设备、完整上游 UI 一致性或生产就绪。全量门禁和上述验收仍独立成立，不能以生成成功替代。

## 2026-10-10 本批定向终态

同一受限 SDK 的 `/tmp/human-reader.gcbX3d` 完整冻结输入实际执行：

- `cargo test -p platform-core --bin platform-core agent_session_query::tests --locked --offline`：4/4。
- `cargo test -p platform-core --bin platform-core application_action::tests --locked --offline`：3 passed、1 ignored。忽略项需要已迁移隔离数据库，不算实库准入通过。
- 只在 SDK 私有生产副本移除游标 scope 匹配及 control_metadata 字符串限制，两条原检查分别 exit 101，捕获跨 scope 游标与正文输入放行。按原字节还原、`cmp` exit 0 后，同一检查分别 4/4、3 passed / 1 ignored。
- `cargo clippy -p platform-core --bin platform-core --locked --offline -- -D warnings`：exit 0。
- 最终样例的 Rust contracts：2 个 adapter PEP 与 48 个 roundtrip 全通过；Go `go test ./internal/contracts` exit 0；Dart `dart test test/roundtrip_test.dart` 48/48；TypeScript 原 `node --test --experimental-strip-types "test/**/*.test.ts"` 56/56、exit 0。共享页面类型与交互另见 [同源 UI 回执](agent-session-ui.md)。

保留失败：首个新样例遗漏 ContentReference 必填 displayName/mediaType，Rust 实际 47 pass / 1 fail；补齐原合同字段后通过。Dart 随后捕获样例时间被原 DateTime 序列化规范为毫秒精度，修正样例使用规范格式后 48/48，没有更改生成类型或忽略字段。四侧串行命令最后的 TS 相对目录错误使外层 exit 1，前三侧已通过；独立 TS 命令又因误用未安装 tsx 而 exit 1，随后改用原 package.json 的 Node strip-types 命令 56/56。未安装新工具或改变产品以迁就执行环境。

日志目录 `/volumes/data/kailo/tmp/component-delivery-commit.CVKZK5`：

| 日志 | SHA-256 | 结果 |
| --- | --- | --- |
| core-guards-negative.log | `d1ab93856eba0250b73cd999d1ebc1ad55169effc5f709ef4c19db5bcccc2cef` | 两条生产变异均 exit 101 |
| core-restored-contracts.log | `f5417edb258bd89ba7882977096eb4cec784ad37b3fe13d97d2de733fa2f22e0` | Core 还原与 clippy 通过；Dart 原样例失败 |
| four-side-final.log | `07cc1141c7ca459afddf322a2179862e15c1db9f230155e3b23aa8e3582c028e` | Rust/Go/Dart 通过，TS 工作目录错误 |

最终 TS 独立输出在 `ts-roundtrip-restored.log`，实际 56 passed / 0 failed。
上一冻结 f9784f9b92f8279e3293999c04c97d8e0baaddde 的全量检查实际 exit 1，包括旧 Core stream、共享 Workflow 检查及产物来源不匹配；不是本批通过证据。本批源码未部署，不改变三组件 release/binding 的阻断状态。
