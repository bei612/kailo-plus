# RB-08 binding generation 切换失败与回滚

`07-运行与运维基线.md` §6 第 8 项。generation 的语义以 `.design/03` 为准：它属于 `PlatformProviderBinding`、`ApplicationBinding` 的 `active_projection_generation` 与 `ComponentRuntimeProjection`，以及 `DD-70` 中「轮换 = 写入新版本并推进 binding generation」。

## 适用范围

**当前拓扑无适用对象。** 现有的 binding 只有三种，它们都没有 generation，也没有「在两个 generation 之间切换」的操作：

| 实体 | 版本字段 | 变更方式 |
|---|---|---|
| `TenantBuzzBinding` | `version` | Tenant 建立时写入并在查证后 `ACTIVE`，此后不切换 |
| `WorkspaceBuzzBinding` | `version` | Workspace 建立时写入，不切换 |
| `BuzzIdentityBinding` | `version` | 登记、投影、撤销；换钥匙是新建一条 binding（`DD-77`），不是切换 generation |

带 generation 的实体在后续 Stage 进入拓扑：component binding 与运行时投影属于 Stage 3（`02-纵向交付路线.md` §5），SecretRef 轮换推进 generation 属于 Stage 2 的完整 SecretRef 生命周期（同上 §4）。它们进入拓扑时，本 runbook 按其实现补齐触发信号、判定依据与步骤并重新演练；在此之前，下面的判据用于确认「仍无适用对象」这一事实没有变化。

## 触发信号

- 发布包含新增的 `projection.component_runtime_projection`、`platform_provider_binding`、`application_binding` 表，或任何实体新增 `generation`、`active_projection_generation` 列；
- `apps/05` §7 的能力归属出现 component binding 相关能力。

## 判定依据

以下两条同时成立即仍无适用对象：

```sh
# 迁移中没有 generation 列或 component binding 表
grep -rliE 'generation[[:space:]]+(integer|bigint|int)|component_runtime_projection|application_binding|platform_provider_binding' core/migrations/*.up.sql
# Core 没有切换 generation 的写路径
grep -rnE 'projection_generation|runtime_projection' core/crates/kailo-core/src
```

两条命令都没有输出。任一有输出，即本 runbook 需要按新实现补齐。

## 可执行步骤

1. 发布前执行「判定依据」中的两条命令。
2. 都没有输出：记录「无适用对象」，结束。
3. 任一有输出：阻断该发布的生产上线，直到本 runbook 按新实现补齐触发信号、判定依据、步骤与回滚，并完成一次演练（`tools/check.sh docs` 要求演练记录）。

## 不可执行的动作

1. 不把 `BuzzIdentityBinding` 的换钥匙当作 generation 切换来处理：它是撤销旧 binding、登记新 binding，按 RB-02 与 RB-03。
2. 不为了「预先准备」在库里建 generation 列或切换入口：没有调用方的结构不预建。

## 完成判据

- 「判定依据」两条命令无输出，并已记录；或
- 本 runbook 已按新实现补齐并演练。

## 演练记录

2026-09-23，本地拓扑，commit `f292569` 之上的工作树：执行「判定依据」的两条命令，均无输出；`.design/03` 中 generation 只出现在 `PlatformProviderBinding`、`ApplicationBinding`、`ComponentRuntimeProjection` 与 Agent 会话快照的定义里，这些实体在当前迁移中都不存在。结论：无适用对象。
