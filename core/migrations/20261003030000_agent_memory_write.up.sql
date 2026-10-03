-- DD-66/68, 19 §5/6/8. No profile, value, patch, slug or ciphertext is stored.
-- This is the existing ActionExecution's external-write intent/evidence, not
-- a memory authority or a commercial reservation/credit ledger.
CREATE TABLE projection.agent_memory_write(
 action_execution_id uuid PRIMARY KEY REFERENCES admission.action_execution(id),
 installation_resource_id uuid NOT NULL REFERENCES catalog.agent_installation(resource_id),
 binding_digest text NOT NULL CHECK(binding_digest ~ '^[0-9a-f]{64}$'),
 native_address text NOT NULL CHECK(native_address ~ '^[0-9a-f]{64}$'),
 event_id text NOT NULL CHECK(event_id ~ '^[0-9a-f]{64}$'),
 created_at bigint NOT NULL CHECK(created_at>=0),
 old_head_event_id text CHECK(old_head_event_id ~ '^[0-9a-f]{64}$'),
 body_digest text NOT NULL CHECK(body_digest ~ '^[0-9a-f]{64}$'),
 plaintext_bytes bigint NOT NULL CHECK(plaintext_bytes>0 AND plaintext_bytes<=65535),
 relay_ack text NOT NULL CHECK(relay_ack IN ('UNKNOWN','ACCEPTED','REJECTED')),
 observed_head_event_id text CHECK(observed_head_event_id ~ '^[0-9a-f]{64}$'),
 outcome text CHECK(outcome IN ('VERIFIED','CONFLICT')),
 CHECK((outcome IS NULL)=(observed_head_event_id IS NULL)),
 CHECK(outcome IS NULL OR relay_ack='ACCEPTED'),
 CHECK(outcome IS DISTINCT FROM 'VERIFIED' OR observed_head_event_id=event_id),
 CHECK(outcome IS DISTINCT FROM 'CONFLICT' OR observed_head_event_id<>event_id),
 UNIQUE(installation_resource_id,event_id)
);
CREATE FUNCTION projection.guard_agent_memory_write() RETURNS trigger AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['relay_ack','observed_head_event_id','outcome'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['relay_ack','observed_head_event_id','outcome'])
    OR (OLD.relay_ack<>'UNKNOWN' AND NEW.relay_ack<>OLD.relay_ack)
    OR (OLD.outcome IS NOT NULL AND (NEW.outcome IS DISTINCT FROM OLD.outcome
      OR NEW.observed_head_event_id IS DISTINCT FROM OLD.observed_head_event_id)) THEN
    RAISE EXCEPTION 'Frozen Memory native event or observed result cannot be replaced' USING ERRCODE='check_violation';
  END IF;
 END IF;
 PERFORM 1 FROM admission.action_execution a
 JOIN catalog.action_definition d ON d.action_key=a.action_key AND d.version=a.action_version
 JOIN catalog.agent_installation i ON i.resource_id=a.target_id AND i.workspace_id=a.workspace_id
 JOIN catalog.resource r ON r.id=i.resource_id AND r.tenant_id=a.tenant_id
 JOIN identity.principal p ON p.id=a.initiator_principal_id AND p.tenant_id=a.tenant_id AND p.kind='HUMAN'
 WHERE a.id=NEW.action_execution_id AND a.target_id=NEW.installation_resource_id
  AND a.actor_principal_id=a.initiator_principal_id AND a.gate_state='ALLOWED'
  AND a.action_key IN ('agent.memory.core.replace','agent.memory.entry.set','agent.memory.entry.patch','agent.memory.entry.remove')
  AND d.permission='update' AND d.permission_object_type='resource' AND d.execution_mode='SYNC'
  AND d.confirmation_mode='NONE' AND d.approval_policy_id IS NULL AND d.approval_policy_version IS NULL
  AND d.quota_policy='CHECK' AND d.meters=ARRAY['agent_memory_write_count','agent_memory_plaintext_bytes']
  AND r.type_key='agent.installation' AND r.home_workspace_id=i.workspace_id
  AND a.parameters->>'commandDigest' ~ '^[0-9a-f]{64}$'
  AND a.parameters->>'slugDigest' ~ '^[0-9a-f]{64}$'
  AND (TG_OP='UPDATE' OR (r.state='ACTIVE' AND i.state='ACTIVE'
    AND r.owner_principal_id=p.id AND p.status='ACTIVE'
    AND r.version=(a.parameters->>'targetVersion')::integer));
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Memory write intent lacks exact HUMAN owner/update/CHECK/Installation scope' USING ERRCODE='check_violation';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER agent_memory_write_scope_guard BEFORE INSERT OR UPDATE ON projection.agent_memory_write
 FOR EACH ROW EXECUTE FUNCTION projection.guard_agent_memory_write();
