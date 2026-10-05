DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM outbox.usage_event WHERE source_type='APPLICATION_ADAPTER_USAGE')
  OR EXISTS(SELECT 1 FROM admission.external_execution WHERE usage_projection IS NOT NULL)
  OR EXISTS(SELECT 1 FROM audit.audit_event WHERE external_execution_id IS NOT NULL) THEN
   RAISE EXCEPTION 'Application execution usage facts exist; forward repair required';
 END IF;
END $$;
DROP TRIGGER application_execution_audit_scope ON audit.audit_event;
DROP FUNCTION audit.guard_application_execution_scope();
ALTER TABLE audit.audit_event DROP COLUMN external_execution_id;
ALTER TABLE audit.audit_event DROP COLUMN component_binding_id;
ALTER TABLE audit.audit_event DROP COLUMN component_release_id;
ALTER TABLE audit.audit_event DROP COLUMN component_projection_generation;
DROP TRIGGER application_usage_drained ON catalog.application_binding;
DROP FUNCTION catalog.guard_application_usage_drained();
DROP TRIGGER application_usage_scope_guard ON outbox.usage_event;
DROP FUNCTION projection.guard_application_usage();
DROP TRIGGER usage_event_scope_guard ON outbox.usage_event;
CREATE TRIGGER usage_event_scope_guard BEFORE INSERT OR UPDATE ON outbox.usage_event
 FOR EACH ROW EXECUTE FUNCTION projection.guard_agent_model_usage();
ALTER TABLE outbox.usage_event DROP CONSTRAINT usage_application_columns;
ALTER TABLE outbox.usage_event DROP CONSTRAINT usage_native_source_shape;
ALTER TABLE outbox.usage_event ADD CONSTRAINT usage_native_source_shape CHECK(
 (source_type='GATEWAY_DURABLE_USAGE' AND invocation_id IS NOT NULL AND native_seq IS NOT NULL AND native_turn_id IS NULL)
 OR (source_type='AGENT_INVOCATION' AND invocation_id IS NOT NULL AND native_seq IS NULL
     AND source_id=invocation_id AND meter_key='automation.run' AND quantity=1)
 OR (source_type='BUZZ_AGENT_MEMORY' AND native_seq IS NULL AND native_turn_id IS NULL
     AND meter_key IN ('agent_memory_read_count','agent_memory_write_count','agent_memory_plaintext_bytes')));
ALTER TABLE outbox.usage_event DROP CONSTRAINT usage_source_type;
ALTER TABLE outbox.usage_event ADD CONSTRAINT usage_source_type CHECK(source_type IN
 ('GATEWAY_DURABLE_USAGE','AGENT_INVOCATION','BUZZ_AGENT_MEMORY'));
ALTER TABLE outbox.usage_event DROP COLUMN component_binding_id;
ALTER TABLE outbox.usage_event DROP COLUMN component_release_id;
ALTER TABLE outbox.usage_event DROP COLUMN component_projection_generation;
ALTER TABLE outbox.usage_event ALTER COLUMN agent_installation_resource_id SET NOT NULL;
ALTER TABLE outbox.usage_event ALTER COLUMN workspace_id SET NOT NULL;
DROP TRIGGER application_execution_usage_projection ON admission.external_execution;
DROP FUNCTION admission.guard_application_execution_usage_projection();
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
   IF (to_jsonb(NEW)-ARRAY['native_id','native_status','platform_status','last_observed_at','terminal_at','response_digest']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['native_id','native_status','platform_status','last_observed_at','terminal_at','response_digest'])
      OR (OLD.native_id IS NOT NULL AND NEW.native_id IS DISTINCT FROM OLD.native_id)
      OR (OLD.terminal_at IS NOT NULL AND NEW IS DISTINCT FROM OLD)
      OR NEW.last_observed_at<OLD.last_observed_at THEN
     RAISE EXCEPTION 'external execution intent/native terminal is immutable' USING ERRCODE='23514';
   END IF;
 ELSIF NEW.platform_status<>'PENDING_DISPATCH' OR NEW.native_id IS NOT NULL
   OR NEW.terminal_at IS NOT NULL OR NEW.response_digest IS NOT NULL THEN
   RAISE EXCEPTION 'external execution must start before dispatch' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
ALTER TABLE admission.external_execution DROP COLUMN usage_digest;
ALTER TABLE admission.external_execution DROP COLUMN usage_observed_at;
ALTER TABLE admission.external_execution DROP COLUMN usage_projection;
