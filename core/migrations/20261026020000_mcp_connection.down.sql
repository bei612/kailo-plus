-- Reverse of DD-149 connectors. Refuses while any connector, connector tool, OAuth attempt,
-- tool-call record or connector action execution exists: their Resources, SpiceDB grants,
-- OpenBao credentials and audit chains are not removable by a schema rollback; roll back by
-- stopping the release instead.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM catalog.mcp_connection)
   OR EXISTS (SELECT 1 FROM catalog.tool_definition WHERE source='USER_REGISTERED_EXTERNAL')
   OR EXISTS (SELECT 1 FROM admission.mcp_oauth_attempt)
   OR EXISTS (SELECT 1 FROM admission.mcp_tool_call)
   OR EXISTS (SELECT 1 FROM catalog.mcp_connection_policy)
   OR EXISTS (SELECT 1 FROM admission.action_execution WHERE action_key LIKE 'mcp\_connection.%')
   OR EXISTS (SELECT 1 FROM catalog.resource WHERE type_key='mcp.connection') THEN
   RAISE EXCEPTION 'connector rows exist; roll back by stopping the release, not the schema'
     USING ERRCODE='55000';
 END IF;
END $$;

DELETE FROM catalog.action_definition WHERE action_key IN
 ('mcp_connection.create','mcp_connection.update','mcp_connection.rotate_credential',
  'mcp_connection.disable','mcp_connection.enable','mcp_connection.delete','mcp_connection.policy.update',
  'mcp_connection.tool.invoke','mcp_connection.tool.invoke_confirmed','mcp_connection.tool.invoke_approved');
DELETE FROM catalog.approval_policy WHERE id IN
 ('4d2b7c1e-9a35-4e60-8f14-2c6b9e0d1a01','4d2b7c1e-9a35-4e60-8f14-2c6b9e0d1a02');

DROP INDEX admission.action_execution_one_pending_per_target;
CREATE UNIQUE INDEX action_execution_one_pending_per_target
    ON admission.action_execution (target_id)
    WHERE gate_state IN ('EVALUATING', 'WAITING');

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
    -- DD-140: the project channel proposal is a workspace.create child of the Agent's admitted
    -- root turn whose initiator is the Installation owner (not the trigger) and whose actor is
    -- the AGENT; it must carry its frozen proposal for exactly that Installation, owner and
    -- turn, wait for approval and start no workflow at insert.
    IF NEW.action_key='workspace.create' AND NEW.parameters ? 'projectChannelRequest' THEN
        PERFORM 1 FROM catalog.agent_invocation i
        JOIN catalog.agent_installation installed ON installed.resource_id=i.installation_resource_id
            AND installed.agent_principal_id=NEW.actor_principal_id AND installed.workspace_id=i.workspace_id
        JOIN catalog.resource installation ON installation.id=installed.resource_id
            AND installation.tenant_id=NEW.tenant_id AND installation.owner_principal_id=NEW.initiator_principal_id
        JOIN catalog.channel_agent_binding cb ON cb.installation_resource_id=installed.resource_id
            AND cb.workspace_id=i.workspace_id AND cb.status='ACTIVE'
        JOIN identity.principal human ON human.id=NEW.initiator_principal_id
            AND human.tenant_id=NEW.tenant_id AND human.kind='HUMAN' AND human.status='ACTIVE'
        JOIN identity.principal agent ON agent.id=NEW.actor_principal_id
            AND agent.tenant_id=NEW.tenant_id AND agent.kind='AGENT' AND agent.status='ACTIVE'
        WHERE parent.id IS NOT NULL AND parent.parent_action_execution_id IS NULL
          AND parent.action_key='agent.invoke' AND NEW.id<>parent.id
          AND NEW.operation_id=parent.operation_id AND NEW.tenant_id=parent.tenant_id
          AND NEW.correlation_id=parent.correlation_id AND NEW.actor_principal_id=parent.actor_principal_id
          AND NEW.temporal_workflow_id IS NULL
          AND i.action_execution_id=parent.id AND i.tenant_id=NEW.tenant_id
          AND i.workspace_id IS NOT DISTINCT FROM parent.workspace_id
          AND NEW.parameters->'projectChannelRequest'->>'installationResourceId'=installed.resource_id::text
          AND NEW.parameters->'projectChannelRequest'->>'ownerPrincipalId'=NEW.initiator_principal_id::text
          AND NEW.parameters->'projectChannelRequest'->>'invocationId'=i.id::text
          AND NEW.parameters->'projectChannelRequest'->'request'->>'homeChannelId'=i.workspace_id::text;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Project channel proposal lacks its exact Agent turn, Installation and owner' USING ERRCODE='23514';
        END IF;
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

