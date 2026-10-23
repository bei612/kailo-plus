-- Restore the 20261007100000 action family guard and the 20261005014000 Delegation
-- scope guard. Refuses while a proposal child or proposal-tool scope exists, so a
-- rollback never strands one.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM admission.action_execution
            WHERE action_key='workspace.create' AND parameters ? 'projectChannelRequest')
    OR EXISTS (SELECT 1 FROM admission.delegation_scope
               WHERE action_key='workspace.create' AND target_type='RESOURCE') THEN
   RAISE EXCEPTION 'project channel proposal children exist; roll back by stopping the release, not the schema'
     USING ERRCODE='55000';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION admission.guard_action_execution_family() RETURNS trigger AS $$
DECLARE parent admission.action_execution%ROWTYPE;
BEGIN
    IF TG_OP='UPDATE' AND OLD.parent_action_execution_id IS NOT NULL AND OLD.action_key='automation.run'
        AND (NEW.parameters IS DISTINCT FROM OLD.parameters
          OR NEW.approval_workflow_id IS DISTINCT FROM OLD.approval_workflow_id
          OR NEW.approval_expires_at IS DISTINCT FROM OLD.approval_expires_at) THEN
        RAISE EXCEPTION 'Automation approval child input cannot change' USING ERRCODE='23514';
    END IF;
    IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id
        OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
        OR NEW.parent_action_execution_id IS DISTINCT FROM OLD.parent_action_execution_id) THEN
        RAISE EXCEPTION 'ActionExecution 不得替换身份、Operation 或 parent' USING ERRCODE='23514';
    END IF;
    IF TG_OP='UPDATE' AND (OLD.parent_action_execution_id IS NOT NULL
        OR EXISTS(SELECT 1 FROM admission.action_execution c WHERE c.parent_action_execution_id=OLD.id)) AND (
        NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
        OR NEW.initiator_principal_id IS DISTINCT FROM OLD.initiator_principal_id
        OR NEW.actor_principal_id IS DISTINCT FROM OLD.actor_principal_id
        OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
        OR NEW.action_key IS DISTINCT FROM OLD.action_key OR NEW.action_version IS DISTINCT FROM OLD.action_version
        OR NEW.target_id IS DISTINCT FROM OLD.target_id OR NEW.parameter_hash IS DISTINCT FROM OLD.parameter_hash) THEN
        RAISE EXCEPTION 'ActionExecution family 的冻结 scope 与动作不可替换' USING ERRCODE='23514';
    END IF;
    IF NEW.parent_action_execution_id IS NULL OR TG_OP='UPDATE' THEN RETURN NEW; END IF;
    SELECT * INTO parent FROM admission.action_execution WHERE id=NEW.parent_action_execution_id FOR UPDATE;
    IF NEW.parameters->>'componentActionKind'='SERVICE_READ_RECEIVER' THEN
        IF parent.id IS NULL OR parent.parent_action_execution_id IS NOT NULL
          OR parent.parameters->>'componentActionKind' IS DISTINCT FROM 'SERVICE_READ'
          OR parent.parameters->>'receiverActionExecutionId' IS DISTINCT FROM NEW.id::text
          OR NEW.id=parent.id OR NEW.operation_id IS DISTINCT FROM parent.operation_id
          OR NEW.tenant_id IS DISTINCT FROM parent.tenant_id OR NEW.workspace_id IS DISTINCT FROM parent.workspace_id
          OR NEW.correlation_id IS DISTINCT FROM parent.correlation_id
          OR NEW.initiator_principal_id IS DISTINCT FROM parent.initiator_principal_id
          OR NEW.actor_principal_id IS DISTINCT FROM parent.actor_principal_id
          OR NEW.actor_principal_id IS DISTINCT FROM NEW.initiator_principal_id
          OR NEW.component_binding_kind IS DISTINCT FROM 'APPLICATION'
          OR NEW.component_binding_id::text IS DISTINCT FROM parent.parameters->>'receiverBindingId'
          OR NEW.component_projection_generation::text IS DISTINCT FROM parent.parameters->>'receiverGeneration'
          OR parent.gate_state<>'ALLOWED' OR parent.dispatch_state<>'DISPATCHED'
          OR NEW.temporal_workflow_id IS NOT NULL OR NEW.approval_workflow_id IS NOT NULL
          OR NEW.idempotency_key IS NOT NULL THEN
            RAISE EXCEPTION 'Native receiver child must inherit its exact admitted read root' USING ERRCODE='23514';
        END IF;
        -- freeze_execution_definition validates the SERVICE, native resource,
        -- exact receiver definition and generation as part of this INSERT.
        UPDATE admission.action_execution SET id=id WHERE id=parent.id;
        RETURN NEW;
    END IF;
    IF NOT FOUND OR parent.parent_action_execution_id IS NOT NULL
        OR parent.action_key NOT IN ('agent.invoke','automation.run') OR NEW.id=parent.id
        OR NEW.operation_id IS DISTINCT FROM parent.operation_id OR NEW.tenant_id IS DISTINCT FROM parent.tenant_id
        OR NEW.workspace_id IS DISTINCT FROM parent.workspace_id OR NEW.correlation_id IS DISTINCT FROM parent.correlation_id
        OR NEW.initiator_principal_id IS DISTINCT FROM parent.initiator_principal_id
        OR NEW.actor_principal_id IS DISTINCT FROM parent.actor_principal_id
        OR (NEW.action_key NOT IN ('agent.memory.entry.list','agent.memory.entry.read','automation.run')
            AND NEW.component_binding_kind IS DISTINCT FROM 'APPLICATION') THEN
        RAISE EXCEPTION 'Child must inherit the complete root ActionExecution context' USING ERRCODE='23514';
    END IF;
    IF NEW.component_binding_kind='APPLICATION' THEN
        PERFORM 1 FROM catalog.agent_invocation i
        JOIN catalog.agent_installation installed ON installed.resource_id=i.installation_resource_id
            AND installed.agent_principal_id=NEW.actor_principal_id AND installed.workspace_id=i.workspace_id
            AND catalog.agent_generation_admitted(installed.resource_id,i.agent_version_asset_id,i.projection_generation)
        JOIN catalog.agent_runtime_projection agent_runtime ON agent_runtime.installation_resource_id=installed.resource_id
            AND agent_runtime.generation=i.projection_generation AND agent_runtime.agent_version_asset_id=i.agent_version_asset_id
            AND agent_runtime.state='ACTIVE'
        JOIN identity.principal human ON human.id=NEW.initiator_principal_id
            AND human.tenant_id=NEW.tenant_id AND human.kind='HUMAN' AND human.status='ACTIVE'
        JOIN identity.principal agent ON agent.id=NEW.actor_principal_id
            AND agent.tenant_id=NEW.tenant_id AND agent.kind='AGENT' AND agent.status='ACTIVE'
        JOIN catalog.tool_binding tool_binding ON tool_binding.installation_resource_id=installed.resource_id
            AND tool_binding.projection_generation=i.projection_generation
            AND tool_binding.agent_version_asset_id=i.agent_version_asset_id AND tool_binding.workspace_id=i.workspace_id
            AND tool_binding.status IN ('NO_PERMISSION','ACTIVE')
        JOIN catalog.tool_definition tool ON tool.resource_id=tool_binding.tool_resource_id
            AND tool.source='APPLICATION' AND tool.status='ACTIVE' AND tool.action_key=NEW.action_key
            AND tool.application_projection_generation=NEW.component_projection_generation
        JOIN catalog.resource tool_resource ON tool_resource.id=tool.resource_id AND tool_resource.tenant_id=NEW.tenant_id
            AND tool_resource.application_binding_id=NEW.component_binding_id AND tool_resource.state='ACTIVE'
        JOIN catalog.action_definition definition ON definition.id=NEW.action_definition_id
            AND definition.action_key=NEW.action_key AND definition.version=NEW.action_version
            AND definition.component_release_id=NEW.component_release_id
        WHERE i.action_execution_id=parent.id AND i.tenant_id=NEW.tenant_id AND i.workspace_id=NEW.workspace_id
            AND parent.gate_state='ALLOWED' AND parent.dispatch_state='DISPATCHED'
            AND i.status IN ('DISPATCHING','RUNNING','UNKNOWN') AND NOT i.cancel_pending;
    ELSIF NEW.action_key='automation.run' THEN
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
        RAISE EXCEPTION 'Child lacks its exact frozen Invocation and implemented consumer' USING ERRCODE='23514';
    END IF;
    UPDATE admission.action_execution SET id=id WHERE id=parent.id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION admission.guard_delegation_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP='UPDATE' THEN
        RAISE EXCEPTION 'DelegationScope 不可扩大或改指另一target' USING ERRCODE='23001';
    END IF;
    PERFORM 1 FROM admission.delegation_grant g
    JOIN catalog.action_definition a ON a.id=NEW.action_definition_id
        AND a.action_key=NEW.action_key AND a.version=NEW.action_version
        AND a.target_type=NEW.target_type AND a.status='ACTIVE'
    JOIN catalog.result_exposure_policy p ON p.id=NEW.result_exposure_policy_id
        AND p.version=NEW.result_exposure_policy_version AND p.tenant_id=g.tenant_id AND p.status='ACTIVE'
    WHERE g.id=NEW.delegation_id AND g.state='ACTIVE'
        AND (NEW.create_workspace_id IS NULL OR NEW.create_workspace_id=g.workspace_id)
        AND (NEW.target_id IS NULL OR EXISTS (SELECT 1 FROM catalog.resource r
            WHERE ((NEW.target_type='RESOURCE' AND r.id=NEW.target_id)
                OR (NEW.target_type='ASSET' AND EXISTS(SELECT 1 FROM catalog.asset asset
                    WHERE asset.id=NEW.target_id AND asset.resource_id=r.id AND asset.tenant_id=r.tenant_id AND asset.state='ACTIVE')))
                AND r.tenant_id=g.tenant_id AND r.state='ACTIVE'
                AND (r.home_workspace_id IS NULL OR r.home_workspace_id=g.workspace_id)))
        AND (NEW.tool_resource_id IS NULL OR EXISTS (SELECT 1 FROM catalog.resource r
            WHERE r.id=NEW.tool_resource_id AND r.tenant_id=g.tenant_id AND r.state='ACTIVE'
                AND (r.home_workspace_id IS NULL OR r.home_workspace_id=g.workspace_id)));
    IF NOT FOUND THEN
        RAISE EXCEPTION 'DelegationScope 的action/target/tool/exposure必须同scope并固定确切版本' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END $$;
