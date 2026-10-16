-- DD-119：原版频道管理入口经 Core（SF-BUZ-50、V-SCN-94–98）。
--
-- workspace.update 是 Workspace 内的管理意图：执行 Workspace 即目标 Workspace，在其上
-- 检查 manage（对应原版 owner/admin），由 WORKSPACE_LIFECYCLE 的 METADATA 段以 Tenant
-- CONTROL 9002 回读收敛名称、描述与 TTL；可见性只是 Core 事实，在准入事务内改写。设计
-- 未规定审批，这里不另加。「同一 Workspace 至多一个未终结的 workspace.update」在准入
-- 的 Workspace 行锁下判定（ActionExecution 与其 WorkflowRef 的终态是唯一事实来源），
-- 不另建第二份在途标记。
--
-- workspace.leave 的主体固定为发起人：在目标 Workspace 上检查 discover，复用
-- workspace.member.revoke 的 MEMBERSHIP_REVOCATION 撤员链（含角色撤销），不发 9022。
--
-- 扩展一步：只加 Catalog 行。旧版本 Core 没有这两个 key 的语义，按 BLOCKED 拒绝。
-- 本次不登记它们的取消与重跑控制定义（DD-84 只对已登记专属控制定义的原动作开放）。
INSERT INTO catalog.action_definition
    (action_key, version, component_type_key, target_type, tenant_rule, workspace_rule,
     permission, permission_object_type, execution_mode, confirmation_mode,
     approval_policy_id, approval_policy_version, workflow_type, workflow_kind,
     capacity_policy, capacity_pool_key, quota_policy, meters, result_exposure, audit_policy,
     obs_correlation_mode, obs_progress_source, obs_terminal_source, obs_usage_source,
     obs_cost_source, obs_redaction_policy, status)
VALUES
    ('workspace.update', 1, 'core', 'WORKSPACE', 'SESSION_TENANT', 'WORKSPACE_REQUIRED',
     'manage', 'workspace', 'TEMPORAL', 'NONE', NULL, NULL, 'ComponentTaskWorkflow', 'WORKSPACE_LIFECYCLE',
     'NONE', NULL, 'NONE', '{}', 'NONE', 'FULL_LIFECYCLE',
     'OPERATION_REF', 'TEMPORAL', 'TEMPORAL', 'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE'),
    ('workspace.leave', 1, 'core', 'WORKSPACE_MEMBERSHIP', 'SESSION_TENANT', 'WORKSPACE_REQUIRED',
     'discover', 'workspace', 'TEMPORAL', 'NONE', NULL, NULL, 'ComponentTaskWorkflow', 'MEMBERSHIP_REVOCATION',
     'NONE', NULL, 'NONE', '{}', 'NONE', 'FULL_LIFECYCLE',
     'OPERATION_REF', 'TEMPORAL', 'TEMPORAL', 'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE');
