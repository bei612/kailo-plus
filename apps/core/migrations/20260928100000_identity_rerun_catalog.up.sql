-- DD-84：已交付的原生设备登记/撤销动作各有独立重跑控制定义。
-- 控制仍以原 ActionExecution 为目标，权限与 scope 从原定义逐值复制；
-- 只有原动作的 HUMAN 发起者能在 Temporal 终态证明成立后提交。
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
       NULL, NULL, NULL, NULL, 'NONE', NULL, 'NONE', '{}', 'NONE', 'FULL_LIFECYCLE',
       'OPERATION_NATIVE_REF', 'NONE', 'NATIVE', 'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE'
FROM catalog.action_definition source
WHERE source.version = 1
  AND source.status = 'ACTIVE'
  AND source.confirmation_mode = 'NONE'
  AND source.workflow_kind = 'BUZZ_IDENTITY_PROJECTION'
  AND source.action_key IN ('identity.client_key.register', 'identity.client_key.revoke');

DO $$
BEGIN
    IF (SELECT count(*) FROM catalog.action_definition WHERE version = 1
        AND action_key IN ('task.rerun.identity.client_key.register.v1',
                           'task.rerun.identity.client_key.revoke.v1')) <> 2 THEN
        RAISE EXCEPTION '原生设备身份投影的两条重跑控制定义未完整登记'
            USING ERRCODE = 'check_violation';
    END IF;
END;
$$;
