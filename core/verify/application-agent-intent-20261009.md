# Agent 应用执行令牌与原生执行关联修复

记录日期：2026-10-09。此记录是实现后的局部证据，不是业务组件激活、生产或端到端验收声明。

## 权威与影响面

依据既有 ActionExecution/ExternalExecution、ActionToken、ApplicationBinding/generation 与 AgentGateway 接缝（DD-49、DD-90、DD-105、SS-AGW-02），人和 Agent 的原生动作必须签发并持久化同一次执行关联，而不是让下游相信未签名 header。

原问题：application_tool::dispatch 先经 action_token::issue_application 签发没有 external_execution_id/idempotency_key 的 Agent 令牌，随后才创建原 ExternalExecution 和 key。原生服务严格比对签名 key 时，Agent 无法证明外层 key 属于该次执行；规范化参数 hash 本身不包含外层 key。不能以放宽下游校验修复。

实际改动仅两个原模块：

- application_tool::dispatch 在原 RemoteAdapter 分支生成一次 external/key，同一对值传入原签发器及原事务内 ExternalExecution insert；不再签发后生成另一对值。ProtocolPeer 不生成无对应原生任务的 ExternalExecution。
- action_token::issue_application 与原 HUMAN issue_component_action 复用原 common issuer，执行令牌均包含这对非零 UUID；身份、scope、授权版本、delegation 和 exposure 字段仍沿原路径。
- 原 revision/observation issuer 明确不借用执行意图字段。它们继续签自身的读取/观察参数，不变成另一次 execute。
- 搜索全部三个 application_claims 生产调用点与两个应用执行 issuer 调用点，均已对应更新。没有改变契约、数据库、枚举、资源授权和外部正文归属，也不需要旧数据迁移。

## 副作用与边界

签名只在内存中预备，仍须完成原 invocation/parent、锁定 child、目标版本、approval、quota、active binding/generation、映射、Workflow、计量准备与审计事务后才能返回 Gateway。并发失败者的预备令牌不被返回；原 DISPATCHED/UNKNOWN 不被这次修改重发。

缺参数、空 UUID、scope/授权/绑定/projection 不成立继续拒绝，撤权仍沿原 fresh_execution 与最终原生 PEP。审批后额度耗尽仍由原事务前 quota check 拒绝。任何提交或外部结果不明仍沿原 UNKNOWN/对账语义，不渲染成成功或业务失败。没有给原生服务增加宽松身份、默认租户、共享 secret 或第二执行注册表。

Web 经原 BFF、Desktop/Mobile 经原持钥传输及三端管理面边界均不变；这是原 Core 签发器修复，不增加三端页面或 Mobile 组件入口。

## 实际验证

私有候选基于已提交 main 7df04b37d20a64a50e1eb139f811e6b8d7401281 导出，仅覆盖上述两个正式源码文件。沿现有 SDK kailo-client-core-full-fxcd9l，实际 UID1000、4 CPU / 8 GiB、Cargo jobs16、Data target/registry/git 缓存，未新建工具链或降低 Cargo 并发。

首次候选导出误写不存在的 collaboration/proto，另一次遗漏 collab-bridge 的原 buzz-core/buzz-sdk 依赖，均在编译前失败。按实际 build.rs/Cargo.toml 导出原 model-gateway/crates/protos/proto 与 collaboration 原依赖后才运行下面检查；不把准备失败算通过。

```text
cargo test --manifest-path core/Cargo.toml --offline --locked -p platform-core application_intent_tests -- --nocapture
```

终态退出 0，实际目标 3/3 通过，397 个该 binary 的其他单元检查未选；原集成 binary 只是编译及过滤，不算数据库验收。三项检查调用真实 application_claims：HUMAN/Agent 的同一执行关联与原 scope/delegation/exposure、非零 UUID 拒绝、读取/观察不生成执行意图。

然后仅在私有生产 helper 删除实际两个执行字段赋值，不修改检查；原 --bin platform-core 的同三个目标真实退出 101，2 通过 / 1 失败，断言实际 `Null != external UUID`。这证明检查命中生产 payload 缺字段，不把编译失败冒充命中。

使用 apply_patch 恢复原私有源码，两个正式/私有文件均 cmp 0，按工作区实际 edition 2021 格式化，复验：

```text
cargo test --manifest-path core/Cargo.toml --offline --locked -p platform-core --bin platform-core application_intent_tests -- --nocapture
rustfmt --edition 2021 --check core/crates/platform-core/src/action_token.rs core/crates/platform-core/src/application_tool.rs
```

两者退出 0，三个实际目标重新 3/3 通过，最终两个输入 cmp 0、git diff --check 0。最终 cgroup memory.events 的 oom/oom_kill 均 0；max=776 是本批有限内存回收事件，不冒称全部事件为零。

日志在 /volumes/data/kailo/check-cache：application-intent-positive-20261009.log、application-intent-mutation-20261009.log、application-intent-restored-20261009.log。首轮编译 4m33s、故障候选 6m56s、恢复后 13.17s；故障轮同时遇到已记录宿主高 I/O 压力，不靠降 Cargo jobs 或无限重试掩盖。

