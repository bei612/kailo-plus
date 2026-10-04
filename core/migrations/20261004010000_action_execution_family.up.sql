-- 03 §4/§6, 05 §2.1/§5: a governed child inherits its parent's Operation.
-- This column is only the existing root AE's derived key, not an Operation table.
-- SQLx applies this migration transactionally: existing FK values never change.
ALTER TABLE admission.action_execution
    ADD COLUMN parent_action_execution_id uuid
        REFERENCES admission.action_execution(id),
    ADD COLUMN root_operation_id uuid GENERATED ALWAYS AS
        (CASE WHEN parent_action_execution_id IS NULL THEN operation_id END) STORED,
    ADD CONSTRAINT action_execution_root_operation_key UNIQUE(root_operation_id),
    ADD CONSTRAINT action_execution_not_self_parent
        CHECK(parent_action_execution_id IS DISTINCT FROM id),
    ADD CONSTRAINT action_execution_child_workspace_present
        CHECK(parent_action_execution_id IS NULL OR workspace_id IS NOT NULL),
    ADD CONSTRAINT action_execution_parent_context_key
        UNIQUE(id,operation_id,tenant_id,workspace_id,correlation_id,
            initiator_principal_id,actor_principal_id),
    ADD CONSTRAINT action_execution_parent_context_fkey
        FOREIGN KEY(parent_action_execution_id,operation_id,tenant_id,workspace_id,correlation_id,
            initiator_principal_id,actor_principal_id)
        REFERENCES admission.action_execution(id,operation_id,tenant_id,workspace_id,correlation_id,
            initiator_principal_id,actor_principal_id);
CREATE INDEX action_execution_by_parent
    ON admission.action_execution(parent_action_execution_id)
    WHERE parent_action_execution_id IS NOT NULL;

ALTER TABLE admission.capacity_lease DROP CONSTRAINT capacity_lease_operation_id_fkey;
ALTER TABLE projection.agent_model_trace DROP CONSTRAINT agent_model_trace_operation_id_fkey;
ALTER TABLE outbox.usage_event DROP CONSTRAINT usage_event_operation_id_fkey;
ALTER TABLE admission.delegation_use DROP CONSTRAINT delegation_use_operation_id_fkey;
ALTER TABLE admission.capacity_lease ADD CONSTRAINT capacity_lease_operation_id_fkey
    FOREIGN KEY(operation_id) REFERENCES admission.action_execution(root_operation_id);
ALTER TABLE projection.agent_model_trace ADD CONSTRAINT agent_model_trace_operation_id_fkey
    FOREIGN KEY(operation_id) REFERENCES admission.action_execution(root_operation_id);
ALTER TABLE outbox.usage_event ADD CONSTRAINT usage_event_operation_id_fkey
    FOREIGN KEY(operation_id) REFERENCES admission.action_execution(root_operation_id);
ALTER TABLE admission.delegation_use ADD CONSTRAINT delegation_use_operation_id_fkey
    FOREIGN KEY(operation_id) REFERENCES admission.action_execution(root_operation_id);
ALTER TABLE admission.action_execution DROP CONSTRAINT action_execution_operation_id_key;
ALTER TABLE admission.action_execution ADD CONSTRAINT action_execution_root_operation_fkey
    FOREIGN KEY(operation_id) REFERENCES admission.action_execution(root_operation_id);

CREATE FUNCTION admission.guard_action_execution_family() RETURNS trigger AS $$
DECLARE
    parent admission.action_execution%ROWTYPE;
