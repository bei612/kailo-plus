-- DD-92: original application generation owns the model projection; neither a
-- second model catalog nor a native component configuration store is created.
ALTER TABLE catalog.application_binding DROP CONSTRAINT application_binding_model_call_mode_check;
ALTER TABLE catalog.application_binding ADD CONSTRAINT application_binding_model_call_mode_check
 CHECK(model_call_mode IN ('NONE','PLATFORM_LLM_ROUTE'));
ALTER TABLE projection.application_runtime
 ADD COLUMN model_projection jsonb,
 ADD COLUMN model_state text CHECK(model_state IN ('PENDING','ACTIVE','REVOKED')),
 ADD COLUMN model_dispatch_started boolean NOT NULL DEFAULT false,
 ADD COLUMN model_native_key_id text,
 ADD COLUMN model_native_key_revision bigint,
 ADD COLUMN model_usage_receipt jsonb,
 ADD CONSTRAINT application_model_shape CHECK(
  (model_projection IS NULL AND model_state IS NULL AND NOT model_dispatch_started
    AND model_native_key_id IS NULL AND model_native_key_revision IS NULL)
  OR (model_projection IS NOT NULL AND jsonb_typeof(model_projection)='object' AND model_state IS NOT NULL
    AND ((model_native_key_id IS NULL)=(model_native_key_revision IS NULL))
    AND (model_native_key_revision IS NULL OR model_native_key_revision>0)
    AND (model_state<>'ACTIVE' OR (model_dispatch_started AND model_native_key_id IS NOT NULL)))),
 ADD CONSTRAINT application_model_drained CHECK(
   coalesce(model_state='REVOKED',false) = (model_usage_receipt IS NOT NULL));

CREATE FUNCTION projection.guard_application_model() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.model_projection IS NOT NULL AND NEW.model_projection IS DISTINCT FROM OLD.model_projection THEN
  RAISE EXCEPTION 'application model projection is immutable' USING ERRCODE='23514';
 END IF;
 IF OLD.model_dispatch_started AND NOT NEW.model_dispatch_started
    OR (OLD.model_usage_receipt IS NOT NULL AND NEW.model_usage_receipt IS DISTINCT FROM OLD.model_usage_receipt)
    OR (OLD.model_state='REVOKED' AND NEW.model_state IS DISTINCT FROM OLD.model_state)
    OR (OLD.model_native_key_id IS NOT NULL AND
      (NEW.model_native_key_id,NEW.model_native_key_revision) IS DISTINCT FROM
      (OLD.model_native_key_id,OLD.model_native_key_revision)) THEN
  RAISE EXCEPTION 'application model dispatch cannot be replayed' USING ERRCODE='23514';
 END IF;
 IF NEW.model_projection IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM catalog.application_binding b
  JOIN admission.action_execution a ON a.id=NEW.action_execution_id
  JOIN identity.service_principal s ON s.principal_id=b.service_principal_id
    AND s.component_binding_kind='APPLICATION' AND s.component_binding_id=b.id
  WHERE b.id=NEW.binding_id AND b.model_call_mode='PLATFORM_LLM_ROUTE'
    AND b.component_release_id=NEW.component_release_id
    AND a.target_id=b.id AND a.tenant_id=b.tenant_id
    AND a.workspace_id IS NOT DISTINCT FROM b.workspace_id
    AND a.action_key='application_binding.create'
    AND a.gate_state='ALLOWED' AND a.dispatch_state='DISPATCHED'
    AND NEW.model_projection->>'gatewayPrincipalId'=b.service_principal_id::text
    AND NEW.model_projection->>'operationId'=a.operation_id::text
    AND NEW.model_projection->>'tenantId'=b.tenant_id::text
    AND NEW.model_projection->>'workspaceId' IS NOT DISTINCT FROM b.workspace_id::text
    AND NEW.model_projection->>'configDigest'=b.config_digest
    AND jsonb_array_length(NEW.model_projection->'meters')>0
    AND jsonb_array_length(NEW.model_projection->'routeResourceIds')>0
 ) THEN
  RAISE EXCEPTION 'application model projection lacks original generation authority' USING ERRCODE='23514';
 END IF;
 IF NEW.model_state='REVOKED' AND (
    (NEW.model_usage_receipt->>'generation')::bigint IS DISTINCT FROM NEW.generation
    OR (NEW.model_dispatch_started AND (
      NEW.model_usage_receipt->>'credentialRevoked' IS DISTINCT FROM 'true'
      OR NEW.model_usage_receipt->>'gatewayPrincipalId' IS DISTINCT FROM NEW.model_projection->>'gatewayPrincipalId'
      OR NEW.model_usage_receipt->>'requestSetDigest' IS NULL
      OR coalesce((NEW.model_usage_receipt->>'submittedRequests')::bigint,-1)<0))
    OR (NOT NEW.model_dispatch_started AND NEW.model_usage_receipt->>'dispatchStarted' IS DISTINCT FROM 'false')
    OR EXISTS(SELECT 1 FROM outbox.usage_event e WHERE e.component_binding_id=NEW.binding_id
        AND e.component_projection_generation=NEW.generation AND e.source_type='GATEWAY_DURABLE_USAGE'
        AND (e.settlement_status<>'COMMITTED' OR e.stored_at IS NULL))
 ) THEN RAISE EXCEPTION 'application model dispatch set is not drained' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER application_model_guard BEFORE UPDATE ON projection.application_runtime
 FOR EACH ROW EXECUTE FUNCTION projection.guard_application_model();

