-- DD-84：只为本版本已经有业务 Workflow 的四个用户动作开放取消请求。
-- 控制定义沿用原动作的 scope 与 SpiceDB 权限合同；Core 还在每次准入和派发
-- 验证 key 中的原 action/version 与原 ActionExecution 的确切定义相同。
-- 取消是 PROTOCOL 请求；DISPATCHED 需匹配控制 ID 的 history 事件，
-- 只表示请求已记录，不表示原任务已取消。
-- 取消 RPC 前冻结 execution chain 的首次 run ID。结果不明时只能沿同一链
-- 查询 history 或重发同一控制动作，不能按 workflow ID 猜另一条执行链。
ALTER TABLE admission.action_execution ADD COLUMN cancel_first_run_id text;

INSERT INTO catalog.action_definition
    (action_key, version, component_type_key, target_type, tenant_rule, workspace_rule,
     permission, permission_object_type, execution_mode, confirmation_mode,
     approval_policy_id, approval_policy_version, workflow_type, workflow_kind,
     capacity_policy, capacity_pool_key, quota_policy, meters, result_exposure, audit_policy,
     obs_correlation_mode, obs_progress_source, obs_terminal_source, obs_usage_source,
     obs_cost_source, obs_redaction_policy, status)
SELECT 'task.cancel.' || source.action_key || '.v' || source.version, 1,
       source.component_type_key, 'ACTION_EXECUTION', source.tenant_rule, source.workspace_rule,
       source.permission, source.permission_object_type, 'PROTOCOL', 'NONE',
       NULL, NULL, NULL, NULL,
       'NONE', NULL, 'NONE', '{}', 'NONE', 'FULL_LIFECYCLE',
       'OPERATION_NATIVE_REF', 'NONE', 'NATIVE', 'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE'
FROM catalog.action_definition source
WHERE source.version = 1
  AND source.action_key IN ('workspace.create', 'workspace.member.add',
                            'workspace.member.revoke', 'tenant.member.revoke');

DO $$
BEGIN
    IF (SELECT count(*) FROM catalog.action_definition
        WHERE version = 1 AND action_key IN
            ('task.cancel.workspace.create.v1', 'task.cancel.workspace.member.add.v1',
             'task.cancel.workspace.member.revoke.v1', 'task.cancel.tenant.member.revoke.v1')) <> 4 THEN
        RAISE EXCEPTION '四个原动作的取消控制定义未完整登记'
            USING ERRCODE = 'check_violation';
    END IF;
END;
$$;

-- 同一原动作只容许一项未终结或已被 Temporal 接受的取消意图。普通的
-- action_execution_one_pending_per_target 只覆盖 EVALUATING/WAITING，第一项
-- 进入 ALLOWED 后不再防止第二项；BFF 隐藏按钮也不是并发边界。
CREATE UNIQUE INDEX task_cancel_one_intent_per_original
    ON admission.action_execution (target_id, action_key)
    WHERE action_key LIKE 'task.cancel.%'
      AND gate_state IN ('EVALUATING', 'WAITING', 'ALLOWED')
      AND dispatch_state <> 'ABORTED';