CREATE OR REPLACE FUNCTION catalog.guard_platform_tool_binding() RETURNS trigger AS $$
BEGIN
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN
   RAISE EXCEPTION 'ToolBinding immutable Installation/Version/generation cannot change' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND OLD.status='REVOKED' AND NEW IS DISTINCT FROM OLD THEN
   RAISE EXCEPTION 'Revoked ToolBinding cannot reactivate' USING ERRCODE='23514';
 END IF;
 PERFORM 1 FROM catalog.agent_installation i JOIN catalog.resource r ON r.id=i.resource_id
 JOIN catalog.agent_runtime_projection p ON p.installation_resource_id=i.resource_id
 JOIN catalog.agent_version v ON v.asset_id=p.agent_version_asset_id
 JOIN catalog.resource tool ON tool.id=NEW.tool_resource_id AND tool.tenant_id=r.tenant_id
 JOIN catalog.tool_definition t ON t.resource_id=tool.id
 JOIN admission.action_execution a ON a.id=NEW.action_execution_id
 WHERE i.resource_id=NEW.installation_resource_id AND i.workspace_id=NEW.workspace_id
   AND r.home_workspace_id=NEW.workspace_id AND p.generation=NEW.projection_generation
   AND p.agent_version_asset_id=NEW.agent_version_asset_id AND tool.type_key='tool.definition'
   AND a.tenant_id=r.tenant_id
   AND ((t.source='PLATFORM_NATIVE'
       AND v.content->'declaredToolResourceIds' @> jsonb_build_array(tool.id::text)
       AND a.workspace_id=NEW.workspace_id AND a.target_id=i.resource_id
       AND a.action_key IN ('agent.installation.create','agent.installation.upgrade','agent.installation.enable'))
     OR (t.source='APPLICATION' AND EXISTS (
       SELECT 1 FROM catalog.application_binding b JOIN projection.application_runtime runtime ON runtime.binding_id=b.id
       JOIN LATERAL jsonb_array_elements(v.content->'capabilityRequirements') requirement ON true
       JOIN LATERAL jsonb_array_elements(b.capability_categories) category ON true
       WHERE b.id=tool.application_binding_id AND b.tenant_id=r.tenant_id
         AND (b.workspace_id IS NULL OR b.workspace_id=NEW.workspace_id)
         AND runtime.generation=t.application_projection_generation
         AND requirement #>> '{}' = t.capability_contract_key
         AND EXISTS(SELECT 1 FROM catalog.capability_contract c
           JOIN LATERAL jsonb_array_elements(c.content->'operationContracts') operation ON true
           WHERE c.category_key=category->>'category' AND c.contract_version::text=category->>'version'
             AND operation->>'contractKey'=t.capability_contract_key AND operation->>'surface'='TOOL')
         AND ((NEW.status='REVOKED' AND b.state IN ('DISABLING','DISABLED'))
           OR (b.state='ACTIVE' AND runtime.state='ACTIVE'))
         AND ((a.action_key IN ('agent.installation.create','agent.installation.upgrade','agent.installation.enable') AND a.target_id=i.resource_id AND a.workspace_id=NEW.workspace_id)
           OR (a.action_key='application_binding.create' AND a.target_id=b.id
             AND a.workspace_id IS NOT DISTINCT FROM b.workspace_id)))));
 IF NOT FOUND THEN
   RAISE EXCEPTION 'ToolBinding lacks same scope governed immutable Installation' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION catalog.guard_platform_tool_scope() RETURNS trigger AS $$
