-- No rollback may discard issued HUMAN read obligations or actual usage.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM admission.action_execution WHERE parameters->'nativeRead'='true') THEN
   RAISE EXCEPTION 'native HUMAN read evidence exists; retain its reconciliation schema';
 END IF;
END $$;
DROP TRIGGER native_human_read ON admission.action_execution;
DROP FUNCTION admission.guard_native_human_read();

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
