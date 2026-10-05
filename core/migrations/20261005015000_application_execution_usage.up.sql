-- DD-48/51: original EE and UsageEvent; no second balance or terminal authority.
ALTER TABLE admission.external_execution ADD COLUMN usage_projection jsonb
 CHECK(usage_projection IS NULL OR (jsonb_typeof(usage_projection)='object'
   AND jsonb_typeof(usage_projection->'meters')='array'));
ALTER TABLE admission.external_execution ADD COLUMN usage_digest text CHECK(usage_digest ~ '^[0-9a-f]{64}$');
ALTER TABLE admission.external_execution ADD COLUMN usage_observed_at timestamptz;
ALTER TABLE admission.external_execution ADD CHECK ((usage_digest IS NULL)=(usage_observed_at IS NULL));
CREATE OR REPLACE FUNCTION admission.guard_application_external_execution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM admission.action_execution a
   JOIN admission.action_execution root ON root.id=COALESCE(a.parent_action_execution_id,a.id)
    AND root.operation_id=a.operation_id AND root.parent_action_execution_id IS NULL
    AND root.tenant_id=a.tenant_id AND root.workspace_id IS NOT DISTINCT FROM a.workspace_id
   JOIN projection.workflow_ref w ON w.action_execution_id=root.id AND w.workflow_id=NEW.workflow_id
   JOIN catalog.application_binding b ON b.id=NEW.component_binding_id AND b.tenant_id=a.tenant_id
   WHERE a.id=NEW.action_execution_id AND a.operation_id=NEW.operation_id AND a.tenant_id=NEW.tenant_id
    AND a.workspace_id IS NOT DISTINCT FROM NEW.workspace_id
    AND (b.workspace_id IS NULL OR b.workspace_id=NEW.workspace_id)
    AND b.component_release_id=NEW.component_release_id AND a.gate_state='ALLOWED' AND a.dispatch_state='DISPATCHED'
 ) THEN RAISE EXCEPTION 'external execution requires original governed scope/workflow' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
   IF (to_jsonb(NEW)-ARRAY['native_id','native_status','platform_status','last_observed_at','terminal_at','response_digest',
       'usage_projection','usage_digest','usage_observed_at']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['native_id','native_status','platform_status','last_observed_at','terminal_at','response_digest',
       'usage_projection','usage_digest','usage_observed_at'])
      OR (OLD.native_id IS NOT NULL AND NEW.native_id IS DISTINCT FROM OLD.native_id)
      OR (OLD.terminal_at IS NOT NULL AND (to_jsonb(NEW)-ARRAY['usage_digest','usage_observed_at']) IS DISTINCT FROM
          (to_jsonb(OLD)-ARRAY['usage_digest','usage_observed_at']))
      OR NEW.last_observed_at<OLD.last_observed_at THEN
     RAISE EXCEPTION 'external execution intent/native terminal is immutable' USING ERRCODE='23514';
   END IF;
 ELSIF NEW.platform_status<>'PENDING_DISPATCH' OR NEW.native_id IS NOT NULL
   OR NEW.terminal_at IS NOT NULL OR NEW.response_digest IS NOT NULL OR NEW.usage_projection IS NOT NULL
   OR NEW.usage_digest IS NOT NULL THEN
   RAISE EXCEPTION 'external execution must start before dispatch' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION admission.guard_application_execution_usage_projection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.usage_projection IS DISTINCT FROM OLD.usage_projection AND
   (OLD.usage_projection IS NOT NULL OR OLD.platform_status<>'PENDING_DISPATCH'
    OR NEW.platform_status<>OLD.platform_status OR NEW.usage_projection IS NULL) THEN
   RAISE EXCEPTION 'external execution usage source freezes before dispatch' USING ERRCODE='23514';
 END IF;
 IF NEW.usage_projection IS DISTINCT FROM OLD.usage_projection AND NOT EXISTS (
   SELECT 1 FROM admission.action_execution a JOIN catalog.action_definition d
    ON d.component_release_id=NEW.component_release_id AND d.action_key=a.action_key AND d.version=a.action_version
   WHERE a.id=NEW.action_execution_id
     AND (SELECT coalesce(array_agg(m->>'key' ORDER BY m->>'key'),'{}'::text[])
          FROM jsonb_array_elements(NEW.usage_projection->'meters') m)
       =(SELECT coalesce(array_agg(k ORDER BY k),'{}'::text[]) FROM unnest(d.meters) k)
     AND ((cardinality(d.meters)=0 AND d.quota_policy='NONE' AND d.obs_usage_source='NONE')
       OR (cardinality(d.meters)>0 AND EXISTS(SELECT 1 FROM projection.openmeter_binding o
          WHERE o.tenant_id=NEW.tenant_id AND o.status='ACTIVE'
            AND o.customer_id=NEW.usage_projection->>'customer_id'
            AND o.namespace=NEW.usage_projection->>'namespace'
            AND o.version::text=NEW.usage_projection->>'binding_version'
            AND o.subject_key_prefix||NEW.component_binding_id::text=NEW.usage_projection->>'subject')))
 ) THEN RAISE EXCEPTION 'external execution meter/customer source mismatch' USING ERRCODE='23514'; END IF;
 IF (NEW.usage_digest,NEW.usage_observed_at) IS DISTINCT FROM (OLD.usage_digest,OLD.usage_observed_at) AND
   (OLD.usage_digest IS NOT NULL OR NEW.usage_digest IS NULL OR NEW.usage_observed_at IS NULL
     OR NEW.terminal_at IS NULL OR NEW.usage_projection IS NULL) THEN
   RAISE EXCEPTION 'native usage receipt is terminal and immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER application_execution_usage_projection BEFORE UPDATE ON admission.external_execution
 FOR EACH ROW EXECUTE FUNCTION admission.guard_application_execution_usage_projection();

