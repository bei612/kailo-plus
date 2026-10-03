-- DD-66/68, 03 §8, 19 §5/6: HUMAN reads have real Resource/ActionExecution,
-- not a fabricated Invocation/model trace. Only metadata joins the SAME outbox.
ALTER TABLE catalog.action_definition DROP CONSTRAINT result_exposure_enum;
ALTER TABLE catalog.action_definition ADD CONSTRAINT result_exposure_enum
 CHECK(result_exposure IN ('NONE','READ'));
ALTER TABLE catalog.action_definition DROP CONSTRAINT quota_check_supported;
ALTER TABLE catalog.action_definition ADD CONSTRAINT quota_check_supported CHECK(
 (quota_policy='NONE' AND cardinality(meters)=0)
 OR (quota_policy='CHECK' AND cardinality(meters)>0 AND array_ndims(meters)=1
     AND array_position(meters,NULL) IS NULL AND array_position(meters,'') IS NULL)
 OR (quota_policy='NONE' AND action_key IN
     ('agent.memory.core.read','agent.memory.entry.list','agent.memory.entry.read')
     AND execution_mode='SYNC' AND permission='read' AND permission_object_type='resource'
     AND result_exposure='READ' AND meters=ARRAY['agent_memory_read_count','agent_memory_plaintext_bytes']));
ALTER TABLE outbox.usage_event DROP CONSTRAINT usage_event_source_type_check;
ALTER TABLE outbox.usage_event DROP CONSTRAINT usage_event_check;
ALTER TABLE outbox.usage_event ALTER COLUMN invocation_id DROP NOT NULL;
ALTER TABLE outbox.usage_event ADD COLUMN openmeter_namespace text;
ALTER TABLE outbox.usage_event DISABLE TRIGGER usage_event_scope_guard;
UPDATE outbox.usage_event u SET openmeter_namespace=t.openmeter_namespace
  FROM projection.agent_model_trace t WHERE t.invocation_id=u.invocation_id;
ALTER TABLE outbox.usage_event ENABLE TRIGGER usage_event_scope_guard;
ALTER TABLE outbox.usage_event ALTER COLUMN openmeter_namespace SET NOT NULL;
ALTER TABLE outbox.usage_event ADD CONSTRAINT usage_namespace_present CHECK(openmeter_namespace<>'');
ALTER TABLE outbox.usage_event ADD CONSTRAINT usage_source_type CHECK(source_type IN
  ('GATEWAY_DURABLE_USAGE','AGENT_INVOCATION','BUZZ_AGENT_MEMORY'));
ALTER TABLE outbox.usage_event ADD CONSTRAINT usage_native_source_shape CHECK(
  (source_type='GATEWAY_DURABLE_USAGE' AND invocation_id IS NOT NULL AND native_seq IS NOT NULL AND native_turn_id IS NULL)
  OR (source_type='AGENT_INVOCATION' AND invocation_id IS NOT NULL AND native_seq IS NULL AND native_turn_id IS NOT NULL
      AND source_id=invocation_id AND meter_key='automation.run' AND quantity=1)
  OR (source_type='BUZZ_AGENT_MEMORY' AND invocation_id IS NULL AND native_seq IS NULL AND native_turn_id IS NULL
      AND meter_key IN ('agent_memory_read_count','agent_memory_plaintext_bytes')));
