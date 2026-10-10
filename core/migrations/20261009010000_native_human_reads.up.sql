-- HUMAN same-request reads retain the existing AE and usage outbox. The
-- immutable completion is distinct from SERVICE SOURCE/RECEIVER evidence.
CREATE FUNCTION admission.guard_native_human_read() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt jsonb; pin jsonb; token jsonb;
BEGIN
 IF TG_OP='UPDATE' AND OLD.parameters->'nativeRead'='true' THEN
   IF ROW(NEW.operation_id,NEW.tenant_id,NEW.workspace_id,NEW.initiator_principal_id,NEW.actor_principal_id,
       NEW.target_id,NEW.parameter_hash,NEW.action_key,NEW.action_version,NEW.idempotency_key,NEW.temporal_workflow_id,
       NEW.parameters-ARRAY['nativeReadToken','nativeReadDeadline','nativeReadReceipt']) IS DISTINCT FROM
      ROW(OLD.operation_id,OLD.tenant_id,OLD.workspace_id,OLD.initiator_principal_id,OLD.actor_principal_id,
       OLD.target_id,OLD.parameter_hash,OLD.action_key,OLD.action_version,OLD.idempotency_key,OLD.temporal_workflow_id,
       OLD.parameters-ARRAY['nativeReadToken','nativeReadDeadline','nativeReadReceipt'])
     OR (OLD.parameters ? 'nativeReadToken' AND NEW.parameters->'nativeReadToken' IS DISTINCT FROM OLD.parameters->'nativeReadToken')
     OR (OLD.parameters ? 'nativeReadDeadline' AND NEW.parameters->'nativeReadDeadline' IS DISTINCT FROM OLD.parameters->'nativeReadDeadline')
     OR (OLD.parameters ? 'nativeReadReceipt' AND NEW.parameters->'nativeReadReceipt' IS DISTINCT FROM OLD.parameters->'nativeReadReceipt')
     OR (OLD.dispatch_state<>'NOT_DISPATCHED' AND NEW.dispatch_state='NOT_DISPATCHED')
   THEN RAISE EXCEPTION 'native HUMAN read provenance is frozen' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.parameters->'nativeRead' IS DISTINCT FROM 'true'::jsonb THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM catalog.action_definition d JOIN identity.principal p ON p.id=NEW.actor_principal_id
     WHERE d.id=NEW.action_definition_id AND d.execution_mode='SYNC' AND d.confirmation_mode='NONE'
       AND d.workflow_kind IS NULL AND d.permission IN ('read','export') AND d.target_type='RESOURCE'
       AND p.tenant_id=NEW.tenant_id AND p.kind='HUMAN')
    OR NEW.parameters->>'componentActionKind' IS DISTINCT FROM 'COMPONENT_ACTION'
    OR NEW.initiator_principal_id IS DISTINCT FROM NEW.actor_principal_id
    OR NEW.parent_action_execution_id IS NOT NULL OR NEW.temporal_workflow_id IS NOT NULL
    OR NEW.component_binding_kind IS DISTINCT FROM 'APPLICATION'
    OR jsonb_typeof(NEW.parameters->'nativeReadDeadline') IS DISTINCT FROM 'number'
    OR coalesce(NEW.parameters->>'nativeReadDeadline','')!~'^[0-9]+$'
 THEN RAISE EXCEPTION 'native read requires its original HUMAN SYNC definition' USING ERRCODE='23514'; END IF;
 pin:=NEW.parameters->'nativeReadBilling'; token:=NEW.parameters->'nativeReadToken'; receipt:=NEW.parameters->'nativeReadReceipt';
 IF pin->>'bindingId' IS DISTINCT FROM NEW.component_binding_id::text
    OR pin->>'releaseId' IS DISTINCT FROM NEW.component_release_id::text
    OR pin->>'generation' IS DISTINCT FROM NEW.component_projection_generation::text
    OR pin->>'resourceId' IS DISTINCT FROM NEW.target_id::text
    OR jsonb_typeof(pin->'meters') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'native read billing projection differs from AE' USING ERRCODE='23514'; END IF;
 IF token IS NOT NULL AND (jsonb_typeof(token) IS DISTINCT FROM 'object'
    OR token->>'idempotencyKey' IS DISTINCT FROM NEW.idempotency_key::text
    OR nullif(token->>'jti','') IS NULL
    OR jsonb_typeof(token->'iat') IS DISTINCT FROM 'number' OR jsonb_typeof(token->'exp') IS DISTINCT FROM 'number'
    OR (token->>'exp')::bigint<=(token->>'iat')::bigint)
 THEN RAISE EXCEPTION 'native read token provenance invalid' USING ERRCODE='23514'; END IF;
 IF receipt IS NOT NULL THEN
   IF jsonb_typeof(receipt) IS DISTINCT FROM 'object' OR token IS NULL
     OR NOT (receipt ?& ARRAY['operationId','idempotencyKey','nativeObjectRef','nativeRevision','contentSha256','contentBytes','startedAt','completedAt','measurements'])
     OR (SELECT count(*) FROM jsonb_object_keys(receipt))<>9
     OR NEW.gate_state IS DISTINCT FROM 'ALLOWED' OR NEW.dispatch_state NOT IN ('DISPATCHED','UNKNOWN')
     OR receipt->>'operationId' IS DISTINCT FROM NEW.operation_id::text
     OR receipt->>'idempotencyKey' IS DISTINCT FROM NEW.idempotency_key::text
     OR receipt->'nativeObjectRef' IS DISTINCT FROM NEW.parameters#>'{inputArguments,input,nativeObjectRef}'
     OR receipt->'nativeRevision' IS DISTINCT FROM NEW.parameters#>'{inputArguments,input,nativeRevision}'
     OR coalesce(receipt->>'contentSha256','')!~'^[0-9a-f]{64}$'
     OR jsonb_typeof(receipt->'contentBytes') IS DISTINCT FROM 'number' OR coalesce(receipt->>'contentBytes','')!~'^[0-9]+$' OR (receipt->>'contentBytes')::bigint<0
     OR jsonb_typeof(receipt->'completedAt') IS DISTINCT FROM 'string'
     OR jsonb_typeof(receipt->'startedAt') IS DISTINCT FROM 'string'
     OR (receipt->>'startedAt')::timestamptz>=to_timestamp((token->>'exp')::bigint)
     OR (receipt->>'startedAt')::timestamptz<to_timestamp((token->>'iat')::bigint)
     OR (receipt->>'completedAt')::timestamptz<(receipt->>'startedAt')::timestamptz
     OR (receipt->>'completedAt')::timestamptz>now()
     OR jsonb_typeof(receipt->'measurements') IS DISTINCT FROM 'array'
     OR jsonb_array_length(receipt->'measurements')<>jsonb_array_length(pin->'meters')
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(receipt->'measurements') m
       WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(pin->'meters') p WHERE p->>'key'=m->>'meterKey'
           AND (p->>'value_property' IS NOT NULL OR (m->>'quantity')::bigint=1))
         OR jsonb_typeof(m->'quantity') IS DISTINCT FROM 'number' OR coalesce(m->>'quantity','')!~'^[0-9]+$'
         OR (SELECT count(*) FROM jsonb_object_keys(m))<>2 OR (m->>'quantity')::bigint<0)
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(receipt->'measurements') m GROUP BY m->>'meterKey' HAVING count(*)<>1)
   THEN RAISE EXCEPTION 'native HUMAN completion lacks exact receipt' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER native_human_read BEFORE INSERT OR UPDATE ON admission.action_execution
 FOR EACH ROW EXECUTE FUNCTION admission.guard_native_human_read();

