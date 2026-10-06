-- 03 §7 / 17 §5–7: one Installation, one native writer, immutable generations.
CREATE OR REPLACE FUNCTION catalog.guard_agent_schedule_source() RETURNS trigger AS $$
BEGIN
    IF TG_OP='UPDATE' AND (NEW.source_kind IS DISTINCT FROM OLD.source_kind
        OR (TG_TABLE_NAME='agent_invocation' AND (to_jsonb(NEW)->'schedule_id' IS DISTINCT FROM to_jsonb(OLD)->'schedule_id'
            OR to_jsonb(NEW)->'scheduled_at' IS DISTINCT FROM to_jsonb(OLD)->'scheduled_at'))) THEN
        RAISE EXCEPTION 'Agent native source 已冻结' USING ERRCODE='check_violation';
    END IF;
    IF TG_TABLE_NAME='agent_invocation' THEN
        PERFORM 1 FROM catalog.agent_session s
          JOIN admission.action_execution ae ON ae.id=NEW.action_execution_id
          LEFT JOIN catalog.automation_version av ON av.asset_id=NEW.automation_version_asset_id
            AND av.automation_resource_id=NEW.automation_resource_id
        WHERE s.workspace_id=NEW.workspace_id AND s.root_event_id=NEW.root_event_id
          AND s.installation_resource_id=NEW.installation_resource_id AND s.source_kind=NEW.source_kind
          AND s.projection_generation=NEW.projection_generation AND s.agent_version_asset_id=NEW.agent_version_asset_id
          AND (NEW.source_kind='BUZZ_EVENT' OR
            (NEW.source_kind='SCHEDULE' AND ae.action_key='automation.run' AND ae.parameters->>'sourceKind'='SCHEDULE'
              AND ae.parameters->>'scheduleId'=NEW.schedule_id
              AND ae.parameters->>'scheduledAt'=NEW.source_event_id
              AND ae.parameters->>'rootEventId'=NEW.root_event_id
              AND av.trigger->>'kind'='SCHEDULE' AND av.result_target='CHANNEL'
              AND NEW.workflow_id='platform:automation_run:'||NEW.tenant_id::text||':'||NEW.automation_resource_id::text||'-'||NEW.source_event_id)
            OR (NEW.source_kind='MANUAL' AND ae.action_key='automation.run'
              AND ae.tenant_id=NEW.tenant_id AND ae.workspace_id=NEW.workspace_id AND ae.target_id=NEW.automation_resource_id
              AND ae.parent_action_execution_id IS NULL AND ae.parameters->>'sourceKind'='MANUAL'
              AND ae.parameters->>'sourcePrincipalId'=ae.initiator_principal_id::text
              AND NOT ae.parameters ? 'sourcePubkey'
              AND ae.parameters->>'sourceEventId'=NEW.source_event_id AND ae.parameters->>'rootEventId'=NEW.root_event_id
              AND NEW.source_event_id='manual:'||ae.initiator_principal_id::text||':'||ae.target_id::text||':'||ae.idempotency_key::text
              AND ae.parameters#>>'{manualRequest,idempotencyKey}'=ae.idempotency_key::text
              AND ae.parameters#>>'{manualRequest,resourceId}'=ae.target_id::text
              AND ae.parameters#>>'{manualRequest,workspaceId}'=ae.workspace_id::text
              AND ae.parameters#>>'{manualRequest,resourceVersion}'=ae.parameters->>'targetVersion'
              AND ae.parameters#>'{manualRequest,explicitConfirmation}'='true'::jsonb
              AND av.trigger->>'kind' IN ('CHANNEL_MESSAGE','MENTION','SCHEDULE')
              AND av.result_target=CASE WHEN av.trigger->>'kind'='SCHEDULE' THEN 'CHANNEL' ELSE 'TRIGGER_THREAD' END
              AND NEW.workflow_id='platform:automation_run:'||NEW.tenant_id::text||':'||NEW.automation_resource_id::text||'-'||NEW.source_event_id));
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Agent source must belong to the exact Workflow/AE/Version/Session' USING ERRCODE='check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- Release window: stop old Core/Worker writers before this migration; start
-- only generation-aware writers afterwards. No mixed old/new session writers.
-- Expand, preserve every original row, then contract the old three-column key.
CREATE UNIQUE INDEX agent_session_generation_key
 ON catalog.agent_session(workspace_id,root_event_id,installation_resource_id,projection_generation);
