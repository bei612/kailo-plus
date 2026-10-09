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
