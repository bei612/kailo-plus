-- Never erase application implementation/history or merge independent machine
-- identities to restore a formerly global unique index.
DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM catalog.action_definition WHERE component_release_id IS NOT NULL)
       OR EXISTS(SELECT 1 FROM catalog.resource_type_definition WHERE component_release_id IS NOT NULL)
       OR EXISTS(SELECT 1 FROM admission.action_execution WHERE component_binding_kind IS NOT NULL)
       OR EXISTS(SELECT 1 FROM identity.service_principal GROUP BY audience HAVING count(*)>1) THEN
        RAISE EXCEPTION 'application declarations, executions or shared receiver audiences prevent downgrade';
    END IF;
END $$;
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
DROP TRIGGER aa_execution_definition ON admission.action_execution;
DROP FUNCTION admission.freeze_execution_definition();
ALTER TABLE admission.action_execution
    DROP CONSTRAINT action_execution_application_projection,
    DROP CONSTRAINT action_execution_application_ref,
    DROP CONSTRAINT action_execution_definition_release,
    DROP CONSTRAINT action_execution_exact_definition,
    DROP COLUMN action_definition_id,
    DROP COLUMN component_binding_kind,
    DROP COLUMN component_binding_id,
    DROP COLUMN component_release_id,
    DROP COLUMN component_projection_generation;
ALTER TABLE projection.application_runtime DROP CONSTRAINT application_runtime_release_locator;
DROP TRIGGER aa_resource_type_definition ON catalog.resource;
DROP FUNCTION catalog.freeze_resource_type_definition();
ALTER TABLE catalog.resource DROP CONSTRAINT resource_exact_type_definition;
ALTER TABLE catalog.resource DROP COLUMN resource_type_definition_id;
DROP TRIGGER application_resource_type_immutable ON catalog.resource_type_definition;
DROP FUNCTION catalog.guard_resource_type_declaration();
DROP TRIGGER application_resource_type_source ON catalog.resource_type_definition;
DROP TRIGGER application_action_definition_source ON catalog.action_definition;
DROP FUNCTION catalog.guard_application_definition();
DROP TRIGGER aa_delegation_definition ON admission.delegation_scope;
DROP FUNCTION admission.freeze_delegation_definition();
DROP FUNCTION catalog.action_definition_for_scope(text,integer,text,uuid,uuid);
ALTER TABLE admission.delegation_scope DROP CONSTRAINT delegation_scope_exact_definition;
ALTER TABLE admission.delegation_scope DROP COLUMN action_definition_id;
ALTER TABLE catalog.action_definition
    DROP CONSTRAINT action_definition_pkey,
    DROP CONSTRAINT action_definition_locator,
    DROP CONSTRAINT action_definition_release_locator,
    DROP CONSTRAINT action_definition_platform_version,
    DROP CONSTRAINT action_definition_release_version,
    DROP CONSTRAINT action_definition_release_declaration,
    DROP CONSTRAINT capacity_not_yet_enforced,
    DROP CONSTRAINT result_exposure_enum;
DROP INDEX catalog.action_definition_release_active;
DROP INDEX catalog.action_definition_one_active;
ALTER TABLE catalog.action_definition
    DROP COLUMN platform_action_key,
    DROP COLUMN id,
    DROP COLUMN component_release_id,
    DROP COLUMN implementation_declaration,
    ADD PRIMARY KEY(action_key,version);
CREATE UNIQUE INDEX action_definition_one_active ON catalog.action_definition(action_key) WHERE status='ACTIVE';
ALTER TABLE catalog.action_definition ADD CONSTRAINT capacity_not_yet_enforced CHECK(capacity_policy IN ('NONE','PLATFORM_SLOT'));
ALTER TABLE catalog.action_definition ADD CONSTRAINT result_exposure_enum CHECK(result_exposure IN ('NONE','READ'));
ALTER TABLE admission.delegation_scope ADD CONSTRAINT delegation_scope_action_key_action_version_fkey
    FOREIGN KEY(action_key,action_version) REFERENCES catalog.action_definition(action_key,version);
ALTER TABLE catalog.resource_type_definition
    DROP CONSTRAINT resource_type_definition_pkey,
    DROP CONSTRAINT resource_type_definition_locator,
    DROP CONSTRAINT resource_type_definition_platform_key,
    DROP CONSTRAINT resource_type_definition_release_key,
    DROP CONSTRAINT resource_type_definition_release_declaration,
    DROP COLUMN platform_type_key,
    DROP COLUMN id,
    DROP COLUMN component_release_id,
    DROP COLUMN implementation_declaration,
    ADD PRIMARY KEY(type_key);
ALTER TABLE catalog.resource ADD CONSTRAINT resource_type_key_fkey
    FOREIGN KEY(type_key) REFERENCES catalog.resource_type_definition(type_key);
DROP INDEX identity.service_principal_audience;
ALTER TABLE identity.service_principal ADD CONSTRAINT service_principal_audience_key UNIQUE(audience);

CREATE OR REPLACE FUNCTION catalog.guard_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP='UPDATE' THEN
        IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN
            RAISE EXCEPTION '% 的版本内容不可变；改规则就登记新版本',TG_TABLE_NAME USING ERRCODE='23001';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_TABLE_NAME='action_definition' AND EXISTS (
        SELECT 1 FROM admission.action_execution WHERE action_key=OLD.action_key AND action_version=OLD.version) THEN
        RAISE EXCEPTION 'ActionDefinition %@% 已被ActionExecution引用，不能删除',OLD.action_key,OLD.version USING ERRCODE='23001';
    END IF;
    RETURN OLD;
END $$;
CREATE OR REPLACE FUNCTION admission.guard_delegation_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP='UPDATE' THEN
        RAISE EXCEPTION 'DelegationScope 不可扩大或改指另一target' USING ERRCODE='23001';
    END IF;
    PERFORM 1 FROM admission.delegation_grant g
    JOIN catalog.action_definition a ON a.action_key=NEW.action_key AND a.version=NEW.action_version
        AND a.target_type=NEW.target_type AND a.status='ACTIVE'
    JOIN catalog.result_exposure_policy p ON p.id=NEW.result_exposure_policy_id
        AND p.version=NEW.result_exposure_policy_version AND p.tenant_id=g.tenant_id AND p.status='ACTIVE'
    WHERE g.id=NEW.delegation_id AND g.state='ACTIVE'
        AND (NEW.create_workspace_id IS NULL OR NEW.create_workspace_id=g.workspace_id)
        AND (NEW.target_id IS NULL OR EXISTS(SELECT 1 FROM catalog.resource r
            WHERE r.id=NEW.target_id AND r.tenant_id=g.tenant_id AND r.state='ACTIVE'
                AND (r.home_workspace_id IS NULL OR r.home_workspace_id=g.workspace_id)))
        AND (NEW.tool_resource_id IS NULL OR EXISTS(SELECT 1 FROM catalog.resource r
            WHERE r.id=NEW.tool_resource_id AND r.tenant_id=g.tenant_id AND r.state='ACTIVE'
                AND (r.home_workspace_id IS NULL OR r.home_workspace_id=g.workspace_id)));
    IF NOT FOUND THEN
        RAISE EXCEPTION 'DelegationScope 的action/target/tool/exposure必须同scope并固定确切版本' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END $$;