CREATE FUNCTION catalog.guard_application_model_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.model_call_mode='PLATFORM_LLM_ROUTE' AND NEW.state='ACTIVE' AND NOT EXISTS(
  SELECT 1 FROM projection.application_runtime p WHERE p.binding_id=NEW.id
    AND p.generation=NEW.active_projection_generation AND p.state='ACTIVE' AND p.model_state='ACTIVE'
 ) THEN RAISE EXCEPTION 'application model projection is not active' USING ERRCODE='23514'; END IF;
 IF NEW.state='DISABLED' AND EXISTS(SELECT 1 FROM projection.application_runtime p
    WHERE p.binding_id=NEW.id AND p.model_projection IS NOT NULL AND p.model_state<>'REVOKED') THEN
  RAISE EXCEPTION 'application model credential has not been revoked' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER application_model_state_guard BEFORE INSERT OR UPDATE ON catalog.application_binding
 FOR EACH ROW EXECUTE FUNCTION catalog.guard_application_model_state();

-- The source stays GATEWAY_DURABLE_USAGE. APPLICATION changes only frozen
-- attribution and the subject; it does not create an adapter-reported token source.
ALTER TABLE outbox.usage_event DROP CONSTRAINT usage_native_source_shape;
ALTER TABLE outbox.usage_event ADD CONSTRAINT usage_native_source_shape CHECK(
 (source_type='GATEWAY_DURABLE_USAGE' AND (invocation_id IS NOT NULL OR component_binding_id IS NOT NULL)
   AND native_seq IS NOT NULL AND native_turn_id IS NULL)
 OR (source_type='AGENT_INVOCATION' AND invocation_id IS NOT NULL AND native_seq IS NULL
     AND source_id=invocation_id AND meter_key='automation.run' AND quantity=1)
 OR (source_type='BUZZ_AGENT_MEMORY' AND native_seq IS NULL AND native_turn_id IS NULL
     AND meter_key IN ('agent_memory_read_count','agent_memory_write_count','agent_memory_plaintext_bytes'))
 OR (source_type='APPLICATION_ADAPTER_USAGE' AND invocation_id IS NULL AND native_seq IS NULL
     AND native_turn_id IS NULL AND agent_installation_resource_id IS NULL
     AND component_binding_id IS NOT NULL AND component_release_id IS NOT NULL
     AND component_projection_generation IS NOT NULL));
ALTER TABLE outbox.usage_event DROP CONSTRAINT usage_application_columns;
ALTER TABLE outbox.usage_event ADD CONSTRAINT usage_application_columns CHECK(
 source_type='APPLICATION_ADAPTER_USAGE'
 OR (source_type='GATEWAY_DURABLE_USAGE' AND invocation_id IS NULL AND agent_installation_resource_id IS NULL
     AND component_binding_id IS NOT NULL AND component_release_id IS NOT NULL AND component_projection_generation IS NOT NULL)
 OR (component_binding_id IS NULL AND component_release_id IS NULL AND component_projection_generation IS NULL
     AND agent_installation_resource_id IS NOT NULL AND workspace_id IS NOT NULL));
