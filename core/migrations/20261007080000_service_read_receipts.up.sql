-- DD-89: SERVICE read batches are original AE roots, never HUMAN/AGENT children.
-- Their execution Workspace comes from the receiver binding. A Tenant receiver
-- may read a granted Workspace resource; existing user/Agent scope is unchanged.
CREATE OR REPLACE FUNCTION admission.freeze_execution_definition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected uuid; service_read boolean := false;
BEGIN
    IF TG_OP='UPDATE' THEN
        IF OLD.parameters->>'componentActionKind'='SERVICE_READ' AND
          ROW(NEW.tenant_id,NEW.workspace_id,NEW.initiator_principal_id,NEW.actor_principal_id,
              NEW.target_id,NEW.parameter_hash,NEW.action_key,NEW.action_version,NEW.parameters-ARRAY['readToken','readReceipts'])
          IS DISTINCT FROM
          ROW(OLD.tenant_id,OLD.workspace_id,OLD.initiator_principal_id,OLD.actor_principal_id,
              OLD.target_id,OLD.parameter_hash,OLD.action_key,OLD.action_version,OLD.parameters-ARRAY['readToken','readReceipts']) THEN
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
    IF NEW.component_binding_kind IS NULL THEN
        SELECT id INTO expected FROM catalog.action_definition
        WHERE action_key=NEW.action_key AND version=NEW.action_version AND component_release_id IS NULL;
    ELSE
        SELECT d.id INTO expected FROM catalog.application_binding b
        JOIN projection.application_runtime p ON p.binding_id=b.id AND p.generation=NEW.component_projection_generation
        JOIN catalog.action_definition d ON d.component_release_id=p.component_release_id
        WHERE b.id=NEW.component_binding_id AND b.tenant_id=NEW.tenant_id
          AND (b.workspace_id IS NULL OR b.workspace_id=NEW.workspace_id OR (service_read AND NEW.workspace_id IS NULL))
          AND b.state='ACTIVE' AND b.active_projection_generation=p.generation AND p.state='ACTIVE'
          AND p.component_release_id=NEW.component_release_id AND b.component_release_id=p.component_release_id
          AND d.action_key=NEW.action_key AND d.version=NEW.action_version AND d.status='ACTIVE'
          AND (NOT service_read OR (d.target_type='RESOURCE' AND d.permission_object_type='resource'
              AND d.permission IN ('read','discover') AND d.execution_mode='SYNC'
              AND d.confirmation_mode='NONE' AND d.approval_policy_id IS NULL));
        IF expected IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM catalog.action_definition d
            JOIN catalog.resource r ON r.application_binding_id=NEW.component_binding_id
              AND r.tenant_id=NEW.tenant_id AND r.state='ACTIVE'
              AND (r.home_workspace_id IS NULL OR r.home_workspace_id=NEW.workspace_id OR (service_read AND NEW.workspace_id IS NULL))
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

CREATE FUNCTION admission.guard_service_read_receipts() RETURNS trigger LANGUAGE plpgsql AS $$
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
      receipt->>'nativeObjectRef'=NEW.parameters->'readReference'->>'nativeObjectRef'
      AND receipt->>'nativeRevision'=NEW.parameters->'readReference'->>'nativeRevision'
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

-- Keep the original disable barrier. A read/import charged through the SYNC
-- batch is not an unbilled EE and cannot be ignored while native evidence or
-- OpenMeter commit remains unknown.
CREATE OR REPLACE FUNCTION catalog.guard_application_usage_drained() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.state='DISABLED' AND (
   EXISTS(SELECT 1 FROM admission.action_execution a
     WHERE a.parameters->>'componentActionKind'='SERVICE_READ' AND a.gate_state='ALLOWED'
       AND (a.parameters->'readBilling'->'SOURCE'->>'bindingId'=NEW.id::text
         OR a.parameters->'readBilling'->'RECEIVER'->>'bindingId'=NEW.id::text)
       AND NOT EXISTS(SELECT 1 FROM audit.audit_event x
         WHERE x.event_key=a.operation_id::text||':service_read:terminal'))
   OR EXISTS(SELECT 1 FROM admission.external_execution e WHERE e.component_binding_id=NEW.id AND
    (e.usage_projection IS NULL OR
     (jsonb_array_length(e.usage_projection->'meters')>0 AND e.usage_digest IS NULL)
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(e.usage_projection->'meters') m
      WHERE NOT EXISTS(SELECT 1 FROM outbox.usage_event u
       WHERE u.source_type='APPLICATION_ADAPTER_USAGE' AND u.tenant_id=e.tenant_id AND u.meter_key=m->>'key'
         AND u.component_binding_id=e.component_binding_id AND u.component_release_id=e.component_release_id
         AND u.component_projection_generation=e.component_projection_generation
         AND u.settlement_status='COMMITTED' AND u.stored_at IS NOT NULL
         AND ((u.source_id=e.id AND u.operation_id=e.operation_id)
           OR (u.source_id=e.action_execution_id AND u.dimensions->>'read_role'='RECEIVER'
             AND EXISTS(SELECT 1 FROM admission.action_execution a
               WHERE a.id::text=u.dimensions->>'read_action_execution_id' AND a.operation_id=u.operation_id
                 AND a.parameters->>'componentActionKind'='SERVICE_READ'
                 AND a.parameters->>'receiverActionExecutionId'=e.action_execution_id::text
                 AND a.parameters->>'idempotencyKey'=e.idempotency_key::text
                 AND a.parameters->'readReceipts'->'RECEIVER'->>'nativeObjectRef'=e.native_id
                 AND EXISTS(SELECT 1 FROM audit.audit_event x WHERE x.event_key=a.operation_id::text||':service_read:terminal'))))))))
 ) THEN RAISE EXCEPTION 'binding usage has not been reconciled' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER service_read_receipts BEFORE UPDATE ON admission.action_execution
 FOR EACH ROW EXECUTE FUNCTION admission.guard_service_read_receipts();