ALTER TABLE outbox.usage_event ALTER COLUMN agent_installation_resource_id DROP NOT NULL;
ALTER TABLE outbox.usage_event ALTER COLUMN workspace_id DROP NOT NULL;
ALTER TABLE outbox.usage_event ADD COLUMN component_binding_id uuid;
ALTER TABLE outbox.usage_event ADD COLUMN component_release_id uuid REFERENCES catalog.component_release(id);
ALTER TABLE outbox.usage_event ADD COLUMN component_projection_generation bigint;
ALTER TABLE outbox.usage_event ADD FOREIGN KEY(component_binding_id,component_projection_generation)
 REFERENCES projection.application_runtime(binding_id,generation);
ALTER TABLE outbox.usage_event DROP CONSTRAINT usage_source_type;
ALTER TABLE outbox.usage_event ADD CONSTRAINT usage_source_type CHECK(source_type IN
 ('GATEWAY_DURABLE_USAGE','AGENT_INVOCATION','BUZZ_AGENT_MEMORY','APPLICATION_ADAPTER_USAGE'));
ALTER TABLE outbox.usage_event DROP CONSTRAINT usage_native_source_shape;
ALTER TABLE outbox.usage_event ADD CONSTRAINT usage_native_source_shape CHECK(
 (source_type='GATEWAY_DURABLE_USAGE' AND invocation_id IS NOT NULL AND native_seq IS NOT NULL AND native_turn_id IS NULL)
 OR (source_type='AGENT_INVOCATION' AND invocation_id IS NOT NULL AND native_seq IS NULL
     AND source_id=invocation_id AND meter_key='automation.run' AND quantity=1)
 OR (source_type='BUZZ_AGENT_MEMORY' AND native_seq IS NULL AND native_turn_id IS NULL
     AND meter_key IN ('agent_memory_read_count','agent_memory_write_count','agent_memory_plaintext_bytes'))
 OR (source_type='APPLICATION_ADAPTER_USAGE' AND invocation_id IS NULL AND native_seq IS NULL
     AND native_turn_id IS NULL AND agent_installation_resource_id IS NULL
     AND component_binding_id IS NOT NULL AND component_release_id IS NOT NULL
     AND component_projection_generation IS NOT NULL));
ALTER TABLE outbox.usage_event ADD CONSTRAINT usage_application_columns CHECK(
 source_type='APPLICATION_ADAPTER_USAGE' OR (component_binding_id IS NULL
 AND component_release_id IS NULL AND component_projection_generation IS NULL
 AND agent_installation_resource_id IS NOT NULL AND workspace_id IS NOT NULL));
DROP TRIGGER usage_event_scope_guard ON outbox.usage_event;
CREATE TRIGGER usage_event_scope_guard BEFORE INSERT OR UPDATE ON outbox.usage_event
 FOR EACH ROW WHEN (NEW.source_type<>'APPLICATION_ADAPTER_USAGE')
 EXECUTE FUNCTION projection.guard_agent_model_usage();
CREATE FUNCTION projection.guard_application_usage() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER application_usage_scope_guard BEFORE INSERT OR UPDATE ON outbox.usage_event
 FOR EACH ROW WHEN (NEW.source_type='APPLICATION_ADAPTER_USAGE') EXECUTE FUNCTION projection.guard_application_usage();

CREATE FUNCTION catalog.guard_application_usage_drained() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER application_usage_drained BEFORE UPDATE ON catalog.application_binding
 FOR EACH ROW EXECUTE FUNCTION catalog.guard_application_usage_drained();

ALTER TABLE audit.audit_event ADD COLUMN external_execution_id uuid REFERENCES admission.external_execution(id);
ALTER TABLE audit.audit_event ADD COLUMN component_binding_id uuid;
ALTER TABLE audit.audit_event ADD COLUMN component_release_id uuid REFERENCES catalog.component_release(id);
ALTER TABLE audit.audit_event ADD COLUMN component_projection_generation bigint;
ALTER TABLE audit.audit_event ADD FOREIGN KEY(component_binding_id,component_projection_generation)
 REFERENCES projection.application_runtime(binding_id,generation);
CREATE FUNCTION audit.guard_application_execution_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.external_execution_id IS NULL THEN
   IF NEW.component_binding_id IS NOT NULL OR NEW.component_release_id IS NOT NULL
      OR NEW.component_projection_generation IS NOT NULL THEN
     RAISE EXCEPTION 'application audit is missing original execution' USING ERRCODE='23514';
   END IF;
 ELSIF NOT EXISTS (
   SELECT 1 FROM admission.external_execution e JOIN admission.action_execution a ON a.id=e.action_execution_id
   WHERE e.id=NEW.external_execution_id AND e.operation_id=NEW.operation_id AND e.tenant_id=NEW.tenant_id
    AND e.workspace_id IS NOT DISTINCT FROM NEW.workspace_id
    AND e.component_binding_id=NEW.component_binding_id AND e.component_release_id=NEW.component_release_id
    AND e.component_projection_generation=NEW.component_projection_generation
    AND a.actor_principal_id=NEW.actor_principal_id AND a.initiator_principal_id=NEW.initiator_principal_id
    AND a.action_key=NEW.action_key AND a.action_version=NEW.action_version AND a.target_id=NEW.target_id
    AND a.parameter_hash=NEW.parameter_hash
 ) THEN RAISE EXCEPTION 'application audit must retain exact execution scope' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER application_execution_audit_scope BEFORE INSERT ON audit.audit_event
 FOR EACH ROW EXECUTE FUNCTION audit.guard_application_execution_scope();
