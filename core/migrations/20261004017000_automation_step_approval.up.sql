-- DD-107 / 03 §4: version-pinned, tenant-scoped optional step approval.
-- Existing platform ActionDefinition policies remain system catalog rows.
-- This migration does not create a policy or grant an approval permission.
ALTER TABLE catalog.approval_policy ADD COLUMN tenant_id uuid REFERENCES identity.tenant(id);
ALTER TABLE catalog.automation_version ADD COLUMN approval_policy_version integer;
ALTER TABLE catalog.automation_version ADD CONSTRAINT automation_approval_policy_pair
    CHECK ((approval_policy_id IS NULL AND approval_policy_version IS NULL)
        OR (approval_policy_id IS NOT NULL AND approval_policy_version IS NOT NULL AND approval_policy_version > 0));
ALTER TABLE catalog.automation_version ADD CONSTRAINT automation_approval_policy_fkey
    FOREIGN KEY (approval_policy_id,approval_policy_version)
    REFERENCES catalog.approval_policy(id,version);

CREATE FUNCTION catalog.guard_automation_approval_policy() RETURNS trigger AS $$
BEGIN
    IF NEW.approval_policy_id IS NOT NULL THEN
        PERFORM 1 FROM catalog.approval_policy p
        JOIN catalog.resource r ON r.id=NEW.automation_resource_id AND r.tenant_id=p.tenant_id
        WHERE p.id=NEW.approval_policy_id AND p.version=NEW.approval_policy_version
          AND p.action_key='automation.run' AND p.target_type='RESOURCE';
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Automation step policy must belong to the same Tenant and action target'
                USING ERRCODE='check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER automation_approval_policy_scope BEFORE INSERT OR UPDATE ON catalog.automation_version
    FOR EACH ROW EXECUTE FUNCTION catalog.guard_automation_approval_policy();

