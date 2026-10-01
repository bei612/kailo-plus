-- 直接启动链留下的派发状态（.design/06 §3.1、apps/06 §4）。
--
-- 设备公钥登记/撤销、托管身份撤销与 service API 的生命周期、重跑入口此前经
-- component_task 启动 Workflow 后只写 WorkflowRef、回填 run ID，从不推进
-- ActionExecution 的 dispatch_state：Workflow 已经跑完，任务页仍显示「已允许，
-- 尚未开始」。代码已改为所有启动路径都经 governance::record_dispatch 记录派发
-- 结果；这里只修补改动之前留下的存量行，且只朝真实状态推进：
--
-- 业务 WorkflowRef（ComponentTaskWorkflow，归属该 ActionExecution 或就是它预写的
-- workflow ID）已有 run ID、或已 RUNNING/TERMINAL，是执行确已发生的持久证据，
-- 与 record_dispatch 判定「已派发」的证据相同。仍为 NOT_DISPATCHED 的已准入行
-- 置 DISPATCHED。其余行不动：没有执行证据的无从断定派发是否发生，UNKNOWN/ABORTED
-- 已是派发结论，ApprovalWorkflow 的执行不是业务派发。
--
-- 不补写 DISPATCH 审计：audit.audit_event 只追加，每条记录的是事实发生时的那次
-- 写入。此刻补一条只能伪造当时的时间与证据；历史上确实没有写过这条审计，这一
-- 缺口如实留在审计里，派发的证据是上面的 WorkflowRef 与 Temporal history。
-- updated_at 同理不改：派发不发生在迁移这一刻。
UPDATE admission.action_execution ae
   SET dispatch_state = 'DISPATCHED'
 WHERE ae.gate_state = 'ALLOWED'
   AND ae.dispatch_state = 'NOT_DISPATCHED'
   AND EXISTS (
       SELECT 1 FROM projection.workflow_ref w
        WHERE w.workflow_type = 'ComponentTaskWorkflow'
          AND (w.action_execution_id = ae.id OR w.workflow_id = ae.temporal_workflow_id)
          AND (w.run_id IS NOT NULL OR w.projection_state IN ('RUNNING', 'TERMINAL')));