本批没有验证真实 OpenBao 签名/SpiceDB/数据库/Gateway/原生业务服务整条执行链；helper payload 检查不能冒充它。没有重跑完整 check.sh --full，之前失败仍未清除；Core 新镜像未构建、未部署，三个业务组件未因此激活。正式源码提交不等于线上已采用这项修复。

## 后续：HUMAN/AGENT 原生 execute 消费同一个冻结意图

起点 main `784d2ee9e80f09d2f720e5d0e0b85bc71492da01`；仅修改原
`application_binding_pep.rs::check/dispatched_intent` 及其原 revision 检查模块。
依据上述 DD-49/90/105、SS-AGW-02 与既有 ExternalExecution 合同：原接收方
只对 HUMAN execute 比对冻结 EE/key，AGENT 不能只凭父工作流和已签参数获取另一 key
或借已结算票据开始新请求。本次统一两类 actor 的同一个原业务消费者，不另建执行权威。

四步结论：

1. 权威及影响：原签发器写 EE/key claims，原 dispatch 事务写 ExternalExecution；
   原 PEP execute 读取精确 tenant/workspace/operation/AE/EE/key/hash、binding/release/generation
   和 WorkflowRef。HUMAN 仍用 ComponentTaskWorkflow/COMPONENT_ACTION，AGENT 仍用原
   child→parent AgentTaskWorkflow；HUMAN 原审批消费和 AGENT 原 fresh authorization 不变。
2. 副作用：预备票据在真实 dispatch 尚未持久化时不能执行，终态票据不能启动第二次原生请求。
   query_revision、observe、extract_usage、ProtocolPeer、SERVICE_READ 和生命周期消费者未改；
   不将观察准入当成业务 execute，也不复制文件或查询正文。
3. 边界：没有 EE、PENDING_DISPATCH、缺 claims、错 key/hash/scope/binding 或终态均拒绝。
   usage 必须含真实数组 meters；明确 NONE 的空数组合法，缺 meters 的非空对象不等于零用量。
   数据库错误继续原 Unavailable/UNKNOWN，不猜测终态，不重放旧请求。
4. 兼容：无契约、字段、迁移、新状态、客户端页面或 Mobile 组件入口变更。
   原已不完整的 usage 对象不补造零值；由既有对账负责。此处快照校验不单独证明
   撤权竞争或跨分区 exactly-once，原生 Task 幂等保留和原终态对账仍不可省略。

原 SDK `kailo-installation-scope-sdk-e4agxd`，UID1000，4 CPU/8 GiB，memory+swap 同限，
Cargo jobs16、Data target/registry/git 缓存；每次先检查进程与宿主压力，没有新 SDK。
候选导出沿上述起点原树，遗漏 collaboration workspace 和 capabilities.yaml 的两次准备失败
分别保留 exit101；旧 79 迁移诊断库 SQL 检查因缺 reference_provision 退出3，不记通过。
随后仅在本批独占的原隔离 PostgreSQL 库运行当前 109 条正式迁移，全部成功。
初轮真实 SQL 还抓到新增 exists 查询漏闭括号，exit101；修正后才产生以下证据。

```text
cargo test --locked --offline -p platform-core --bin platform-core execute_ticket_requires_exact_frozen_nonterminal_intent -- --ignored --nocapture
cargo test --locked --offline -p platform-core --bin platform-core revision_pep_tests -- --nocapture
cargo test --locked --offline -p platform-core --bin platform-core application_intent_tests -- --nocapture
rustfmt --edition 2021 --check crates/platform-core/src/application_binding_pep.rs
```

最终恢复句柄78652退出0：隔离数据库实际查询1项通过、原 revision 2项通过、原签名 payload
3项通过，共6项；默认目标中同一数据库项显示 ignored，但已另用 --ignored 实跑，不记跳过验收。
数据库夹具沿原 base/dispatch SQL，在单次外层事务内完整回滚，未关闭任何真实数据库约束。
它覆盖 HUMAN 形状正向及 AGENT 不得借 HUMAN 根工作流的反向，不冒充真实 Agent 正向端到端。

仅私有实际生产 SQL 将 meters 数组保护退回 is not null，同一检查句柄15683真实退出101，
断言缺 meters 对象竟可执行而失败；不是编译或加载失败。apply_patch 精确还原，正式与候选
cmp0 后同一目标重新通过。最终 cgroup oom/oom_kill 均0，max11975为有限内存回收，非全部事件零。
正式最终源码 SHA256 `8d81d24aea8920d79673e2df9273b6ed72d0a25b658af21a0cd6efdc9a112936`。
原日志目录：`/volumes/data/kailo/tmp/codex-installation-runtime-rootcause-20261003.e4agxD/pep-intent-20261009.ETDP5q/`；
`restored-final-query.log` SHA256 `b1cfa08a2b4d741905fbfd2d192c6fbca220e939e14ad4b15c60c4eaee6f759e`，
`negative-missing-meters.log` SHA256 `41fec4ebb97a63f486280e5735cc5159e3079ec8f8f89aeab22a4dc882d7cf1c`。

本批仍未构建/部署 Core，未验证真实 Gateway/SpiceDB/组件全链路或三人多 Agent。
此前固定08c76afd树的原 check-docs.sh 句柄64294已实际退出0；不代表本批 full 通过。
完整门禁最新仍为失败，线上执行版本未随源码提交变化。
