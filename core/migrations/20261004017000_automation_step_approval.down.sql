-- Stop rather than discard policy scope, frozen Version references or child history.
DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM catalog.automation_version WHERE approval_policy_id IS NOT NULL)
        OR EXISTS(SELECT 1 FROM admission.action_execution WHERE parent_action_execution_id IS NOT NULL AND action_key='automation.run')
        OR EXISTS(SELECT 1 FROM catalog.approval_policy WHERE tenant_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Automation step approval references exist; stop rollback';
    END IF;
END $$;
DROP INDEX admission.automation_step_child_unique;
DROP TRIGGER automation_approval_policy_immutable ON catalog.approval_policy;
DROP FUNCTION catalog.freeze_automation_approval_policy();
DROP TRIGGER automation_approval_policy_scope ON catalog.automation_version;
DROP FUNCTION catalog.guard_automation_approval_policy();
ALTER TABLE catalog.automation_version DROP CONSTRAINT automation_approval_policy_fkey;
ALTER TABLE catalog.automation_version DROP CONSTRAINT automation_approval_policy_pair;
ALTER TABLE catalog.automation_version DROP COLUMN approval_policy_version;
ALTER TABLE catalog.approval_policy DROP COLUMN tenant_id;
CREATE OR REPLACE FUNCTION admission.guard_action_execution_family() RETURNS trigger AS $$
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
