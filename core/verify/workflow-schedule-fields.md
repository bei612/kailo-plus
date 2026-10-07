# 原定时触发编辑器恢复

2026-10-07；源码与窄验证回执，不是发布或三端完整验收。

## 四步影响结论与固定差异

1. 权威为 REQ-23/24、DD-107、`.design/06` §9/9.1。直接复用只读 Buzz `779af8886caae1317b4de962082429867ab61503` 的 `desktop/src/features/workflows/ui/WorkflowScheduleFields.tsx::WorkflowScheduleFields`、`desktop/src/features/workflows/ui/workflowSchedule.ts::scheduleFormFromTrigger/scheduleTriggerFromForm/defaultScheduleTrigger`；原字段标签和下拉布局来自 `desktop/src/features/workflows/ui/workflowFormPrimitives.tsx::FieldLabel/FormSelect`。完整读取上述文件后对迁移文件逐处 diff，而非只比较本批新增代码。
2. 共享迁移到 `client-kit/ts/platform/src/react/workflow-schedule-fields.tsx`、`workflow-schedule.ts`，Web/Desktop 共用 `agents.tsx::AutomationAction` 消费。七个频率卡片、每周七天、月日选择/短月警告、UTC 时间、五字段 Cron 和旧间隔编辑原样保留；仅 import、共享中英词条、严格索引类型和既定执行数据映射有差异。原版明确 UTC，没有时区选择器，不新增时区字段。未改合同、数据库、BFF、权限、Temporal 或触发器种类。
3. 已授权治理适配：原 UI 的 interval 字符串通过已存在 `workflow-duration.ts::parseDurationSeconds/formatDurationSeconds` 读写现有 `AutomationScheduleSpec.everySeconds`，不是另一解析器。保留原 `offsetSeconds`、`catchupWindowSeconds` 和准入字段；明确选择新周期时空 offset 设为零偏移，既有值不覆盖。旧缺省 kind 与已有 INTERVAL kind 均按原格式保留；cron 不混入 interval 字段。定时能力仍依赖已核实 CHANNEL 输出能力，未取消审批、额度或 UNKNOWN 同请求复核。
4. 空、零、非整数/不可解析间隔、越界 offset 和不足 catch-up 仍拒绝；原版每日默认 09:00 UTC 来自上游 helper，不产生未经确认的动作。最后一个星期不能取消，月底 29–31 日保留原警告；五字段不可表达的六/七字段 Cron 继续留在已有 YAML，不截断。没有新增持久状态、副作用或清理任务。Mobile 同源词条同步，但本批不代表 Mobile 编辑器运行验收。

## 星期语义的唯一转换

固定上游 UI 的 WEEKDAYS 与 helper 是 0=Sunday；但相同 commit 的 `crates/buzz-workflow/Cargo.toml` 使用 cron 0.16，`Cargo.lock` 固定 0.16.0 / checksum `089df96cf6a25253b4b6b6744d86f91150a3d4df546f31a95def47976b8cba97`。`crates/buzz-workflow/src/schema.rs::normalize_cron` 的结果被 `crates/buzz-workflow/src/lib.rs` 的 `cron::Schedule` 解析调用消费。该已锁定依赖源码 `cron-0.16.0/src/time_unit/days_of_week.rs::DAY_OF_WEEK_MAP/DaysOfWeek` 明确 Sunday=1、Saturday=7，不是由现有测试反推语义。

因此保留原七天显示和交互，但共享 helper 及复选框直接使用当前合同的 1–7，默认 Monday=2。后续调用链仍是 `AutomationAction` → 原 action BFF → `core/crates/platform-core/src/temporal/schedule.rs::automation_schedule_spec` → `schedule_calendar.rs::calendar/ranges`；只有既有 `ranges` 将 1–7 减一投给 Temporal 的 0–6。本批未修改这条后端转换，也不叠加第二次转换。实际 DOM 操作验证选择 Sunday 产生 `0 9 * * 1`，Saturday 产生 `0 9 * * 7`，两者同选产生 `0 9 * * 1,7`；改时间保持正确日字段。

## 实际命令与结果

复用上一批受限 SDK `kailo-agent-receipt-xvkujx`，cgroup `cpu.max=400000 100000`、`memory.max=8589934592`，运行前检查宿主 CPU、内存、并发和 Data 空间；无新快照、无 Rust 编译、无包安装或发布。日志位于 `/volumes/data/kailo/tmp/workflow-conditions-20261007.qjLXyz/`。

- `tsc --noEmit` 与 `tsc --noEmit -p tsconfig.test.json` 通过。初次 JSX 三元缺少 null 分支、旧测试 unused 解构的失败保留在 `schedule-ui.log`、`schedule-ui-restored.log`，修复后复验。
- `vitest run --pool=threads test/workflow-actions.test.tsx test/pages.test.tsx -t 'original schedule fields|shared Automation schedule consumer|original workflow action'`：最终 `87 passed / 206 skipped`，后者是按名称排除的其他场景，不算通过；`schedule-ui-byte-restored.log` 退出 0。包含原定时消费者、重复 UNKNOWN 请求、旧间隔原值重发、权限能力收窄、YAML 六/七字段与新增五项原控件检查。
- 实现后在私有快照令 `scheduleTriggerFromForm` 固定返回错误 Cron，`schedule-ui-mutation.log` 五个新增场景全部失败。还原与正式文件 `cmp` 相同后，上述最终日志再次 87/0。
- 默认 forks 池启动 worker 超时，`schedule-ui-final.log` 是 0 tests / 2 errors；SDK 未发生 OOM kill。换 Vitest 原生 threads 运行参数后执行实际场景，不修改产品或检查配置。首次运行检出既有 MENTION 场景仍寻找已移除的精简版 prefix 控件；已改用原条件 Advanced tab 和真实表达式输入，保留同等 starts-with 内容断言。失败和后续修正见 `schedule-ui-threads.log`、`schedule-ui-threads-restored.log`。
- 同一 SDK 原 `python3 tools/gen-platform-i18n.py` 与 `--check` 退出 0，`schedule-i18n-restored.log`。首次直接执行未标 executable 的 Python 文件退出 126，保留 `schedule-i18n.log`。生成依据当前正式 i18n；Dart 同时收缩此前已删除的三个无消费者通知词条，未手写第二份翻译。

本批没有修改调度执行语义、运行真实 Temporal 定时任务或全局编译。未发布、未做新增浏览器截图、Windows/Mobile 实机验收；不声明完整工作流或 Buzz 全量 100% 还原。
