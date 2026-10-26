# HUMAN application ResultExposurePolicy

关联：03 §6（ResultExposurePolicy 最大边界与求交）、DD-88/94（已批准 release 与原 binding 生命周期）、DD-134(6)（HUMAN 工具测试调用）。这是一项既有 Core 实体的生产者实现，不增加策略管理动作或授权服务。

## 实现与边界

旧实现只有 `delegation::prewrite` 随 grant scope 写 ResultExposurePolicy；它的 APPLICATION scope 要求 ACTIVE binding/ToolBinding。原 HUMAN componentAction 与 Cells 原生动作配置却已要求策略 ID，导致第一套 binding 启动前缺少合法生产者。同 schema 的 grant 策略或自动准入的模拟 UUID 不能填补此缺口。

`application_binding::prewrite` 已通过原 scope、fresh 权限与目标门禁后，在写入 PROVISIONING binding/PENDING runtime 的同一事务调用 `human_exposure::materialize`。它逐项读取固定 APPROVED release 的 actionDefinitions，只接受原 mode/output schema/redaction 声明，物化到既有 `catalog.result_exposure_policy`。原 TEMPORAL 准入会在 prewrite **之后**将该 ActionExecution 写为 ALLOWED，再一起提交；数据库约束不错误地提前要求这一后置状态。

新增 nullable 归属列为 tenant（原字段）、binding、release、generation、actionKey/actionVersion。新策略固定 version 1，唯一约束确保幂等重入仍使用同一 ID。全空归属保留 Delegation 原语义；全有归属受 tenant/binding、runtime/release 外键及已批准声明约束。已有 immutable trigger 同时保护新归属；HUMAN 策略不允许删除或从 RETIRED 恢复。撤销绑定时仅退役自身策略；没有按 schema 查找或复用其它策略。

HUMAN componentAction、PROTOCOL_PEER 测试调用准入及后者 PEP 两相都验证确切归属。目标权限、输出 schema/redaction、正常 binding/tenant/workspace 生命周期门禁继续由原消费者执行。固定 old generation 引用不擅自换到新 generation；普通新准入仍取当前 ACTIVE projection。未 ACTIVE 的绑定即使已有策略也不能执行。原 AGENT Delegation 路径不改成 HUMAN 规则。

`ApplicationBindingPage.bindings[].humanActionPolicies` 是公开控制元数据。ACTIVE binding 在原 fresh discover 范围内给出固定引用；PROVISIONING/ERROR 的 PENDING 引用仅向原 canCreate 管理者给出，以便投递 native-action 配置。Gateway 工具列表从确切 binding/generation/action/version 策略取得 testCall 引用，移除任取同 schema 策略的旧查询。API 是可选字段扩展；四侧类型仅由原 `tools/gen.sh` 生成。

## 验证状态

原始检查与后续纠偏会在本文件补充固定 SHA、命令、退出码和回执。当前源码阶段提交不等于编译、迁移或端到端通过。

新增原数据库回归使用独占隔离库的既有 `application-execution-base.sql`/dispatch fixture；只暂停 fixture 在 PENDING 阶段以调用实际 Rust producer。覆盖事务回滚、幂等 ID、未 ACTIVE 拒绝、错误 tenant/binding/release/generation/action/version、同 schema 无归属策略拒绝、内容不可变与退役。该夹具不是产品 bootstrap，不证明真实 Catalog 审批或原生执行。

## 未闭合项

- 当前源码只有初次 application binding 的 runtime writer，未发现已实现 upgrade writer；本变更不伪造升级入口，也未验证真实升级在途动作。
- 已有无归属策略不自动转成 HUMAN 策略，不替旧绑定猜测身份；当前全新开发库没有已发布旧 writer，迁移下行遇到已有归属策略时明确拒绝，需停止回滚。
- 接收方自动化还需利用原 HUMAN 管理读取取得引用，在 binding 准入与 adapter 启动之间完成 native-action 配置，然后再走真实 model delivery、activation、seed、inputs、driver。
- 未启动新 receiver 栈，未重启或删除旧栈，未部署生产，未将这些定向验证计为三组件端到端或 V-SCN 验收。
