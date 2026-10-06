DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM catalog.application_binding WHERE model_call_mode<>'NONE')
    OR EXISTS(SELECT 1 FROM projection.application_runtime WHERE model_projection IS NOT NULL) THEN
  RAISE EXCEPTION 'application model facts exist; rollback cannot erase them' USING ERRCODE='23514';
 END IF;
END $$;
DROP TRIGGER application_model_usage_guard ON outbox.usage_event;
DROP FUNCTION projection.guard_application_model_usage();
DROP TRIGGER usage_event_scope_guard ON outbox.usage_event;
CREATE TRIGGER usage_event_scope_guard BEFORE INSERT OR UPDATE ON outbox.usage_event
 FOR EACH ROW WHEN (NEW.source_type<>'APPLICATION_ADAPTER_USAGE')
 EXECUTE FUNCTION projection.guard_agent_model_usage();
ALTER TABLE outbox.usage_event DROP CONSTRAINT usage_application_columns;
ALTER TABLE outbox.usage_event ADD CONSTRAINT usage_application_columns CHECK(
 source_type='APPLICATION_ADAPTER_USAGE' OR (component_binding_id IS NULL
 AND component_release_id IS NULL AND component_projection_generation IS NULL
 AND agent_installation_resource_id IS NOT NULL AND workspace_id IS NOT NULL));
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
DROP TRIGGER application_model_state_guard ON catalog.application_binding;
DROP FUNCTION catalog.guard_application_model_state();
DROP TRIGGER application_model_guard ON projection.application_runtime;
DROP FUNCTION projection.guard_application_model();
ALTER TABLE projection.application_runtime DROP CONSTRAINT application_model_shape,
 DROP CONSTRAINT application_model_drained, DROP COLUMN model_usage_receipt,
 DROP COLUMN model_projection, DROP COLUMN model_state, DROP COLUMN model_dispatch_started,
 DROP COLUMN model_native_key_id, DROP COLUMN model_native_key_revision;
ALTER TABLE catalog.application_binding DROP CONSTRAINT application_binding_model_call_mode_check;
ALTER TABLE catalog.application_binding ADD CONSTRAINT application_binding_model_call_mode_check CHECK(model_call_mode='NONE');