ALTER TABLE catalog.agent_invocation DROP CONSTRAINT agent_invocation_workspace_id_root_event_id_installation_r_fkey;
ALTER TABLE catalog.agent_invocation ADD CONSTRAINT agent_invocation_session_generation
 FOREIGN KEY(workspace_id,root_event_id,installation_resource_id,projection_generation)
 REFERENCES catalog.agent_session(workspace_id,root_event_id,installation_resource_id,projection_generation);
ALTER TABLE catalog.agent_session DROP CONSTRAINT agent_session_pkey;
ALTER TABLE catalog.agent_session ADD PRIMARY KEY USING INDEX agent_session_generation_key;

INSERT INTO catalog.approval_policy
 (id,version,action_key,target_type,role_requirements,owner_requirement,self_approval,expires_in_seconds,status)
SELECT gen_random_uuid(),1,'agent.installation.upgrade','RESOURCE',role_requirements,owner_requirement,
 self_approval,expires_in_seconds,'ACTIVE'
FROM catalog.approval_policy WHERE action_key='tenant.member.revoke' AND status='ACTIVE';

INSERT INTO catalog.action_definition
 (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
 permission,permission_object_type,execution_mode,confirmation_mode,approval_policy_id,approval_policy_version,
 workflow_type,workflow_kind,capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,
 obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,obs_cost_source,obs_redaction_policy,status)
SELECT action_key,1,'core','RESOURCE','SESSION_TENANT','WORKSPACE_REQUIRED','manage','resource','TEMPORAL','APPROVAL',
 id,version,'ComponentTaskWorkflow','AGENT_INSTALLATION','NONE',NULL,'NONE','{}','NONE','FULL_LIFECYCLE',
 'OPERATION_REF','TEMPORAL','TEMPORAL','NONE','NONE','PLATFORM_METADATA_ONLY','ACTIVE'
FROM catalog.approval_policy WHERE action_key='agent.installation.upgrade' AND status='ACTIVE';

-- Read predicate shared by the existing runtime/model/thread consumers. It
-- cannot admit a new trigger: those consumers still require ACTIVE separately.
CREATE FUNCTION catalog.agent_generation_admitted(installation uuid, version_id uuid, generation_id bigint)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM catalog.agent_installation i
 JOIN catalog.resource r ON r.id=i.resource_id AND r.state='ACTIVE'
 JOIN catalog.agent_runtime_projection p ON p.installation_resource_id=i.resource_id
   AND p.generation=i.active_projection_generation AND p.agent_version_asset_id=i.pinned_version_asset_id
   AND p.state='ACTIVE'
 WHERE i.resource_id=installation AND p.generation=generation_id AND p.agent_version_asset_id=version_id
   AND ((i.state='ACTIVE' AND r.projection_action_execution_id IS NULL)
     OR (i.state='DRAINING' AND EXISTS(SELECT 1 FROM admission.action_execution a
       WHERE a.id=r.projection_action_execution_id AND a.action_key='agent.installation.upgrade'
         AND a.target_id=i.resource_id AND a.tenant_id=r.tenant_id AND a.workspace_id=i.workspace_id
         AND a.gate_state='ALLOWED' AND a.dispatch_state IN ('NOT_DISPATCHED','DISPATCHED','UNKNOWN')))))
$$;
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
       AND a.action_key IN ('agent.installation.create','agent.installation.upgrade'))
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
         AND ((a.action_key IN ('agent.installation.create','agent.installation.upgrade') AND a.target_id=i.resource_id AND a.workspace_id=NEW.workspace_id)
           OR (a.action_key='application_binding.create' AND a.target_id=b.id
             AND a.workspace_id IS NOT DISTINCT FROM b.workspace_id)))));
 IF NOT FOUND THEN
   RAISE EXCEPTION 'ToolBinding lacks same scope governed immutable Installation' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Terminal native evidence and the existing capacity reconciler are both
-- required. EXPIRED/UNKNOWN leases never count as released.
CREATE FUNCTION catalog.agent_installation_drained(installation uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(SELECT 1 FROM catalog.agent_invocation v
   WHERE v.installation_resource_id=installation
     AND (v.status NOT IN ('COMPLETED','FAILED','CANCELED') OR EXISTS(
       SELECT 1 FROM admission.capacity_lease l WHERE l.invocation_id=v.id AND l.state<>'RELEASED')))
 AND NOT EXISTS(SELECT 1 FROM catalog.agent_session s
   WHERE s.installation_resource_id=installation AND s.status IN ('STARTING','UNKNOWN'))
$$;
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
