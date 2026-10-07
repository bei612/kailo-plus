-- DD-89: native synchronization uses the existing read Operation and one real
-- receiver-write child. No native job state, directory body or new workflow.
ALTER TABLE admission.action_execution DROP CONSTRAINT action_execution_child_workspace_present;
ALTER TABLE admission.action_execution ADD CONSTRAINT action_execution_child_workspace_present
 CHECK(parent_action_execution_id IS NULL OR workspace_id IS NOT NULL
   OR coalesce(parameters->>'componentActionKind'='SERVICE_READ_RECEIVER',false));

CREATE OR REPLACE FUNCTION admission.freeze_execution_definition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected uuid; service_read boolean := false; service_write boolean := false;
BEGIN
    IF TG_OP='UPDATE' THEN
        IF OLD.parameters->>'componentActionKind' IN ('SERVICE_READ','SERVICE_READ_RECEIVER') AND
          ROW(NEW.tenant_id,NEW.workspace_id,NEW.initiator_principal_id,NEW.actor_principal_id,
              NEW.target_id,NEW.parameter_hash,NEW.action_key,NEW.action_version,NEW.parameters-(CASE WHEN OLD.parameters->>'componentActionKind'='SERVICE_READ' THEN ARRAY['readToken','readReceipts'] ELSE ARRAY['readToken'] END))
          IS DISTINCT FROM
          ROW(OLD.tenant_id,OLD.workspace_id,OLD.initiator_principal_id,OLD.actor_principal_id,
              OLD.target_id,OLD.parameter_hash,OLD.action_key,OLD.action_version,OLD.parameters-(CASE WHEN OLD.parameters->>'componentActionKind'='SERVICE_READ' THEN ARRAY['readToken','readReceipts'] ELSE ARRAY['readToken'] END)) THEN
            RAISE EXCEPTION 'Service read batch provenance is frozen' USING ERRCODE='23514';
        END IF;
        IF ROW(NEW.action_definition_id,NEW.component_binding_kind,NEW.component_binding_id,
               NEW.component_release_id,NEW.component_projection_generation)
          IS DISTINCT FROM ROW(OLD.action_definition_id,OLD.component_binding_kind,OLD.component_binding_id,
               OLD.component_release_id,OLD.component_projection_generation) THEN
            RAISE EXCEPTION 'execution implementation is frozen' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.parameters->>'componentActionKind'='SERVICE_READ' THEN
        SELECT EXISTS(SELECT 1 FROM catalog.application_binding receiver
            JOIN identity.service_principal service ON service.principal_id=receiver.service_principal_id
                AND service.component_binding_kind='APPLICATION' AND service.component_binding_id=receiver.id
            JOIN identity.principal principal ON principal.id=service.principal_id
                AND principal.tenant_id=receiver.tenant_id AND principal.kind='SERVICE' AND principal.status='ACTIVE'
            JOIN identity.tenant tenant ON tenant.id=receiver.tenant_id AND tenant.state='ACTIVE'
            LEFT JOIN identity.workspace workspace ON workspace.id=receiver.workspace_id AND workspace.tenant_id=receiver.tenant_id
            WHERE receiver.id=(NEW.parameters->>'receiverBindingId')::uuid
              AND receiver.tenant_id=NEW.tenant_id AND receiver.state='ACTIVE'
              AND receiver.workspace_id IS NOT DISTINCT FROM NEW.workspace_id
              AND (receiver.workspace_id IS NULL OR workspace.state='ACTIVE')
              AND receiver.active_projection_generation=(NEW.parameters->>'receiverGeneration')::bigint
              AND principal.id=NEW.actor_principal_id AND NEW.initiator_principal_id=NEW.actor_principal_id
              AND NEW.parent_action_execution_id IS NULL AND NEW.component_binding_kind='APPLICATION') INTO service_read;
        IF NOT service_read THEN
            RAISE EXCEPTION 'Service read requires the exact receiver ServicePrincipal and scope' USING ERRCODE='23514';
        END IF;
    END IF;
    IF NEW.parameters->>'componentActionKind'='SERVICE_READ_RECEIVER' THEN
        SELECT EXISTS(SELECT 1 FROM admission.action_execution parent
          JOIN catalog.application_binding b ON b.id=NEW.component_binding_id
            AND b.id=(parent.parameters->>'receiverBindingId')::uuid AND b.tenant_id=NEW.tenant_id
          JOIN identity.service_principal service ON service.principal_id=b.service_principal_id
            AND service.component_binding_kind='APPLICATION' AND service.component_binding_id=b.id
          JOIN identity.principal p ON p.id=service.principal_id
            AND p.kind='SERVICE' AND p.status='ACTIVE' AND p.tenant_id=NEW.tenant_id
          JOIN identity.tenant t ON t.id=NEW.tenant_id AND t.state='ACTIVE'
          LEFT JOIN identity.workspace w ON w.id=b.workspace_id AND w.tenant_id=b.tenant_id
          WHERE parent.id=NEW.parent_action_execution_id AND parent.parent_action_execution_id IS NULL
            AND parent.parameters->>'componentActionKind'='SERVICE_READ'
            AND parent.parameters->>'receiverActionExecutionId'=NEW.id::text
            AND parent.parameters->'nativeBatch'=NEW.parameters->'nativeBatch'
            AND parent.parameters->>'receiverDefinitionId'=NEW.action_definition_id::text
            AND parent.parameters->'receiverTargetVersion'=NEW.parameters->'targetVersion'
            AND NEW.parameters->>'sourceReadActionExecutionId'=parent.id::text
            AND NEW.parameters->>'sourceResourceId'=parent.target_id::text
            AND NEW.parameters->'idempotencyKey'=parent.parameters->'idempotencyKey'
            AND b.workspace_id IS NOT DISTINCT FROM NEW.workspace_id
            AND (b.workspace_id IS NULL OR w.state='ACTIVE')
            AND b.state='ACTIVE' AND b.active_projection_generation=NEW.component_projection_generation
            AND parent.parameters->>'receiverGeneration'=NEW.component_projection_generation::text
            AND NEW.actor_principal_id=p.id AND NEW.initiator_principal_id=p.id
            AND NEW.target_id=(parent.parameters->'nativeBatch'->>'receiverResourceId')::uuid
            AND NEW.component_binding_kind='APPLICATION') INTO service_write;
        IF NOT service_write THEN
            RAISE EXCEPTION 'Native receiver requires its exact read Operation and own ServicePrincipal' USING ERRCODE='23514';
        END IF;
    END IF;
    IF NEW.component_binding_kind IS NULL THEN
        SELECT id INTO expected FROM catalog.action_definition
        WHERE action_key=NEW.action_key AND version=NEW.action_version AND component_release_id IS NULL;
    ELSE
        SELECT d.id INTO expected FROM catalog.application_binding b
        JOIN projection.application_runtime p ON p.binding_id=b.id AND p.generation=NEW.component_projection_generation
        JOIN catalog.action_definition d ON d.component_release_id=p.component_release_id
        WHERE b.id=NEW.component_binding_id AND b.tenant_id=NEW.tenant_id
          AND (b.workspace_id IS NULL OR b.workspace_id=NEW.workspace_id OR ((service_read OR service_write) AND NEW.workspace_id IS NULL))
          AND b.state='ACTIVE' AND b.active_projection_generation=p.generation AND p.state='ACTIVE'
          AND p.component_release_id=NEW.component_release_id AND b.component_release_id=p.component_release_id
          AND d.action_key=NEW.action_key AND d.version=NEW.action_version AND d.status='ACTIVE'
          AND (NOT service_write OR (d.target_type='RESOURCE' AND d.permission_object_type='resource'
              AND d.permission IN ('update','delete') AND d.execution_mode='SYNC'
              AND d.confirmation_mode='NONE' AND d.approval_policy_id IS NULL))
          AND (NOT service_read OR (d.target_type='RESOURCE' AND d.permission_object_type='resource'
              AND d.permission IN ('read','discover') AND d.execution_mode='SYNC'
              AND d.confirmation_mode='NONE' AND d.approval_policy_id IS NULL));
        IF expected IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM catalog.action_definition d
            JOIN catalog.resource r ON r.application_binding_id=NEW.component_binding_id
              AND r.tenant_id=NEW.tenant_id AND r.state='ACTIVE'
              AND (r.home_workspace_id IS NULL OR r.home_workspace_id=NEW.workspace_id OR ((service_read OR service_write) AND NEW.workspace_id IS NULL))
            WHERE d.id=expected AND (
                (d.target_type='RESOURCE' AND r.id=NEW.target_id)
                OR (d.target_type='ASSET' AND EXISTS(SELECT 1 FROM catalog.asset a
                    WHERE a.id=NEW.target_id AND a.resource_id=r.id AND a.tenant_id=r.tenant_id AND a.state='ACTIVE')))
        ) THEN RAISE EXCEPTION 'execution target differs from binding scope' USING ERRCODE='23514'; END IF;
        IF expected IS NULL THEN RAISE EXCEPTION 'execution implementation unavailable' USING ERRCODE='23514'; END IF;
    END IF;
    IF NEW.action_definition_id IS NOT NULL AND NEW.action_definition_id IS DISTINCT FROM expected THEN
        RAISE EXCEPTION 'execution definition differs from frozen implementation' USING ERRCODE='23514';
    END IF;
    NEW.action_definition_id:=expected;
    RETURN NEW;
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