DROP TRIGGER usage_event_scope_guard ON outbox.usage_event;
CREATE TRIGGER usage_event_scope_guard BEFORE INSERT OR UPDATE ON outbox.usage_event
 FOR EACH ROW WHEN (NEW.source_type<>'APPLICATION_ADAPTER_USAGE' AND NEW.component_binding_id IS NULL)
 EXECUTE FUNCTION projection.guard_agent_model_usage();

CREATE FUNCTION projection.guard_application_model_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['settlement_status','stored_at','updated_at']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['settlement_status','stored_at','updated_at'])
     OR (OLD.settlement_status='COMMITTED' AND NEW IS DISTINCT FROM OLD) THEN
   RAISE EXCEPTION 'Application model native usage is immutable' USING ERRCODE='23514';
  END IF;
 END IF;
 IF NOT EXISTS(
  SELECT 1 FROM projection.application_runtime p
  JOIN catalog.application_binding b ON b.id=p.binding_id
  JOIN admission.action_execution origin ON origin.id=p.action_execution_id
  JOIN LATERAL jsonb_array_elements(p.model_projection->'meters') m ON true
  WHERE p.binding_id=NEW.component_binding_id AND p.generation=NEW.component_projection_generation
   AND p.component_release_id=NEW.component_release_id AND b.tenant_id=NEW.tenant_id
   AND (b.workspace_id IS NULL OR b.workspace_id=NEW.workspace_id)
   AND p.model_dispatch_started AND p.model_projection->>'gatewayPrincipalId'=b.service_principal_id::text
   AND NEW.openmeter_namespace=p.model_projection->>'namespace'
   AND NEW.openmeter_customer_id=p.model_projection->>'customerId'
   AND NEW.subject_key=p.model_projection->>'subject' AND NEW.meter_key=m->>'key'
   AND ((NEW.operation_id=origin.operation_id AND NEW.workspace_id IS NOT DISTINCT FROM b.workspace_id
       AND NEW.dimensions->>'attribution'='BINDING')
     OR (NEW.dimensions->>'attribution'='OPERATION' AND EXISTS(
       SELECT 1 FROM admission.action_execution a JOIN admission.external_execution e ON e.action_execution_id=a.id
       WHERE a.component_binding_id=b.id AND a.component_projection_generation=p.generation
         AND a.operation_id=NEW.operation_id AND a.tenant_id=NEW.tenant_id
         AND a.workspace_id IS NOT DISTINCT FROM NEW.workspace_id AND a.dispatch_state='DISPATCHED')))
   AND NEW.dimensions @> jsonb_build_object('tenant_id',NEW.tenant_id,'workspace_id',NEW.workspace_id,
      'operation_id',NEW.operation_id,'component_binding_id',b.id,'component_release_id',p.component_release_id,
      'component_projection_generation',p.generation)
   AND NEW.dimensions->>'provider' IS NOT NULL AND NEW.dimensions->>'model' IS NOT NULL
   AND NEW.id=NEW.openmeter_event_id AND NEW.event->>'id'=NEW.id::text
   AND NEW.event->>'source'='urn:platform:core:usage' AND NEW.event->>'specversion'='1.0'
   AND NEW.event->>'subject'=NEW.subject_key AND NEW.event->>'type'=m->>'event_type'
   AND (NEW.event->>'time')::timestamptz=NEW.occurred_at
   AND NEW.event->'data' @> NEW.dimensions
   AND NEW.quantity=CASE m->>'value_property'
     WHEN '$.inputTokens' THEN (NEW.event->'data'->>'inputTokens')::bigint
     WHEN '$.outputTokens' THEN (NEW.event->'data'->>'outputTokens')::bigint
     WHEN '$.totalTokens' THEN (NEW.event->'data'->>'totalTokens')::bigint END
 ) THEN RAISE EXCEPTION 'Application model usage lacks exact original scope/projection' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER application_model_usage_guard BEFORE INSERT OR UPDATE ON outbox.usage_event
 FOR EACH ROW WHEN (NEW.source_type='GATEWAY_DURABLE_USAGE' AND NEW.component_binding_id IS NOT NULL)
 EXECUTE FUNCTION projection.guard_application_model_usage();