BEGIN
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN
   RAISE EXCEPTION 'ToolDefinition immutable declaration changed' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND OLD.status='DELETED' AND NEW IS DISTINCT FROM OLD THEN
   RAISE EXCEPTION 'Deleted ToolDefinition cannot reactivate' USING ERRCODE='23514';
 END IF;
 PERFORM 1 FROM catalog.resource r JOIN identity.principal owner
   ON owner.id=r.owner_principal_id AND owner.tenant_id=r.tenant_id AND owner.kind='HUMAN'
 WHERE r.id=NEW.resource_id AND r.type_key='tool.definition'
   AND ((NEW.status='PROVISIONING' AND r.state='PROVISIONING')
     OR (NEW.status='ACTIVE' AND r.state='ACTIVE')
     OR (NEW.status='DELETED' AND r.state IN ('RETAINED_READ_ONLY','DELETED')))
   AND ((NEW.source='PLATFORM_NATIVE' AND r.component_type_key='core'
       AND r.home_workspace_id IS NULL AND r.application_binding_id IS NULL AND r.native_id=r.id::text)
     OR (NEW.source='APPLICATION' AND EXISTS (
       SELECT 1 FROM catalog.application_binding b JOIN projection.application_runtime p ON p.binding_id=b.id
       JOIN catalog.component_release release ON release.id=b.component_release_id
       JOIN LATERAL jsonb_array_elements(release.manifest->'toolDefinitions') declaration ON true
       WHERE b.id=r.application_binding_id AND b.tenant_id=r.tenant_id
         AND b.workspace_id IS NOT DISTINCT FROM r.home_workspace_id
         AND b.component_type_key=r.component_type_key AND p.generation=NEW.application_projection_generation
         AND p.component_release_id=release.id AND p.normalized_manifest_digest=release.manifest_digest
         AND declaration->>'name'=NEW.name AND declaration->>'source'=NEW.source
         AND declaration->>'actionKey'=NEW.action_key
         AND declaration->>'capabilityContractKey'=NEW.capability_contract_key
         AND declaration->>'inputSchemaHash'=NEW.input_schema_hash
         AND declaration->>'outputSchemaHash'=NEW.output_schema_hash
         AND declaration->>'backendRef'=NEW.backend_ref
         AND ((NEW.status='PROVISIONING' AND b.state='PROVISIONING' AND p.state='PENDING'
              AND r.projection_action_execution_id=p.action_execution_id)
           OR (NEW.status='ACTIVE' AND b.state IN ('PROVISIONING','ACTIVE') AND p.state='ACTIVE')
           OR (NEW.status='DELETED' AND b.state IN ('DISABLING','DISABLED'))))));
 IF NOT FOUND THEN
   RAISE EXCEPTION 'ToolDefinition lacks its original scoped Resource/declaration' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE catalog.tool_definition DROP CONSTRAINT tool_definition_connector_fields;
ALTER TABLE catalog.tool_definition DROP CONSTRAINT tool_definition_source_contract;
ALTER TABLE catalog.tool_definition ADD CONSTRAINT tool_definition_source_contract CHECK
 ((source='PLATFORM_NATIVE'
   AND ((name IN ('agent.memory.entry.list','agent.memory.entry.read') AND action_key=name)
     OR (name='project_channel_request' AND action_key='workspace.create'))
   AND capability_contract_key IS NULL AND backend_ref='CORE_STREAMABLE_MCP'
   AND application_projection_generation IS NULL) OR
  (source='APPLICATION' AND name<>'' AND action_key=capability_contract_key
   AND backend_ref<>'' AND application_projection_generation>0));
ALTER TABLE catalog.tool_definition
    DROP COLUMN annotations, DROP COLUMN output_schema, DROP COLUMN input_schema,
    DROP COLUMN description, DROP COLUMN title, DROP COLUMN first_generation,
    DROP COLUMN risk_declared, DROP COLUMN risk, DROP COLUMN upstream_name, DROP COLUMN mcp_connection_id;

DROP TABLE admission.mcp_tool_call;
DROP TABLE admission.mcp_oauth_attempt;
DROP TABLE projection.mcp_connection_health;
DROP TABLE catalog.mcp_connection_policy;
ALTER TABLE catalog.mcp_connection DROP CONSTRAINT mcp_connection_active_generation;
DROP TABLE catalog.mcp_connection_generation;
DROP FUNCTION catalog.guard_mcp_connection_generation();
DROP TABLE catalog.mcp_connection;
DROP FUNCTION catalog.guard_mcp_connection();

ALTER TABLE catalog.resource DROP CONSTRAINT resource_type_key_check;
ALTER TABLE catalog.resource DROP CONSTRAINT resource_home_workspace_check;
ALTER TABLE catalog.resource ADD CONSTRAINT resource_type_key_check CHECK
 (application_binding_id IS NOT NULL OR type_key IN
  ('agent.definition','agent.installation','llm_route','automation','tool.definition','skill.definition'));
ALTER TABLE catalog.resource ADD CONSTRAINT resource_home_workspace_check CHECK
 (application_binding_id IS NOT NULL OR
  (type_key IN ('agent.definition','tool.definition','skill.definition') AND home_workspace_id IS NULL) OR
  (type_key IN ('agent.installation','automation') AND home_workspace_id IS NOT NULL) OR type_key='llm_route');
DELETE FROM catalog.resource_type_definition WHERE type_key='mcp.connection' AND component_release_id IS NULL;
