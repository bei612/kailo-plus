-- DD-84：每个已交付的原 action/version 独立登记重跑控制。新控制动作
-- 以原 ActionExecution 为 target，并重新承担原动作相同的审批要求。
INSERT INTO catalog.approval_policy
    (id, version, action_key, target_type, role_requirements, owner_requirement,
     self_approval, expires_in_seconds, status)
SELECT 'ae4bd8d6-2e9f-4abc-8c47-86fd6d0e9101', 1,
       'task.rerun.tenant.member.revoke.v1', 'ACTION_EXECUTION',
       role_requirements, owner_requirement, self_approval, expires_in_seconds, status
FROM catalog.approval_policy
WHERE id = '6f1c0b52-6a55-4d0e-9a53-7c3f2a4e1b01' AND version = 1;

INSERT INTO catalog.action_definition
    (action_key, version, component_type_key, target_type, tenant_rule, workspace_rule,
     permission, permission_object_type, execution_mode, confirmation_mode,
     approval_policy_id, approval_policy_version, workflow_type, workflow_kind,
     capacity_policy, capacity_pool_key, quota_policy, meters, result_exposure, audit_policy,
     obs_correlation_mode, obs_progress_source, obs_terminal_source, obs_usage_source,
     obs_cost_source, obs_redaction_policy, status)
SELECT 'task.rerun.' || source.action_key || '.v' || source.version, 1,
       source.component_type_key, 'ACTION_EXECUTION', source.tenant_rule, source.workspace_rule,
       source.permission, source.permission_object_type, 'PROTOCOL', source.confirmation_mode,
       CASE WHEN source.confirmation_mode = 'APPROVAL'
            THEN 'ae4bd8d6-2e9f-4abc-8c47-86fd6d0e9101'::uuid END,
       CASE WHEN source.confirmation_mode = 'APPROVAL' THEN 1 END,
       NULL, NULL, 'NONE', NULL, 'NONE', '{}', 'NONE', 'FULL_LIFECYCLE',
       'OPERATION_NATIVE_REF', 'NONE', 'NATIVE', 'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE'
FROM catalog.action_definition source
WHERE source.version = 1
  AND source.action_key IN ('workspace.create', 'workspace.member.add',
                            'workspace.member.revoke', 'tenant.member.revoke');

DO $$
BEGIN
    IF (SELECT count(*) FROM catalog.action_definition
        WHERE version = 1 AND action_key IN
            ('task.rerun.workspace.create.v1', 'task.rerun.workspace.member.add.v1',
             'task.rerun.workspace.member.revoke.v1', 'task.rerun.tenant.member.revoke.v1')) <> 4
       OR (SELECT count(*) FROM catalog.approval_policy
           WHERE id = 'ae4bd8d6-2e9f-4abc-8c47-86fd6d0e9101' AND version = 1) <> 1 THEN
        RAISE EXCEPTION '四个重跑控制定义或独立审批策略未完整登记'
            USING ERRCODE = 'check_violation';
    END IF;
END;
$$;

-- 原动作一次失败事实只能驱动一次新 Workflow；并发请求不能在 ALLOWED 后
-- 绕开 admission.action_execution 的在途唯一约束。
CREATE UNIQUE INDEX task_rerun_one_intent_per_original
    ON admission.action_execution (target_id, action_key)
    WHERE action_key LIKE 'task.rerun.%'
      AND gate_state IN ('EVALUATING', 'WAITING', 'ALLOWED')
      AND dispatch_state <> 'ABORTED';
