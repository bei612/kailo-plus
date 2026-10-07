DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM admission.action_execution WHERE parameters->'readReceipts' IS NOT NULL) THEN
   RAISE EXCEPTION 'retained native read receipts prevent rollback' USING ERRCODE='23514';
 END IF;
END $$;
DROP TRIGGER service_read_receipts ON admission.action_execution;
DROP FUNCTION admission.guard_service_read_receipts();
-- DD-89: SERVICE read batches are original AE roots, never HUMAN/AGENT children.
-- Their execution Workspace comes from the receiver binding. A Tenant receiver
-- may read a granted Workspace resource; existing user/Agent scope is unchanged.
CREATE OR REPLACE FUNCTION admission.freeze_execution_definition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected uuid; service_read boolean := false;
BEGIN
    IF TG_OP='UPDATE' THEN
        IF OLD.parameters->>'componentActionKind'='SERVICE_READ' AND
          ROW(NEW.tenant_id,NEW.workspace_id,NEW.initiator_principal_id,NEW.actor_principal_id,
              NEW.target_id,NEW.parameter_hash,NEW.action_key,NEW.action_version,NEW.parameters-'readToken')
          IS DISTINCT FROM
          ROW(OLD.tenant_id,OLD.workspace_id,OLD.initiator_principal_id,OLD.actor_principal_id,
              OLD.target_id,OLD.parameter_hash,OLD.action_key,OLD.action_version,OLD.parameters-'readToken') THEN
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
   SELECT 1 FROM admission.external_execution e
   JOIN admission.action_execution a ON a.id=e.action_execution_id AND a.operation_id=e.operation_id
   JOIN LATERAL jsonb_array_elements(e.usage_projection->'meters') m ON true
   WHERE e.id=NEW.source_id AND e.terminal_at IS NOT NULL AND e.native_id IS NOT NULL
    AND e.platform_status IN ('SUCCEEDED','FAILED','CANCELLED')
    AND e.operation_id=NEW.operation_id AND e.tenant_id=NEW.tenant_id
    AND e.workspace_id IS NOT DISTINCT FROM NEW.workspace_id
    AND e.component_binding_id=NEW.component_binding_id AND e.component_release_id=NEW.component_release_id
    AND e.component_projection_generation=NEW.component_projection_generation
    AND NEW.openmeter_namespace=e.usage_projection->>'namespace'
    AND NEW.openmeter_customer_id=e.usage_projection->>'customer_id'
    AND NEW.subject_key=e.usage_projection->>'subject' AND NEW.meter_key=m->>'key'
    AND NEW.occurred_at<=e.last_observed_at
    AND NEW.dimensions=jsonb_build_object('tenant_id',e.tenant_id,'workspace_id',e.workspace_id,
      'operation_id',e.operation_id,'component_binding_id',e.component_binding_id,
      'component_release_id',e.component_release_id,'component_projection_generation',e.component_projection_generation,
      'resource_id',a.target_id)
    AND NEW.id=NEW.openmeter_event_id AND NEW.event->>'id'=NEW.id::text
    AND NEW.event->>'source'='urn:platform:core:usage' AND NEW.event->>'specversion'='1.0'
    AND NEW.event->>'type'=m->>'event_type' AND NEW.event->>'subject'=NEW.subject_key
    AND (NEW.event->>'time')::timestamptz=NEW.occurred_at
    AND ((m->>'value_property' IS NULL AND NEW.quantity=1 AND NEW.event->'data'=NEW.dimensions)
      OR (m->>'value_property'='$.quantity' AND NEW.event->'data'=(NEW.dimensions||jsonb_build_object('quantity',NEW.quantity))))
 ) THEN RAISE EXCEPTION 'Application usage requires exact frozen terminal execution' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION catalog.guard_application_usage_drained() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.state='DISABLED' AND EXISTS (
   SELECT 1 FROM admission.external_execution e WHERE e.component_binding_id=NEW.id AND
    (e.usage_projection IS NULL OR
     (jsonb_array_length(e.usage_projection->'meters')>0 AND e.usage_digest IS NULL)
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(e.usage_projection->'meters') m
      WHERE NOT EXISTS(SELECT 1 FROM outbox.usage_event u WHERE u.source_type='APPLICATION_ADAPTER_USAGE'
       AND u.source_id=e.id AND u.tenant_id=e.tenant_id AND u.meter_key=m->>'key'
       AND u.settlement_status='COMMITTED' AND u.stored_at IS NOT NULL)))
 ) THEN RAISE EXCEPTION 'binding usage has not been reconciled' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
