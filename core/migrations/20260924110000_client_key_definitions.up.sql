-- 设备公钥登记与撤销改走统一准入（apps/AGENTS.md 规则 9、.design/03 §4「每个治理入口
-- 都有 operation_id 和 ActionDecision」、DD-79）。
--
-- 目标是调用方自己的 Principal；固定 schema 没有 principal 上的 permission
-- （.design/03 §5），因此在所属 Tenant 上检查 discover——它由 Tenant 成员关系投影
-- 得出（`tenant#member`），撤权后 fresh Check 即为假，是这两个动作真实的授权前提。
-- 持钥证明、设备上界与 binding 状态机仍由 client_keys 模块执行。
INSERT INTO catalog.action_definition
    (action_key, version, component_type_key, target_type, tenant_rule, workspace_rule,
     permission, permission_object_type, execution_mode, confirmation_mode,
     approval_policy_id, approval_policy_version, workflow_type, workflow_kind,
     capacity_policy, capacity_pool_key, quota_policy, meters, result_exposure, audit_policy,
     obs_correlation_mode, obs_progress_source, obs_terminal_source, obs_usage_source,
     obs_cost_source, obs_redaction_policy, status)
VALUES
    ('identity.client_key.register', 1, 'buzz', 'PRINCIPAL', 'SESSION_TENANT', 'TENANT_ONLY',
     'discover', 'tenant', 'TEMPORAL', 'NONE', NULL, NULL, 'ComponentTaskWorkflow', 'BUZZ_IDENTITY_PROJECTION',
     'NONE', NULL, 'NONE', '{}', 'NONE', 'FULL_LIFECYCLE',
     'OPERATION_REF', 'TEMPORAL', 'TEMPORAL', 'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE'),
    ('identity.client_key.revoke', 1, 'buzz', 'PRINCIPAL', 'SESSION_TENANT', 'TENANT_ONLY',
     'discover', 'tenant', 'TEMPORAL', 'NONE', NULL, NULL, 'ComponentTaskWorkflow', 'BUZZ_IDENTITY_PROJECTION',
     'NONE', NULL, 'NONE', '{}', 'NONE', 'FULL_LIFECYCLE',
     'OPERATION_REF', 'TEMPORAL', 'TEMPORAL', 'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE');
