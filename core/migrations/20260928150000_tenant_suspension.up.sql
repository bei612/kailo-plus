-- 业务 Tenant 的暂停与恢复（DD-96、.design/06 §7.2 第 1–2 步、V-SCN-31 暂停部分）。
--
-- 两个动作都在 Platform Catalog Tenant 中执行：tenant_rule=SESSION_TENANT 取发起者
-- 的会话 Tenant（必须是 Catalog，Core 另行核对），target_type=TENANT 指向业务 Tenant，
-- permission 检查 Catalog Tenant 的 manage（DD-96(1)）。确认方式 EXPLICIT，不设审批，
-- quota/meter 为 NONE。被暂停的 Tenant 不能由自身 scope 发起恢复。
--
-- 业务 Tenant 一侧由它自己的 TENANT_LIFECYCLE operation、WorkflowRef 与审计承接
-- （.design/03 §6 TENANT_ONLY 的唯一例外）。Tenant delete 与受限会话随 Stage 3，
-- 不在此登记。
--
-- 扩展一步：只加 Catalog 行。旧版本 Core 没有这两个 key 的语义，按 BLOCKED 拒绝。
INSERT INTO catalog.action_definition
    (action_key, version, component_type_key, target_type, tenant_rule, workspace_rule,
     permission, permission_object_type, execution_mode, confirmation_mode,
     approval_policy_id, approval_policy_version, workflow_type, workflow_kind,
     capacity_policy, capacity_pool_key, quota_policy, meters, result_exposure, audit_policy,
     obs_correlation_mode, obs_progress_source, obs_terminal_source, obs_usage_source,
     obs_cost_source, obs_redaction_policy, status)
VALUES
    ('tenant.suspend', 1, 'core', 'TENANT', 'SESSION_TENANT', 'TENANT_ONLY',
     'manage', 'tenant', 'TEMPORAL', 'EXPLICIT', NULL, NULL, 'ComponentTaskWorkflow', 'TENANT_LIFECYCLE',
     'NONE', NULL, 'NONE', '{}', 'NONE', 'FULL_LIFECYCLE',
     'OPERATION_REF', 'TEMPORAL', 'TEMPORAL', 'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE'),
    ('tenant.restore', 1, 'core', 'TENANT', 'SESSION_TENANT', 'TENANT_ONLY',
     'manage', 'tenant', 'TEMPORAL', 'EXPLICIT', NULL, NULL, 'ComponentTaskWorkflow', 'TENANT_LIFECYCLE',
     'NONE', NULL, 'NONE', '{}', 'NONE', 'FULL_LIFECYCLE',
     'OPERATION_REF', 'TEMPORAL', 'TEMPORAL', 'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE');