ALTER TABLE outbox.usage_event DROP CONSTRAINT usage_native_source_shape;
ALTER TABLE outbox.usage_event ADD CONSTRAINT usage_native_source_shape CHECK(
 (source_type='GATEWAY_DURABLE_USAGE' AND invocation_id IS NOT NULL AND native_seq IS NOT NULL AND native_turn_id IS NULL)
 OR (source_type='AGENT_INVOCATION' AND invocation_id IS NOT NULL AND native_seq IS NULL AND native_turn_id IS NOT NULL
     AND source_id=invocation_id AND meter_key='automation.run' AND quantity=1)
 OR (source_type='BUZZ_AGENT_MEMORY' AND invocation_id IS NULL AND native_seq IS NULL AND native_turn_id IS NULL
     AND meter_key IN ('agent_memory_read_count','agent_memory_write_count','agent_memory_plaintext_bytes')));

CREATE OR REPLACE FUNCTION projection.guard_agent_model_usage() RETURNS trigger AS $$
DECLARE native_namespace text;
BEGIN

    IF TG_TABLE_NAME='usage_event' THEN
        IF NEW.source_type='BUZZ_AGENT_MEMORY' AND EXISTS(
          SELECT 1 FROM admission.action_execution a WHERE a.id=NEW.source_id AND a.action_key IN
          ('agent.memory.core.replace','agent.memory.entry.set','agent.memory.entry.patch','agent.memory.entry.remove')) THEN
            IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['settlement_status','stored_at','updated_at'])
              IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['settlement_status','stored_at','updated_at']) THEN
                RAISE EXCEPTION 'Memory write usage native attribution is immutable' USING ERRCODE='check_violation';
            END IF;
            IF TG_OP='UPDATE' AND OLD.settlement_status='COMMITTED' AND NEW IS DISTINCT FROM OLD THEN
                RAISE EXCEPTION 'Stored Memory write usage cannot regress' USING ERRCODE='check_violation';
            END IF;
            PERFORM 1 FROM admission.action_execution a
            JOIN projection.agent_memory_write w ON w.action_execution_id=a.id
            JOIN catalog.action_definition d ON d.action_key=a.action_key AND d.version=a.action_version
            JOIN catalog.agent_installation i ON i.resource_id=a.target_id AND i.workspace_id=a.workspace_id
            JOIN catalog.resource r ON r.id=i.resource_id AND r.tenant_id=a.tenant_id
            JOIN LATERAL jsonb_array_elements(a.parameters->'memoryUsage'->'meters') m(value) ON true
            WHERE a.id=NEW.source_id AND a.operation_id=NEW.operation_id AND a.tenant_id=NEW.tenant_id
              AND a.workspace_id=NEW.workspace_id AND a.target_id=NEW.agent_installation_resource_id
              AND a.actor_principal_id=a.initiator_principal_id AND a.gate_state='ALLOWED'
              AND d.permission='update' AND d.permission_object_type='resource' AND d.quota_policy='CHECK'
              AND d.confirmation_mode='NONE' AND d.approval_policy_id IS NULL AND d.approval_policy_version IS NULL
              AND d.execution_mode='SYNC' AND r.type_key='agent.installation'
              AND w.relay_ack='ACCEPTED' AND w.outcome IN ('VERIFIED','CONFLICT')
              AND w.observed_head_event_id IS NOT NULL
              AND NEW.invocation_id IS NULL AND NEW.native_seq IS NULL AND NEW.native_turn_id IS NULL
              AND NEW.openmeter_namespace=a.parameters->'memoryUsage'->>'namespace'
              AND NEW.openmeter_customer_id=a.parameters->'memoryUsage'->>'customer_id'
              AND NEW.subject_key=a.parameters->'memoryUsage'->>'subject'
              AND NEW.meter_key=m.value->>'key' AND NEW.openmeter_event_id=NEW.id
              AND NEW.event->>'id'=NEW.id::text AND NEW.event->>'specversion'='1.0'
              AND NEW.event->>'source'='urn:platform:core:usage'
              AND NEW.event->>'subject'=NEW.subject_key AND NEW.event->>'type'=m.value->>'event_type'
              AND (NEW.event->>'time')::timestamptz=NEW.occurred_at AND NEW.event->'data'=NEW.dimensions
              AND NEW.dimensions @> jsonb_build_object('tenant_id',NEW.tenant_id,'workspace_id',NEW.workspace_id,
                'operation_id',NEW.operation_id,'agent_installation_resource_id',i.resource_id,
                'action_key',a.action_key,'slug_digest',a.parameters->>'slugDigest',
                'plaintext_bytes',w.plaintext_bytes,'write_outcome',w.outcome)
              AND jsonb_typeof(NEW.dimensions->'native_event_ids')='array'
              AND NEW.dimensions->'native_event_ids' @> jsonb_build_array(w.event_id,w.observed_head_event_id)
              AND ((NEW.meter_key='agent_memory_write_count' AND m.value->'value_property'='null'::jsonb AND NEW.quantity=1)
                OR (NEW.meter_key='agent_memory_plaintext_bytes' AND m.value->>'value_property'='$.plaintext_bytes'
                  AND NEW.quantity=w.plaintext_bytes)) IS TRUE
              AND EXISTS(SELECT 1 FROM audit.audit_event e WHERE e.operation_id=a.operation_id
                AND e.event_type='OUTCOME' AND e.event_key='memory-write:' || a.operation_id::text || ':verify'
                AND e.tenant_id=a.tenant_id AND e.workspace_id=a.workspace_id AND e.target_id=i.resource_id
                AND e.actor_principal_id=a.actor_principal_id AND e.action_key=a.action_key AND e.decision='ALLOW'
                AND e.result_code=w.outcome
                AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.dimensions->'native_event_ids') n(id)
                  WHERE n.id !~ '^[0-9a-f]{64}$' OR NOT EXISTS(
                    SELECT 1 FROM jsonb_array_elements(e.evidence_refs) evidence(value)
                    WHERE evidence.value->>'kind'='BuzzEventId' AND evidence.value->>'value'=n.id)));
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Memory write usage lacks same native event, outcome and billing pin' USING ERRCODE='check_violation';
            END IF;
            RETURN NEW;
        END IF;
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
                AND e.event_type='ACCESS' AND e.event_key='memory:' || a.operation_id::text AND e.action_key=a.action_key
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
SELECT action_key,1,'core','RESOURCE','SESSION_TENANT','WORKSPACE_REQUIRED','update','resource',
 'SYNC','NONE',NULL,NULL,NULL,NULL,'NONE',NULL,'CHECK',
 ARRAY['agent_memory_write_count','agent_memory_plaintext_bytes'],'NONE','FULL_LIFECYCLE','OPERATION_REF',
 'NONE','SYNC_RESULT','OPENMETER','NONE','PLATFORM_METADATA_ONLY','ACTIVE'
FROM unnest(ARRAY['agent.memory.core.replace','agent.memory.entry.set','agent.memory.entry.patch','agent.memory.entry.remove']) action_key;
