-- DD-150（修订 DD-46、DD-119(7)）、05 §2 workspace.delete、V-SCN-247：原版频道删除恢复为受治理动作。
--
-- 1. Workspace 状态机加入 DELETING/DELETED。DELETING 与 SUSPENDING 一样关闭 scope、stream、
--    Schedule 与新动作；DELETED 是墓碑，名称与 slug 不复用（UNIQUE(tenant_id, slug) 保留）。
-- 2. admission.workspace_lifecycle_snapshot：准入事务内冻结的 WorkspaceLifecycleSnapshot，与
--    TenantLifecycleSnapshot 同一形态，只保存 Workspace 范围内 Resource、Asset、owner、
--    Installation 与组件 binding 的 ID+version 及其 digest，不保存业务正文。evidence 逐步记录
--    删除链各段的回读证据（AGENTS、RELAY、SPICEDB），全部确认后才置 DELETED。
-- 3. workspace.delete：从 Tenant scope 指向 Workspace（ACTIVE 或 SUSPENDED 都可删除，已暂停的
--    Workspace scope 已关闭），在目标 Workspace 上检查 manage（≙ 原 Channel owner，DD-82 无
--    owner/admin 两级），只接受 HUMAN；EXPLICIT 确认、无审批，由 WORKSPACE_LIFECYCLE 的 DELETE
--    段收敛。旧版本 Core 没有该 key 的语义，按 BLOCKED 拒绝。
-- 库内生命周期多一个墓碑 DELETED，对外契约 enums/workspace_state 不含它（任何视图都不返回已删除的
-- Workspace），所以库约束改名为 workspace_state_lifecycle，不再按 *_enum 与契约逐值比对。
ALTER TABLE identity.workspace DROP CONSTRAINT workspace_state_enum;
ALTER TABLE identity.workspace ADD CONSTRAINT workspace_state_lifecycle CHECK (state IN
    ('PROVISIONING','ACTIVE','SUSPENDING','SUSPENDED','RESTORING','DELETING','DELETED','ERROR'));

CREATE TABLE admission.workspace_lifecycle_snapshot (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES identity.tenant(id),
    workspace_id uuid NOT NULL REFERENCES identity.workspace(id),
    action_execution_id uuid NOT NULL UNIQUE REFERENCES admission.action_execution(id),
    -- 准入落定后（已置 DELETING）的 Workspace 版本；DELETE 段的 Workflow 以它做乐观并发
    workspace_version integer NOT NULL CHECK (workspace_version > 0),
    -- 删除前的状态（ACTIVE 或 SUSPENDED）：已暂停的 Channel 已归档，9008 前须先解档
    from_state text NOT NULL CHECK (from_state IN ('ACTIVE','SUSPENDED')),
    frozen_inventory jsonb NOT NULL CHECK (jsonb_typeof(frozen_inventory) = 'object'),
    inventory_digest text NOT NULL CHECK (inventory_digest ~ '^[0-9a-f]{64}$'),
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
    state text NOT NULL CONSTRAINT workspace_lifecycle_snapshot_state_enum
        CHECK (state IN ('DELETING','DELETED','ABORTED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
-- 同一 Workspace 至多一个进行中的删除
CREATE UNIQUE INDEX workspace_lifecycle_snapshot_one_open
    ON admission.workspace_lifecycle_snapshot (workspace_id) WHERE state = 'DELETING';

-- 冻结清单不可改写；DELETING 期间只推进 evidence 与状态，DELETED/ABORTED 之后不再改写
CREATE FUNCTION admission.guard_workspace_lifecycle_snapshot() RETURNS trigger AS $$
BEGIN
    IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.workspace_id <> OLD.workspace_id
        OR NEW.action_execution_id <> OLD.action_execution_id
        OR NEW.workspace_version <> OLD.workspace_version OR NEW.from_state <> OLD.from_state
        OR NEW.frozen_inventory IS DISTINCT FROM OLD.frozen_inventory
        OR NEW.inventory_digest <> OLD.inventory_digest
        OR (OLD.state <> 'DELETING' AND (NEW.state <> OLD.state OR NEW.evidence IS DISTINCT FROM OLD.evidence)) THEN
        RAISE EXCEPTION 'WorkspaceLifecycleSnapshot 冻结清单不可改写，终态不可回退'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER workspace_lifecycle_snapshot_guard BEFORE UPDATE
    ON admission.workspace_lifecycle_snapshot FOR EACH ROW
    EXECUTE FUNCTION admission.guard_workspace_lifecycle_snapshot();

INSERT INTO catalog.action_definition
    (action_key, version, component_type_key, target_type, tenant_rule, workspace_rule,
     permission, permission_object_type, execution_mode, confirmation_mode,
     approval_policy_id, approval_policy_version, workflow_type, workflow_kind,
     capacity_policy, capacity_pool_key, quota_policy, meters, result_exposure, audit_policy,
     obs_correlation_mode, obs_progress_source, obs_terminal_source, obs_usage_source,
     obs_cost_source, obs_redaction_policy, status)
VALUES
    ('workspace.delete', 1, 'core', 'WORKSPACE', 'SESSION_TENANT', 'TENANT_ONLY',
     'manage', 'workspace', 'TEMPORAL', 'EXPLICIT', NULL, NULL, 'ComponentTaskWorkflow', 'WORKSPACE_LIFECYCLE',
     'NONE', NULL, 'NONE', '{}', 'NONE', 'FULL_LIFECYCLE',
     'OPERATION_REF', 'TEMPORAL', 'TEMPORAL', 'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE');