CREATE FUNCTION catalog.freeze_automation_approval_policy() RETURNS trigger AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM catalog.automation_version v
        WHERE v.approval_policy_id=OLD.id AND v.approval_policy_version=OLD.version)
        AND (TG_OP='DELETE' OR (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status')) THEN
        RAISE EXCEPTION 'A version-pinned Automation approval policy is immutable'
            USING ERRCODE='restrict_violation';
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER automation_approval_policy_immutable BEFORE UPDATE OR DELETE ON catalog.approval_policy
    FOR EACH ROW EXECUTE FUNCTION catalog.freeze_automation_approval_policy();

CREATE UNIQUE INDEX automation_step_child_unique ON admission.action_execution(parent_action_execution_id)
    WHERE parent_action_execution_id IS NOT NULL AND action_key='automation.run';

CREATE OR REPLACE FUNCTION admission.guard_action_execution_family() RETURNS trigger AS $$
DECLARE parent admission.action_execution%ROWTYPE;
BEGIN
    IF TG_OP='UPDATE' AND OLD.parent_action_execution_id IS NOT NULL AND OLD.action_key='automation.run'
        AND (NEW.parameters IS DISTINCT FROM OLD.parameters
          OR NEW.approval_workflow_id IS DISTINCT FROM OLD.approval_workflow_id
          OR NEW.approval_expires_at IS DISTINCT FROM OLD.approval_expires_at) THEN
        RAISE EXCEPTION 'Automation approval child input cannot change' USING ERRCODE='check_violation';
    END IF;
    IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id
        OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
        OR NEW.parent_action_execution_id IS DISTINCT FROM OLD.parent_action_execution_id) THEN
        RAISE EXCEPTION 'ActionExecution 不得替换身份、Operation 或 parent' USING ERRCODE='check_violation';
    END IF;
    IF TG_OP='UPDATE' AND (OLD.parent_action_execution_id IS NOT NULL
        OR EXISTS(SELECT 1 FROM admission.action_execution c WHERE c.parent_action_execution_id=OLD.id)) AND (
        NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
        OR NEW.initiator_principal_id IS DISTINCT FROM OLD.initiator_principal_id
        OR NEW.actor_principal_id IS DISTINCT FROM OLD.actor_principal_id
        OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
        OR NEW.action_key IS DISTINCT FROM OLD.action_key OR NEW.action_version IS DISTINCT FROM OLD.action_version
        OR NEW.target_id IS DISTINCT FROM OLD.target_id OR NEW.parameter_hash IS DISTINCT FROM OLD.parameter_hash) THEN
        RAISE EXCEPTION 'ActionExecution family 的冻结 scope 与动作不可替换' USING ERRCODE='check_violation';
    END IF;
    IF NEW.parent_action_execution_id IS NULL OR TG_OP='UPDATE' THEN RETURN NEW; END IF;
    SELECT * INTO parent FROM admission.action_execution WHERE id=NEW.parent_action_execution_id FOR UPDATE;
    IF NOT FOUND OR parent.parent_action_execution_id IS NOT NULL
        OR parent.action_key NOT IN ('agent.invoke','automation.run') OR NEW.id=parent.id
        OR NEW.operation_id IS DISTINCT FROM parent.operation_id OR NEW.tenant_id IS DISTINCT FROM parent.tenant_id
        OR NEW.workspace_id IS DISTINCT FROM parent.workspace_id OR NEW.correlation_id IS DISTINCT FROM parent.correlation_id
        OR NEW.initiator_principal_id IS DISTINCT FROM parent.initiator_principal_id
        OR NEW.actor_principal_id IS DISTINCT FROM parent.actor_principal_id
        OR NEW.action_key NOT IN ('agent.memory.entry.list','agent.memory.entry.read','automation.run') THEN
        RAISE EXCEPTION 'Child must inherit the complete root ActionExecution context' USING ERRCODE='check_violation';
    END IF;
    IF NEW.action_key='automation.run' THEN
        PERFORM 1 FROM catalog.agent_invocation i
        JOIN catalog.automation_version v ON v.asset_id=i.automation_version_asset_id
            AND v.automation_resource_id=i.automation_resource_id
        WHERE i.action_execution_id=parent.id AND parent.action_key='automation.run'
          AND i.tenant_id=NEW.tenant_id AND i.workspace_id=NEW.workspace_id
          AND i.automation_resource_id=NEW.target_id AND NEW.target_id=parent.target_id
          AND NEW.action_version=parent.action_version AND NEW.parameter_hash=parent.parameter_hash
          AND i.status='CREATED' AND i.runtime_turn_id IS NULL AND i.reply_event_id IS NULL
          AND NEW.approval_workflow_id IS NOT NULL AND NEW.temporal_workflow_id IS NULL
          AND NEW.parameters->'automationStepApproval'->>'invocationId'=i.id::text
          AND NEW.parameters->'automationStepApproval'->>'policyId'=v.approval_policy_id::text
          AND NEW.parameters->'automationStepApproval'->>'policyVersion'=v.approval_policy_version::text;
    ELSE
        PERFORM 1 FROM catalog.agent_invocation i
        JOIN catalog.agent_installation installed ON installed.resource_id=i.installation_resource_id
            AND installed.agent_principal_id=NEW.actor_principal_id AND installed.workspace_id=i.workspace_id
        JOIN identity.principal human ON human.id=NEW.initiator_principal_id
            AND human.tenant_id=NEW.tenant_id AND human.kind='HUMAN'
        JOIN identity.principal agent ON agent.id=NEW.actor_principal_id
            AND agent.tenant_id=NEW.tenant_id AND agent.kind='AGENT'
        WHERE i.action_execution_id=parent.id AND i.tenant_id=NEW.tenant_id
            AND i.workspace_id IS NOT DISTINCT FROM NEW.workspace_id AND i.installation_resource_id=NEW.target_id;
    END IF;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Child lacks its exact frozen Invocation and implemented consumer' USING ERRCODE='check_violation';
    END IF;
    UPDATE admission.action_execution SET id=id WHERE id=parent.id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