CREATE OR REPLACE FUNCTION projection.guard_application_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
   IF (to_jsonb(NEW)-ARRAY['settlement_status','stored_at','updated_at']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['settlement_status','stored_at','updated_at'])
      OR (OLD.settlement_status='COMMITTED' AND NEW IS DISTINCT FROM OLD) THEN
     RAISE EXCEPTION 'Application usage identity and native fact are immutable' USING ERRCODE='23514';
   END IF;
 END IF;
 -- Both paths derive from existing native evidence: original async EE or the
 -- exact original synchronous read AE. Neither path supplies an invented EE.
 IF NOT EXISTS (
   WITH facts AS (
     SELECT e.operation_id,e.tenant_id,e.workspace_id,e.component_binding_id,e.component_release_id,
       e.component_projection_generation,e.usage_projection,a.target_id AS resource_id,
       e.last_observed_at AS observed_at,m,
       jsonb_build_object('tenant_id',e.tenant_id,'workspace_id',e.workspace_id,'operation_id',e.operation_id,
         'component_binding_id',e.component_binding_id,'component_release_id',e.component_release_id,
         'component_projection_generation',e.component_projection_generation,'resource_id',a.target_id) AS dimensions
     FROM admission.external_execution e
     JOIN admission.action_execution a ON a.id=e.action_execution_id AND a.operation_id=e.operation_id
     JOIN LATERAL jsonb_array_elements(e.usage_projection->'meters') m ON true
     WHERE e.id=NEW.source_id AND e.terminal_at IS NOT NULL AND e.native_id IS NOT NULL
       AND e.platform_status IN ('SUCCEEDED','FAILED','CANCELLED')
     UNION ALL
     SELECT a.operation_id,a.tenant_id,a.workspace_id,(pin->>'bindingId')::uuid,(pin->>'releaseId')::uuid,
       (pin->>'generation')::bigint,pin,(pin->>'resourceId')::uuid,(receipt->>'completedAt')::timestamptz,m,
       jsonb_build_object('tenant_id',a.tenant_id,'workspace_id',a.workspace_id,'operation_id',a.operation_id,
         'component_binding_id',(pin->>'bindingId')::uuid,'component_release_id',(pin->>'releaseId')::uuid,
         'component_projection_generation',(pin->>'generation')::bigint,'resource_id',(pin->>'resourceId')::uuid,
         'read_action_execution_id',a.id,'read_role',role)
     FROM admission.action_execution a
     CROSS JOIN (VALUES('SOURCE'),('RECEIVER')) roles(role)
     CROSS JOIN LATERAL (SELECT a.parameters->'readBilling'->role AS pin,
       a.parameters->'readReceipts'->role AS receipt) native
     JOIN LATERAL jsonb_array_elements(pin->'meters') m ON true
     JOIN LATERAL jsonb_array_elements(receipt->'measurements') measurement ON measurement->>'meterKey'=m->>'key'
     WHERE a.parameters->>'componentActionKind'='SERVICE_READ' AND a.parent_action_execution_id IS NULL
       AND a.gate_state='ALLOWED' AND a.dispatch_state IN ('DISPATCHED','UNKNOWN')
       AND NEW.source_id=CASE WHEN role='SOURCE' THEN a.id ELSE (a.parameters->>'receiverActionExecutionId')::uuid END
       AND receipt->>'operationId'=a.operation_id::text AND receipt->>'bindingId'=pin->>'bindingId'
       AND NEW.quantity=(measurement->>'quantity')::bigint
   ) SELECT 1 FROM facts f WHERE f.operation_id=NEW.operation_id AND f.tenant_id=NEW.tenant_id
     AND f.workspace_id IS NOT DISTINCT FROM NEW.workspace_id
     AND f.component_binding_id=NEW.component_binding_id AND f.component_release_id=NEW.component_release_id
     AND f.component_projection_generation=NEW.component_projection_generation
     AND NEW.openmeter_namespace=f.usage_projection->>'namespace'
     AND NEW.openmeter_customer_id=f.usage_projection->>'customer_id'
     AND NEW.subject_key=f.usage_projection->>'subject' AND NEW.meter_key=f.m->>'key'
     AND NEW.occurred_at<=f.observed_at AND NEW.dimensions=f.dimensions
     AND NEW.id=NEW.openmeter_event_id AND NEW.event->>'id'=NEW.id::text
     AND NEW.event->>'source'='urn:platform:core:usage' AND NEW.event->>'specversion'='1.0'
     AND NEW.event->>'type'=f.m->>'event_type' AND NEW.event->>'subject'=NEW.subject_key
     AND (NEW.event->>'time')::timestamptz=NEW.occurred_at
     AND ((f.m->>'value_property' IS NULL AND NEW.quantity=1 AND NEW.event->'data'=NEW.dimensions)
       OR (f.m->>'value_property'='$.quantity' AND NEW.event->'data'=NEW.dimensions||jsonb_build_object('quantity',NEW.quantity)))
 ) THEN RAISE EXCEPTION 'Application usage requires exact frozen native receipt' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
