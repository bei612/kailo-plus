-- Stop rollback once this source has real operation/outbox facts; do not erase
-- billable reads or pretend they were model invocations.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM outbox.usage_event WHERE source_type='BUZZ_AGENT_MEMORY')
   OR EXISTS(SELECT 1 FROM admission.action_execution WHERE action_key IN
     ('agent.memory.core.read','agent.memory.entry.list','agent.memory.entry.read')) THEN
   RAISE EXCEPTION 'Memory read 已有 AE/UsageEvent；禁止破坏性回退';
 END IF;
END $$;
DELETE FROM catalog.action_definition WHERE action_key IN
 ('agent.memory.core.read','agent.memory.entry.list','agent.memory.entry.read') AND version=1;
ALTER TABLE catalog.action_definition DROP CONSTRAINT quota_check_supported;
ALTER TABLE catalog.action_definition ADD CONSTRAINT quota_check_supported CHECK(
 (quota_policy='NONE' AND cardinality(meters)=0)
 OR (quota_policy='CHECK' AND cardinality(meters)>0 AND array_ndims(meters)=1
     AND array_position(meters,NULL) IS NULL AND array_position(meters,'') IS NULL));
ALTER TABLE catalog.action_definition DROP CONSTRAINT result_exposure_enum;
ALTER TABLE catalog.action_definition ADD CONSTRAINT result_exposure_enum CHECK(result_exposure IN ('NONE'));
CREATE OR REPLACE FUNCTION projection.guard_agent_model_usage() RETURNS trigger AS $$
BEGIN
    IF TG_TABLE_NAME='agent_model_trace' THEN
        IF TG_OP='UPDATE' AND NEW IS DISTINCT FROM OLD THEN
            RAISE EXCEPTION '已派发模型的 trace/归属/meter 事实不可替换' USING ERRCODE='check_violation';
        END IF;
        PERFORM 1 FROM catalog.agent_invocation i
        JOIN admission.action_execution a ON a.id=i.action_execution_id
        JOIN catalog.agent_model_binding b ON b.installation_resource_id=i.installation_resource_id
          AND b.projection_generation=i.projection_generation
        JOIN identity.principal p ON p.id=b.gateway_principal_id AND p.tenant_id=i.tenant_id AND p.kind='SERVICE'
        JOIN projection.openmeter_binding o ON o.tenant_id=i.tenant_id
        WHERE i.id=NEW.invocation_id AND a.operation_id=NEW.operation_id
          AND i.tenant_id=NEW.tenant_id AND i.workspace_id=NEW.workspace_id
          AND a.tenant_id=i.tenant_id AND a.workspace_id=i.workspace_id
          AND b.gateway_principal_id=NEW.gateway_principal_id
          AND o.customer_id=NEW.openmeter_customer_id AND o.namespace=NEW.openmeter_namespace
          AND o.version=NEW.binding_version AND NEW.subject_key=o.subject_key_prefix || i.installation_resource_id::text;
    ELSE
        IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['settlement_status','stored_at','updated_at'])
            IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['settlement_status','stored_at','updated_at']) THEN
            RAISE EXCEPTION 'UsageEvent 已冻结的身份/quantity/CloudEvent 不可替换' USING ERRCODE='check_violation';
        END IF;
        IF TG_OP='UPDATE' AND OLD.settlement_status='COMMITTED' AND NEW IS DISTINCT FROM OLD THEN
            RAISE EXCEPTION '已查证 stored_at 的事件不得回退或重判' USING ERRCODE='check_violation';
        END IF;
        PERFORM 1 FROM projection.agent_model_trace t JOIN catalog.agent_invocation i ON i.id=t.invocation_id
        JOIN LATERAL (
            SELECT value FROM jsonb_array_elements(t.meter_projection) WHERE NEW.source_type='GATEWAY_DURABLE_USAGE'
            UNION ALL SELECT t.invocation_meter_projection WHERE NEW.source_type='AGENT_INVOCATION'
        ) m(value) ON true
        WHERE t.invocation_id=NEW.invocation_id AND t.operation_id=NEW.operation_id
          AND t.tenant_id=NEW.tenant_id AND t.workspace_id=NEW.workspace_id
          AND t.openmeter_customer_id=NEW.openmeter_customer_id AND t.subject_key=NEW.subject_key
          AND i.installation_resource_id=NEW.agent_installation_resource_id
          AND NEW.openmeter_event_id=NEW.id AND NEW.event->>'id'=NEW.openmeter_event_id::text
          AND NEW.event->>'source'='urn:platform:core:usage' AND NEW.event->>'specversion'='1.0'
          AND (NEW.event->>'time')::timestamptz=NEW.occurred_at
          AND NEW.event->>'subject'=NEW.subject_key AND NEW.event->>'type'=m.value->>'event_type'
          AND NEW.meter_key=m.value->>'key'
          AND NEW.dimensions @> jsonb_build_object('tenant_id',NEW.tenant_id,'workspace_id',NEW.workspace_id,
              'operation_id',NEW.operation_id,'agent_installation_resource_id',NEW.agent_installation_resource_id,
              'agent_version_asset_id',i.agent_version_asset_id)
          AND ((NEW.source_type='GATEWAY_DURABLE_USAGE'
            AND ((NEW.event->'data')-ARRAY['inputTokens','outputTokens','totalTokens'])=NEW.dimensions
            AND CASE m.value->>'value_property'
              WHEN '$.inputTokens' THEN (NEW.event->'data'->>'inputTokens')::bigint
              WHEN '$.outputTokens' THEN (NEW.event->'data'->>'outputTokens')::bigint
              WHEN '$.totalTokens' THEN (NEW.event->'data'->>'totalTokens')::bigint
              ELSE NULL END = NEW.quantity)
            OR (NEW.source_type='AGENT_INVOCATION' AND NEW.native_turn_id=i.runtime_turn_id
                AND NEW.quantity=1 AND NEW.event->'data'=NEW.dimensions
                AND NEW.dimensions->>'automation_resource_id'=i.automation_resource_id::text));
    END IF;
    IF NOT FOUND THEN
        RAISE EXCEPTION '模型 trace/usage 必须引用同 scope 的 Invocation/Action/受控 binding' USING ERRCODE='check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER TABLE outbox.usage_event DROP CONSTRAINT usage_namespace_present;
ALTER TABLE outbox.usage_event DROP CONSTRAINT usage_source_type;
ALTER TABLE outbox.usage_event DROP CONSTRAINT usage_native_source_shape;
ALTER TABLE outbox.usage_event DROP COLUMN openmeter_namespace;
ALTER TABLE outbox.usage_event ALTER COLUMN invocation_id SET NOT NULL;
ALTER TABLE outbox.usage_event ADD CONSTRAINT usage_event_source_type_check
 CHECK(source_type IN ('GATEWAY_DURABLE_USAGE','AGENT_INVOCATION'));
ALTER TABLE outbox.usage_event ADD CONSTRAINT usage_event_check CHECK(
 (source_type='GATEWAY_DURABLE_USAGE' AND native_seq IS NOT NULL AND native_turn_id IS NULL)
 OR (source_type='AGENT_INVOCATION' AND native_seq IS NULL AND native_turn_id IS NOT NULL
   AND source_id=invocation_id AND meter_key='automation.run' AND quantity=1));
