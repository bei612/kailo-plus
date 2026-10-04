-- An old writer cannot interpret child executions. Stop rather than deleting
-- their approval/audit/native/usage evidence or assigning a second Operation.
LOCK TABLE admission.action_execution IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
    IF EXISTS(SELECT 1 FROM admission.action_execution WHERE parent_action_execution_id IS NOT NULL) THEN
        RAISE EXCEPTION 'ActionExecution child 已存在，停止回退；不得删除 child 或改写 Operation'
            USING ERRCODE='restrict_violation';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION admission.guard_delegation_use() RETURNS trigger AS $$
DECLARE
    g admission.delegation_grant%ROWTYPE;
    execution_id uuid;
    grant_tenant uuid;
BEGIN
    IF TG_OP='UPDATE' OR TG_OP='DELETE' THEN
        RAISE EXCEPTION 'DelegationUse 是首次dispatch证据，不能改写或抹去' USING ERRCODE='restrict_violation';
    END IF;
    SELECT id INTO execution_id FROM admission.action_execution WHERE operation_id=NEW.operation_id FOR UPDATE;
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
    WHERE ae.operation_id=NEW.operation_id AND ae.tenant_id=g.tenant_id AND ae.workspace_id=g.workspace_id
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

DROP TRIGGER action_execution_family_guard ON admission.action_execution;
DROP FUNCTION admission.guard_action_execution_family();
ALTER TABLE admission.action_execution DROP CONSTRAINT action_execution_root_operation_fkey;
ALTER TABLE admission.capacity_lease DROP CONSTRAINT capacity_lease_operation_id_fkey;
ALTER TABLE projection.agent_model_trace DROP CONSTRAINT agent_model_trace_operation_id_fkey;
ALTER TABLE outbox.usage_event DROP CONSTRAINT usage_event_operation_id_fkey;
ALTER TABLE admission.delegation_use DROP CONSTRAINT delegation_use_operation_id_fkey;
ALTER TABLE admission.action_execution ADD CONSTRAINT action_execution_operation_id_key UNIQUE(operation_id);
ALTER TABLE admission.capacity_lease ADD CONSTRAINT capacity_lease_operation_id_fkey
    FOREIGN KEY(operation_id) REFERENCES admission.action_execution(operation_id);
ALTER TABLE projection.agent_model_trace ADD CONSTRAINT agent_model_trace_operation_id_fkey
    FOREIGN KEY(operation_id) REFERENCES admission.action_execution(operation_id);
ALTER TABLE outbox.usage_event ADD CONSTRAINT usage_event_operation_id_fkey
    FOREIGN KEY(operation_id) REFERENCES admission.action_execution(operation_id);
ALTER TABLE admission.delegation_use ADD CONSTRAINT delegation_use_operation_id_fkey
    FOREIGN KEY(operation_id) REFERENCES admission.action_execution(operation_id);
DROP INDEX admission.action_execution_by_parent;
ALTER TABLE admission.action_execution
    DROP CONSTRAINT action_execution_parent_context_fkey,
    DROP CONSTRAINT action_execution_parent_context_key,
    DROP COLUMN root_operation_id,
    DROP COLUMN parent_action_execution_id;
