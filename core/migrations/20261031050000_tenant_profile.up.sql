-- DD-158(3): Tenant display name/icon, through the existing governed action chain.
-- 1. Tenant 图标：≤96 KiB 的 PNG/JPEG/WebP data URL，或单个 emoji（由 Core 按完整 Unicode emoji 序列校验）。
ALTER TABLE identity.tenant ADD COLUMN icon text;
ALTER TABLE identity.tenant ADD CONSTRAINT tenant_icon_check CHECK (
    icon IS NULL
    OR (icon ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$' AND octet_length(icon) <= 98304)
    OR (icon !~ '^data:' AND btrim(icon) = icon AND octet_length(icon) BETWEEN 1 AND 128));

-- 3. 05 §2.11 的唯一 ActionDefinition 策略：目标会话 Tenant、manage@tenant、SYNC、EXPLICIT、无审批，
--    quota NONE、meters 空、ResultExposure NONE。准入事务内按 Tenant version CAS 改写并落定。
INSERT INTO catalog.action_definition
    (action_key, version, component_type_key, target_type, tenant_rule, workspace_rule,
     permission, permission_object_type, execution_mode, confirmation_mode,
     approval_policy_id, approval_policy_version, workflow_type, workflow_kind,
     capacity_policy, capacity_pool_key, quota_policy, meters, result_exposure, audit_policy,
     obs_correlation_mode, obs_progress_source, obs_terminal_source, obs_usage_source,
     obs_cost_source, obs_redaction_policy, status)
VALUES
    ('tenant.profile.update', 1, 'core', 'TENANT', 'SESSION_TENANT', 'TENANT_ONLY',
     'manage', 'tenant', 'SYNC', 'EXPLICIT', NULL, NULL, NULL, NULL,
     'NONE', NULL, 'NONE', '{}'::text[], 'NONE', 'FULL_LIFECYCLE',
     'OPERATION_REF', 'NONE', 'SYNC_RESULT', 'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE');
