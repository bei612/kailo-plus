# ADR-14：Gateway durable usage 随首个模型用量产出方进入 Stage 5

- 状态：已接受
- 日期：2026-09-29
- 决策者：Kailo 实施工程负责人

## 背景

ADR-13 把 Stage 4 定为「Quota、Usage 与观测」，并把 `SS-AGW-USAGE` 与 `V-SCN-16`、`17` 留在 Stage 4，
Stage 5 只「在 Codex 模型调用链上复验」。核实后的事实如下：

- Stage 0–3 已交付或将交付的全部 Governed Action 都是 `quota_policy=NONE`、`meters=[]`：
  `core/migrations/20260924100000_governed_action.up.sql` 以 `quota_not_yet_enforced` 约束在库里拒绝
  其他取值，Stage 3 的 `tenant.delete` 与 `DD-100` 列出的动作同样全部为 `NONE`；
- 平台核心链里第一个、也是唯一的模型用量产出方是 Stage 5 的 Codex 经 AgentGateway 的调用；首批带
  `CHECK` 的动作（Codex 模型 meter、`automation.run`，`DD-107`）也在 Stage 5 出现；
- `DD-21` 与 `.design/11` §5 规定：`SS-COD-TRACE` 闭合前，Codex→Gateway 的 usage 归因固定为 `NONE`、
  显示 `BILLING_UNAVAILABLE`；`SS-COD-TRACE` 归 Stage 5；
- `.design/16` 中 `V-SCN-16`、`17` 的状态是 `ADAPTER_REQUIRED: SS-AGW-USAGE`，两者都要求有真实的
  Gateway usage 可写、可重放。

因此 Stage 4 没有任何模型用量可以通过 `SS-AGW-USAGE` 进入 OpenMeter，`V-SCN-16`、`17` 在 Stage 4 没有
可验证的对象；在 Stage 4 闭合该接缝就是在没有产出方时预建，违反 ADR-13 援引的既有规则。

约束：

- 不在无产出方时预建实体或执行记录（`02-纵向交付路线.md` §4、ADR-13）；
- 平台门禁只含平台核心的接缝与阻断项（`DD-91`）；
- 一期生产总门禁（平台）仍要求 `SS-AGW-USAGE` 闭合，本决策只改首次交付的 Stage，不改门禁集合。

## 候选方案

- **维持 Stage 4 闭合 `SS-AGW-USAGE`**：只能用人工构造的 Gateway 请求验收，它不经过 operation 关联，
  既不能证明归因，也和 `DD-21` 的 `BILLING_UNAVAILABLE` 语义冲突；排除。
- **把 `SS-AGW-USAGE` 与 `V-SCN-16`、`17` 移到 Stage 5，和 `SS-COD-TRACE` 同一切片**：usage 的持久确认与
  因果归因在同一条真实调用链上一起闭合；采用。

## 决策

1. `SS-AGW-USAGE` 归 Stage 5，与 `SS-COD-TRACE` 在同一交付切片闭合；`GATEWAY_DURABLE_USAGE` 在该切片
   首次允许登记。`DD-21` 的归属相应从 Stage 4 改为 Stage 5。
2. `V-SCN-16`、`17` 从 Stage 4 的验收映射移到 Stage 5，在 Codex 模型调用链上首次验证。
3. Stage 4 保留 OpenMeter 底座（`SS-OMT-AUTH`、Customer/subject 映射、CloudEvent、outbox 与 commit
   对账）以及 Quota、Usage 的平台机制；放开 `quota_not_yet_enforced`，但 Stage 4 的 Quota 验收只能
   验证拒绝路径：entitlement 不可得或已耗尽时准入拒绝、没有副作用，不满足封闭 producer 与可证上界的
   meter 不能登记为 `STRICT_RESERVATION`。`V-SCN-15`、`41` 在 Stage 4 只按拒绝路径验收。
4. Stage 5 以真实 `CHECK` 产出方（Codex 模型 meter、`automation.run`）复验 Stage 4 的 Quota 准入，
   `V-SCN-15`、`41` 同时出现在 Stage 5 的验收映射中；「durable usage 或 correlation 缺失时显示
   `BILLING_UNAVAILABLE`、不显示零费用」从 Stage 4 的退出门禁移到 Stage 5。
5. `V-REQ-09`（Capacity/Quota/Billing）的首次闭合从 Stage 4 改为 Stage 5。

## 后果

- Stage 4 的退出门禁不再声称任何 LLM usage 已持久确认；它证明的是计量底座与 Quota 拒绝路径。
- Stage 5 的范围变大：同一切片内要同时闭合 `SS-COD-TRACE` 与 `SS-AGW-USAGE`，并完成首批 `CHECK`
  产出方的 Quota 复验。
- `EXT-BASE` 依赖 Stage 4 与 Stage 5，依赖关系不变；服务经 `PLATFORM_LLM_ROUTE` 的模型调用复用
  Stage 5 已闭合的 `SS-AGW-USAGE`。
- 平台一期收口与一期生产总门禁不变：`SS-AGW-USAGE` 仍须在收口前闭合，并能追溯到构建产物。
- 文档同步：`02-纵向交付路线.md` §1.0、§6、§7；`05-设计覆盖矩阵.md` §1 基线、§3 `DD-21`、§4 接缝归属、
  §5 `V-REQ-09`。`.design/16` 中 `V-SCN-16`、`17` 的状态不变，仍为 `ADAPTER_REQUIRED: SS-AGW-USAGE`。

## 重新评估条件

- Stage 0–4 中出现带 `CHECK` 或 `STRICT_RESERVATION` 的平台核心动作，或出现 Codex 以外、经 AgentGateway
  的模型用量产出方时，重新评估 `SS-AGW-USAGE` 是否前移；
- `SS-COD-TRACE` 被判定不可闭合、Codex 调用长期只能以 `BILLING_UNAVAILABLE` 运行时，重新评估
  `SS-AGW-USAGE` 与它同切片的前提；
- `.design` 调整 `DD-21` 的 actual usage source，使模型用量不再只经 AgentGateway 完成请求接缝时，重新
  评估本决策。