BEGIN
    IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id
        OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
        OR NEW.parent_action_execution_id IS DISTINCT FROM OLD.parent_action_execution_id) THEN
        RAISE EXCEPTION 'ActionExecution 不得替换身份、Operation 或 parent'
            USING ERRCODE='check_violation';
    END IF;
    -- Preserve the pre-existing no-child root writer contract. Once a child
    -- exists, its inherited context cannot be changed through its root either.
    IF TG_OP='UPDATE' AND (OLD.parent_action_execution_id IS NOT NULL
        OR EXISTS(SELECT 1 FROM admission.action_execution c
            WHERE c.parent_action_execution_id=OLD.id)) AND (
        NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
        OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
        OR NEW.initiator_principal_id IS DISTINCT FROM OLD.initiator_principal_id
        OR NEW.actor_principal_id IS DISTINCT FROM OLD.actor_principal_id
        OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
        OR NEW.action_key IS DISTINCT FROM OLD.action_key
        OR NEW.action_version IS DISTINCT FROM OLD.action_version
        OR NEW.target_id IS DISTINCT FROM OLD.target_id
        OR NEW.parameter_hash IS DISTINCT FROM OLD.parameter_hash) THEN
        RAISE EXCEPTION 'ActionExecution family 的冻结 scope 与动作不可替换'
            USING ERRCODE='check_violation';
    END IF;
    -- Existing children have already frozen every inherited field. Progress
    -- updates do not re-lock parent after child (the producer locks root first).
    IF NEW.parent_action_execution_id IS NULL OR TG_OP='UPDATE' THEN
        RETURN NEW;
    END IF;
    -- Serialize child creation on the existing root, in the producer's lock
    -- order. A same-value write prevents an older REPEATABLE READ root writer
    -- from missing the new child while changing its frozen action/target/hash.
    -- No business field or lifecycle timestamp changes.
    SELECT * INTO parent FROM admission.action_execution
        WHERE id=NEW.parent_action_execution_id FOR UPDATE;
    IF NOT FOUND OR parent.parent_action_execution_id IS NOT NULL
        OR parent.action_key NOT IN ('agent.invoke','automation.run')
        OR NEW.id=parent.id
        OR NEW.operation_id IS DISTINCT FROM parent.operation_id
        OR NEW.tenant_id IS DISTINCT FROM parent.tenant_id
        OR NEW.workspace_id IS DISTINCT FROM parent.workspace_id
        OR NEW.correlation_id IS DISTINCT FROM parent.correlation_id
        OR NEW.initiator_principal_id IS DISTINCT FROM parent.initiator_principal_id
        OR NEW.actor_principal_id IS DISTINCT FROM parent.actor_principal_id
        OR NEW.action_key NOT IN ('agent.memory.entry.list','agent.memory.entry.read') THEN
        RAISE EXCEPTION 'Memory child 必须继承同一 root ActionExecution 的完整上下文'
            USING ERRCODE='check_violation';
    END IF;
    -- Only the two implemented, own-Installation Memory consumers produce
    -- children. This is not permission/Delegation/Quota admission or a tool grant.
    PERFORM 1 FROM catalog.agent_invocation i
    JOIN catalog.agent_installation installed ON installed.resource_id=i.installation_resource_id
        AND installed.agent_principal_id=NEW.actor_principal_id
        AND installed.workspace_id=i.workspace_id
    JOIN identity.principal human ON human.id=NEW.initiator_principal_id
        AND human.tenant_id=NEW.tenant_id AND human.kind='HUMAN'
    JOIN identity.principal agent ON agent.id=NEW.actor_principal_id
        AND agent.tenant_id=NEW.tenant_id AND agent.kind='AGENT'
    WHERE i.action_execution_id=parent.id AND i.tenant_id=NEW.tenant_id
        AND i.workspace_id IS NOT DISTINCT FROM NEW.workspace_id
        AND i.installation_resource_id=NEW.target_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Memory child 缺同 scope 的原 Invocation 与自身 Installation'
            USING ERRCODE='check_violation';
    END IF;
    UPDATE admission.action_execution SET id=id WHERE id=parent.id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER action_execution_family_guard BEFORE INSERT OR UPDATE ON admission.action_execution
    FOR EACH ROW EXECUTE FUNCTION admission.guard_action_execution_family();

-- DelegationUse remains one use per (Grant, Operation), not one use per child.
-- Its original AE -> Tenant -> Grant lock order and admission checks are kept.
CREATE OR REPLACE FUNCTION admission.guard_delegation_use() RETURNS trigger AS $$
DECLARE
    g admission.delegation_grant%ROWTYPE;
    execution_id uuid;
    grant_tenant uuid;
