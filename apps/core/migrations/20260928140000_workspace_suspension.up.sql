-- Workspace 暂停与恢复（.design/06 §7.3、.design/03 §2、DD-46、V-SCN-36）。
--
-- 两个动作都是 Tenant 级管理意图：从 Tenant scope 指向 Workspace，不借用被暂停的
-- Workspace scope（.design/03 §2、.design/10 §5），因此 TENANT_ONLY、在所属 Tenant 上
-- 检查 manage。设计未给这两个动作规定审批，这里不另加。
--
-- 目标状态的推进（ACTIVE→SUSPENDING、SUSPENDED→RESTORING）在准入落定的同一事务里
-- 完成，由 WORKSPACE_LIFECYCLE Workflow 收敛到 SUSPENDED 或 ACTIVE。Workspace delete
-- 按 DD-46 仍不登记。本次不登记这两个动作的取消与重跑控制定义（DD-84 只对已登记
-- 专属控制定义的原动作开放）。
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
    ('workspace.suspend', 1, 'core', 'WORKSPACE', 'SESSION_TENANT', 'TENANT_ONLY',
     'manage', 'tenant', 'TEMPORAL', 'NONE', NULL, NULL, 'ComponentTaskWorkflow', 'WORKSPACE_LIFECYCLE',
     'NONE', NULL, 'NONE', '{}', 'NONE', 'FULL_LIFECYCLE',
     'OPERATION_REF', 'TEMPORAL', 'TEMPORAL', 'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE'),
    ('workspace.restore', 1, 'core', 'WORKSPACE', 'SESSION_TENANT', 'TENANT_ONLY',
     'manage', 'tenant', 'TEMPORAL', 'NONE', NULL, NULL, 'ComponentTaskWorkflow', 'WORKSPACE_LIFECYCLE',
     'NONE', NULL, 'NONE', '{}', 'NONE', 'FULL_LIFECYCLE',
     'OPERATION_REF', 'TEMPORAL', 'TEMPORAL', 'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE');