CREATE OR REPLACE FUNCTION projection.guard_agent_model_usage() RETURNS trigger AS $$
DECLARE native_namespace text;
BEGIN

    IF TG_TABLE_NAME='usage_event' THEN
        IF NEW.source_type='BUZZ_AGENT_MEMORY' THEN
            IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['settlement_status','stored_at','updated_at'])
                IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['settlement_status','stored_at','updated_at']) THEN
                RAISE EXCEPTION 'Memory UsageEvent 原生引用/归属/CloudEvent 不可替换' USING ERRCODE='check_violation';
            END IF;
            IF TG_OP='UPDATE' AND OLD.settlement_status='COMMITTED' AND NEW IS DISTINCT FROM OLD THEN
                RAISE EXCEPTION '已 stored 的 Memory usage 不得回退' USING ERRCODE='check_violation';
            END IF;
            PERFORM 1 FROM admission.action_execution a
            JOIN catalog.agent_installation i ON i.resource_id=a.target_id AND i.workspace_id=a.workspace_id
            JOIN catalog.resource r ON r.id=i.resource_id AND r.tenant_id=a.tenant_id
            JOIN catalog.action_definition d ON d.action_key=a.action_key AND d.version=a.action_version
            JOIN LATERAL jsonb_array_elements(a.parameters->'memoryUsage'->'meters') m(value) ON true
            WHERE a.id=NEW.source_id AND a.operation_id=NEW.operation_id
              AND a.tenant_id=NEW.tenant_id AND a.workspace_id=NEW.workspace_id
              AND a.actor_principal_id=a.initiator_principal_id
              AND a.gate_state='ALLOWED' AND d.permission='read' AND d.permission_object_type='resource'
              AND a.action_key IN ('agent.memory.core.read','agent.memory.entry.list','agent.memory.entry.read')
              AND NEW.agent_installation_resource_id=i.resource_id AND r.type_key='agent.installation'
              AND NEW.invocation_id IS NULL AND NEW.native_seq IS NULL AND NEW.native_turn_id IS NULL
              AND NEW.openmeter_namespace=a.parameters->'memoryUsage'->>'namespace'
              AND NEW.openmeter_customer_id=a.parameters->'memoryUsage'->>'customer_id'
              AND NEW.subject_key=a.parameters->'memoryUsage'->>'subject'
              AND NEW.meter_key=m.value->>'key'
              AND NEW.openmeter_event_id=NEW.id AND NEW.event->>'id'=NEW.id::text
              AND NEW.event->>'specversion'='1.0' AND NEW.event->>'source'='urn:platform:core:usage'
              AND NEW.event->>'subject'=NEW.subject_key AND NEW.event->>'type'=m.value->>'event_type'
              AND (NEW.event->>'time')::timestamptz=NEW.occurred_at
              AND NEW.event->'data'=NEW.dimensions
              AND NEW.dimensions @> jsonb_build_object('tenant_id',NEW.tenant_id,'workspace_id',NEW.workspace_id,
                'operation_id',NEW.operation_id,'agent_installation_resource_id',i.resource_id,
                'action_key',a.action_key,'slug_digest',a.parameters->>'slugDigest')
              AND ((NEW.dimensions->>'plaintext_bytes')::bigint>=0) IS TRUE
              AND jsonb_typeof(NEW.dimensions->'native_event_ids')='array'
              AND ((NEW.meter_key='agent_memory_read_count' AND m.value->'value_property'='null'::jsonb AND NEW.quantity=1)
                OR (NEW.meter_key='agent_memory_plaintext_bytes' AND m.value->>'value_property'='$.plaintext_bytes'
                  AND NEW.quantity=(NEW.dimensions->>'plaintext_bytes')::bigint)) IS TRUE
              AND EXISTS(SELECT 1 FROM audit.audit_event e WHERE e.operation_id=a.operation_id
                AND e.event_type='ACCESS' AND e.event_key='memory:' || a.operation_id::text
                AND e.action_key=a.action_key
                AND e.tenant_id=a.tenant_id AND e.workspace_id=a.workspace_id AND e.target_id=i.resource_id
                AND e.actor_principal_id=a.actor_principal_id AND e.decision='ALLOW'
                AND e.result_code=NEW.dimensions->>'read_outcome'
                AND e.result_code IN ('FOUND','ABSENT','COMPLETE')
                AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.dimensions->'native_event_ids') n(id)
                  WHERE n.id !~ '^[0-9a-f]{64}$' OR NOT EXISTS(
                    SELECT 1 FROM jsonb_array_elements(e.evidence_refs) evidence(value)
                    WHERE evidence.value->>'kind'='BuzzEventId' AND evidence.value->>'value'=n.id)));
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Memory usage 缺同 scope 的真实 HUMAN read/AE/原生 head/计量 pin' USING ERRCODE='check_violation';
            END IF;
            RETURN NEW;
        END IF;
        -- Existing producers do not invent a default namespace: project the
        -- already frozen real trace before NOT NULL/immutability validation.
        SELECT t.openmeter_namespace INTO STRICT native_namespace FROM projection.agent_model_trace t
          WHERE t.invocation_id=NEW.invocation_id;
        IF NEW.openmeter_namespace IS NULL THEN NEW.openmeter_namespace:=native_namespace; END IF;
        IF NEW.openmeter_namespace IS DISTINCT FROM native_namespace THEN
            RAISE EXCEPTION '模型 usage namespace 与写前原生 trace 不同' USING ERRCODE='check_violation';
        END IF;
    END IF;
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
INSERT INTO catalog.action_definition
(action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,permission,permission_object_type,
 execution_mode,confirmation_mode,approval_policy_id,approval_policy_version,workflow_type,workflow_kind,
 capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,obs_correlation_mode,
 obs_progress_source,obs_terminal_source,obs_usage_source,obs_cost_source,obs_redaction_policy,status)
SELECT action_key,1,'core','RESOURCE','SESSION_TENANT','WORKSPACE_REQUIRED','read','resource',
 'SYNC','NONE',NULL,NULL,NULL,NULL,'NONE',NULL,'NONE',
 ARRAY['agent_memory_read_count','agent_memory_plaintext_bytes'],'READ','FULL_LIFECYCLE','OPERATION_REF',
 'NONE','SYNC_RESULT','OPENMETER','NONE','PLATFORM_METADATA_ONLY','ACTIVE'
FROM unnest(ARRAY['agent.memory.core.read','agent.memory.entry.list','agent.memory.entry.read']) action_key;