BEGIN
    IF TG_OP='UPDATE' OR TG_OP='DELETE' THEN
        RAISE EXCEPTION 'DelegationUse 是首次dispatch证据，不能改写或抹去' USING ERRCODE='restrict_violation';
    END IF;
    SELECT id INTO execution_id FROM admission.action_execution
        WHERE root_operation_id=NEW.operation_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'DelegationUse缺准入operation' USING ERRCODE='check_violation';
    END IF;
    SELECT tenant_id INTO grant_tenant FROM admission.delegation_grant WHERE id=NEW.delegation_id;
    PERFORM 1 FROM identity.tenant WHERE id=grant_tenant FOR UPDATE;
    SELECT * INTO g FROM admission.delegation_grant WHERE id=NEW.delegation_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'DelegationUse缺Grant' USING ERRCODE='check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM admission.delegation_use
        WHERE delegation_id=NEW.delegation_id AND operation_id=NEW.operation_id) THEN
        RETURN NEW;
    END IF;
    IF g.state<>'ACTIVE' OR g.valid_from>now() OR g.expires_at<=now()
        OR (g.max_uses IS NOT NULL AND (SELECT count(*) FROM admission.delegation_use
            WHERE delegation_id=g.id)>=g.max_uses) THEN
        RAISE EXCEPTION 'Delegation已失效或使用次数耗尽' USING ERRCODE='check_violation';
    END IF;
    PERFORM 1 FROM admission.action_execution ae
    JOIN catalog.action_definition a ON a.action_key=ae.action_key AND a.version=ae.action_version
        AND a.status='ACTIVE'
    JOIN admission.delegation_scope s ON s.delegation_id=g.id
        AND s.action_key=ae.action_key AND s.action_version=ae.action_version
        AND s.target_type=a.target_type
    JOIN catalog.result_exposure_policy p ON p.id=s.result_exposure_policy_id
        AND p.version=s.result_exposure_policy_version AND p.status='ACTIVE'
    JOIN catalog.agent_installation i ON i.resource_id=g.installation_resource_id
        AND i.agent_principal_id=g.agent_principal_id AND i.workspace_id=g.workspace_id AND i.state='ACTIVE'
    JOIN identity.tenant t ON t.id=g.tenant_id AND t.state='ACTIVE'
    JOIN identity.workspace w ON w.id=g.workspace_id AND w.tenant_id=t.id AND w.state='ACTIVE'
    JOIN identity.principal human ON human.id=g.grantor_principal_id AND human.tenant_id=t.id
        AND human.kind='HUMAN' AND human.status='ACTIVE'
    JOIN identity.tenant_membership tm ON tm.tenant_principal_id=human.id AND tm.tenant_id=t.id AND tm.state='ACTIVE'
    WHERE ae.id=execution_id AND ae.operation_id=NEW.operation_id
        AND ae.tenant_id=g.tenant_id AND ae.workspace_id=g.workspace_id
        AND ae.initiator_principal_id=g.grantor_principal_id AND ae.actor_principal_id=g.agent_principal_id
        AND ae.gate_state='ALLOWED' AND ae.dispatch_state='NOT_DISPATCHED'
        AND (s.target_id=ae.target_id OR (s.target_id IS NULL AND s.create_workspace_id=ae.workspace_id))
        AND (s.target_id IS NULL OR EXISTS (SELECT 1 FROM catalog.resource r
            WHERE r.id=s.target_id AND r.tenant_id=g.tenant_id AND r.state='ACTIVE'
                AND r.projection_action_execution_id IS NULL AND r.application_binding_id IS NULL
                AND (r.home_workspace_id IS NULL OR r.home_workspace_id=g.workspace_id)))
    FOR NO KEY UPDATE OF t,w,human,tm;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'DelegationUse必须绑定同scope、同grantor/Agent的准入operation和exact action'
            USING ERRCODE='check_violation';
    END IF;
    NEW.first_dispatch_at=now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