CREATE OR REPLACE FUNCTION projection.guard_application_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
   IF (to_jsonb(NEW)-ARRAY['settlement_status','stored_at','updated_at']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['settlement_status','stored_at','updated_at'])
      OR (OLD.settlement_status='COMMITTED' AND NEW IS DISTINCT FROM OLD) THEN
     RAISE EXCEPTION 'Application usage identity and native fact are immutable' USING ERRCODE='23514';
   END IF;
 END IF;
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
     UNION ALL
     SELECT a.operation_id,a.tenant_id,a.workspace_id,a.component_binding_id,a.component_release_id,
       a.component_projection_generation,pin,a.target_id,(receipt->>'completedAt')::timestamptz,m,
       jsonb_build_object('tenant_id',a.tenant_id,'workspace_id',a.workspace_id,'operation_id',a.operation_id,
         'component_binding_id',a.component_binding_id,'component_release_id',a.component_release_id,
         'component_projection_generation',a.component_projection_generation,'resource_id',a.target_id,
         'read_action_execution_id',a.id,'read_role','HUMAN')
     FROM admission.action_execution a
     CROSS JOIN LATERAL (SELECT a.parameters->'nativeReadBilling' AS pin,a.parameters->'nativeReadReceipt' AS receipt) native
     JOIN LATERAL jsonb_array_elements(pin->'meters') m ON true
     JOIN LATERAL jsonb_array_elements(receipt->'measurements') measurement ON measurement->>'meterKey'=m->>'key'
     WHERE a.id=NEW.source_id AND a.parameters->'nativeRead'='true' AND a.parameters->>'componentActionKind'='COMPONENT_ACTION'
       AND a.actor_principal_id=a.initiator_principal_id AND a.parent_action_execution_id IS NULL
       AND a.gate_state='ALLOWED' AND a.dispatch_state IN ('DISPATCHED','UNKNOWN')
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

-- Existing SERVICE and EE barriers are retained. HUMAN receipt absence and
-- uncommitted native usage now participate in the same DISABLED transition.
CREATE OR REPLACE FUNCTION catalog.guard_application_usage_drained() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.state='DISABLED' AND (
   EXISTS(SELECT 1 FROM admission.action_execution a
     WHERE a.component_binding_id=NEW.id AND a.parameters->'nativeRead'='true' AND a.gate_state='ALLOWED'
       AND a.dispatch_state IN ('DISPATCHED','UNKNOWN')
       AND NOT EXISTS(SELECT 1 FROM audit.audit_event x WHERE x.event_key=a.operation_id::text||':component_action:terminal'))
   OR EXISTS(SELECT 1 FROM admission.action_execution a
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
