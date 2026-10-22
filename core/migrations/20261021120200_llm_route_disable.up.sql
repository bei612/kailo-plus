-- DD-134(7)、design 05 §2.13：llm_route.disable。HUMAN 发起、route Resource manage、
-- EXPLICIT 无审批（撤销方向不设审批）；SYNC：准入事务内 route ACTIVE→RETAINED_READ_ONLY，
-- 派发以既有退役路径删除 Gateway provider/model/virtualModel 投影并回读不存在。
INSERT INTO catalog.action_definition
    (action_key, version, component_type_key, target_type, tenant_rule, workspace_rule,
     permission, permission_object_type, execution_mode, confirmation_mode,
     approval_policy_id, approval_policy_version, workflow_type, workflow_kind,
     capacity_policy, capacity_pool_key, quota_policy, meters, result_exposure, audit_policy,
     obs_correlation_mode, obs_progress_source, obs_terminal_source, obs_usage_source,
     obs_cost_source, obs_redaction_policy, status)
VALUES
    ('llm_route.disable', 1, 'core', 'RESOURCE', 'SESSION_TENANT', 'TARGET_HOME_WORKSPACE',
     'manage', 'resource', 'SYNC', 'EXPLICIT', NULL, NULL, NULL, NULL,
     'NONE', NULL, 'NONE', '{}'::text[], 'NONE', 'FULL_LIFECYCLE',
     'OPERATION_REF', 'NONE', 'SYNC_RESULT', 'NONE', 'NONE', 'PLATFORM_METADATA_ONLY', 'ACTIVE');