CREATE OR REPLACE FUNCTION admission.guard_service_read_receipts() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE role text; old_receipt jsonb; receipt jsonb; pin jsonb;
BEGIN
 IF OLD.parameters->>'componentActionKind' IS DISTINCT FROM 'SERVICE_READ' OR
    NEW.parameters->'readReceipts' IS NOT DISTINCT FROM OLD.parameters->'readReceipts' THEN RETURN NEW; END IF;
 IF jsonb_typeof(NEW.parameters->'readReceipts') IS DISTINCT FROM 'object' OR EXISTS(
    SELECT 1 FROM jsonb_object_keys(NEW.parameters->'readReceipts') k WHERE k NOT IN ('SOURCE','RECEIVER')) THEN
    RAISE EXCEPTION 'read receipt roles are exact' USING ERRCODE='23514'; END IF;
 FOREACH role IN ARRAY ARRAY['SOURCE','RECEIVER'] LOOP
   old_receipt:=OLD.parameters->'readReceipts'->role;
   receipt:=NEW.parameters->'readReceipts'->role;
   pin:=NEW.parameters->'readBilling'->role;
   IF old_receipt IS NOT NULL AND old_receipt IS DISTINCT FROM receipt THEN
     RAISE EXCEPTION 'read native receipt is immutable' USING ERRCODE='23514'; END IF;
   IF receipt IS NOT NULL AND NOT coalesce((receipt ?& ARRAY['role','bindingId','operationId','idempotencyKey',
      'nativeObjectRef','nativeRevision','contentSha256','contentBytes','completedAt','measurements'])
      AND (SELECT count(*) FROM jsonb_object_keys(receipt))=10
      AND receipt->>'role'=role AND receipt->>'bindingId'=pin->>'bindingId'
      AND receipt->>'operationId'=NEW.operation_id::text
      AND receipt->>'idempotencyKey'=NEW.parameters->>'idempotencyKey'
      AND length(receipt->>'nativeObjectRef')>0 AND length(receipt->>'nativeRevision')>0
      AND jsonb_typeof(receipt->'measurements')='array'
      AND receipt->>'contentSha256'~'^[0-9a-f]{64}$'
      AND jsonb_typeof(receipt->'contentBytes')='number'
      AND receipt->>'contentBytes'~'^[0-9]+$'
      AND (receipt->>'contentBytes')::bigint>=0
      AND (receipt->>'completedAt')::timestamptz<=clock_timestamp(),false) THEN
     RAISE EXCEPTION 'read native receipt differs from frozen batch' USING ERRCODE='23514'; END IF;
   IF receipt IS NOT NULL AND role='SOURCE' AND NOT coalesce(
      (CASE WHEN NEW.parameters->>'readMode'='DISCOVER' THEN
        receipt->>'nativeObjectRef'=NEW.parameters->>'readNativeRoot'
        AND receipt->>'nativeRevision'=receipt->>'contentSha256'
        AND EXISTS(SELECT 1 FROM catalog.action_definition d WHERE d.id=NEW.action_definition_id
          AND d.permission='discover' AND d.execution_mode='SYNC')
       ELSE receipt->>'nativeObjectRef'=NEW.parameters->'readReference'->>'nativeObjectRef'
        AND receipt->>'nativeRevision'=NEW.parameters->'readReference'->>'nativeRevision' END)
      AND extract(epoch FROM (receipt->>'completedAt')::timestamptz)>=(NEW.parameters->'readToken'->>'iat')::bigint
      AND extract(epoch FROM (receipt->>'completedAt')::timestamptz)<(NEW.parameters->'readToken'->>'exp')::bigint,false) THEN
     RAISE EXCEPTION 'source receipt differs from frozen source or deadline' USING ERRCODE='23514'; END IF;
   IF receipt IS NOT NULL AND (jsonb_array_length(receipt->'measurements')<>jsonb_array_length(pin->'meters')
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(receipt->'measurements') v
        WHERE NOT coalesce(jsonb_typeof(v->'quantity')='number' AND v->>'quantity'~'^[0-9]+$'
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(pin->'meters') m WHERE m->>'key'=v->>'meterKey'
            AND (m->>'value_property' IS NOT NULL OR (v->>'quantity')::bigint=1)),false))
      OR (SELECT count(DISTINCT v->>'meterKey') FROM jsonb_array_elements(receipt->'measurements') v)
        <>jsonb_array_length(receipt->'measurements')) THEN
     RAISE EXCEPTION 'read receipt meters differ from frozen obligation' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF NEW.parameters->'readReceipts' ? 'RECEIVER' AND (
    NOT (NEW.parameters->'readReceipts' ? 'SOURCE')
    OR NEW.parameters->'readReceipts'->'SOURCE'->>'contentSha256'<>
       NEW.parameters->'readReceipts'->'RECEIVER'->>'contentSha256'
    OR NEW.parameters->'readReceipts'->'SOURCE'->'contentBytes'<>
       NEW.parameters->'readReceipts'->'RECEIVER'->'contentBytes'
    OR (NEW.parameters->'readReceipts'->'RECEIVER'->>'completedAt')::timestamptz<
       (NEW.parameters->'readReceipts'->'SOURCE'->>'completedAt')::timestamptz) THEN
    RAISE EXCEPTION 'receiver receipt must match the actual source bytes' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
