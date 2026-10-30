-- DD-163 / V-SCN-271–276：组件计量、额度与用量视图并入 Kailo 统一体系。
--
-- 1. tenant.quota.set 的额度项由三项扩为七项（component_tokens、knowledge_answers、
--    data_queries、file_storage），并可带只对 knowledge_answers、data_queries 有效的成员
--    上限。成员上限只是写前意图的冻结参数：权威在同一 OpenMeter entitlement 的 metadata，
--    Core 不保存成员用量或余额。
-- 2. outbox.usage_event 增加来源 COMPONENT_REPORT：原生页面组件经 07 §4.8.8 以目录 client
--    上报的已发生用量。归属该 binding 当前 generation 的用量归集 operation（attribution
--    BINDING），Customer 为 Tenant，subject 为 Customer key（Tenant ID），binding/release/
--    generation 与 count meter 的成员 Principal 只作维度。冻结后除投递状态外不可改，
--    COMMITTED 不回退；与其他来源共用同一 outbox 投递与 stored_at 查证。
ALTER TABLE admission.tenant_quota_intent DROP CONSTRAINT tenant_quota_intent_feature_check;
ALTER TABLE admission.tenant_quota_intent ADD CONSTRAINT tenant_quota_intent_feature_check
    CHECK (feature_key IN ('agent_tokens', 'automation_runs', 'agent_memory_writes',
        'component_tokens', 'knowledge_answers', 'data_queries', 'file_storage'));
ALTER TABLE admission.tenant_quota_intent ADD COLUMN member_limit_per_period bigint;
ALTER TABLE admission.tenant_quota_intent ADD CONSTRAINT tenant_quota_intent_member_limit_check
    CHECK (member_limit_per_period IS NULL
        OR (member_limit_per_period BETWEEN 0 AND 1000000000000
            AND feature_key IN ('knowledge_answers', 'data_queries')
            AND origin = 'SET'));

ALTER TABLE outbox.usage_event DROP CONSTRAINT usage_source_type;
ALTER TABLE outbox.usage_event ADD CONSTRAINT usage_source_type CHECK (source_type IN
    ('GATEWAY_DURABLE_USAGE', 'AGENT_INVOCATION', 'BUZZ_AGENT_MEMORY',
     'APPLICATION_ADAPTER_USAGE', 'COMPONENT_REPORT'));
ALTER TABLE outbox.usage_event DROP CONSTRAINT usage_native_source_shape;
ALTER TABLE outbox.usage_event ADD CONSTRAINT usage_native_source_shape CHECK (
    (source_type = 'GATEWAY_DURABLE_USAGE' AND (invocation_id IS NOT NULL OR component_binding_id IS NOT NULL)
        AND native_seq IS NOT NULL AND native_turn_id IS NULL)
    OR (source_type = 'AGENT_INVOCATION' AND invocation_id IS NOT NULL AND native_seq IS NULL
        AND source_id = invocation_id AND meter_key = 'automation.run' AND quantity = 1)
    OR (source_type = 'BUZZ_AGENT_MEMORY' AND native_seq IS NULL AND native_turn_id IS NULL
        AND meter_key IN ('agent_memory_read_count', 'agent_memory_write_count', 'agent_memory_plaintext_bytes'))
    OR (source_type = 'APPLICATION_ADAPTER_USAGE' AND invocation_id IS NULL AND native_seq IS NULL
        AND native_turn_id IS NULL AND agent_installation_resource_id IS NULL
        AND component_binding_id IS NOT NULL AND component_release_id IS NOT NULL
        AND component_projection_generation IS NOT NULL)
    OR (source_type = 'COMPONENT_REPORT' AND invocation_id IS NULL AND native_seq IS NULL
        AND native_turn_id IS NULL AND agent_installation_resource_id IS NULL
        AND component_binding_id IS NOT NULL AND component_release_id IS NOT NULL
        AND component_projection_generation IS NOT NULL
        AND ((meter_key IN ('knowledge_answer_count', 'data_query_count') AND quantity = 1)
          OR (meter_key = 'file_storage_bytes' AND quantity <= 1000000000000000))));
ALTER TABLE outbox.usage_event DROP CONSTRAINT usage_application_columns;
ALTER TABLE outbox.usage_event ADD CONSTRAINT usage_application_columns CHECK (
    source_type = 'APPLICATION_ADAPTER_USAGE'
    OR (source_type IN ('GATEWAY_DURABLE_USAGE', 'COMPONENT_REPORT') AND invocation_id IS NULL
        AND agent_installation_resource_id IS NULL AND component_binding_id IS NOT NULL
        AND component_release_id IS NOT NULL AND component_projection_generation IS NOT NULL)
    OR (component_binding_id IS NULL AND component_release_id IS NULL
        AND component_projection_generation IS NULL AND agent_installation_resource_id IS NOT NULL
        AND workspace_id IS NOT NULL));

CREATE FUNCTION projection.guard_component_report_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'UPDATE' THEN
  IF (to_jsonb(NEW) - ARRAY['settlement_status', 'stored_at', 'updated_at']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['settlement_status', 'stored_at', 'updated_at'])
     OR (OLD.settlement_status = 'COMMITTED' AND NEW IS DISTINCT FROM OLD) THEN
   RAISE EXCEPTION 'Component usage report is immutable once recorded' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.settlement_status <> 'PENDING_PUBLISH' OR NOT EXISTS (
  SELECT 1 FROM projection.application_runtime p
  JOIN catalog.application_binding b ON b.id = p.binding_id
  JOIN admission.action_execution origin ON origin.id = p.action_execution_id
  JOIN projection.openmeter_binding o ON o.tenant_id = b.tenant_id
  WHERE p.binding_id = NEW.component_binding_id AND p.generation = NEW.component_projection_generation
   AND p.component_release_id = NEW.component_release_id AND b.tenant_id = NEW.tenant_id
   AND b.workspace_id IS NOT DISTINCT FROM NEW.workspace_id
   AND NEW.operation_id = origin.operation_id
   AND o.status = 'ACTIVE' AND o.namespace = NEW.openmeter_namespace
   AND o.customer_id = NEW.openmeter_customer_id AND NEW.subject_key = b.tenant_id::text
   AND NEW.dimensions @> jsonb_build_object('tenant_id', NEW.tenant_id,
      'operation_id', NEW.operation_id, 'component_binding_id', b.id,
      'component_release_id', p.component_release_id,
      'component_projection_generation', p.generation, 'attribution', 'BINDING')
   AND (NEW.dimensions->>'workspace_id') IS NOT DISTINCT FROM NEW.workspace_id::text
   AND ((NEW.meter_key IN ('knowledge_answer_count', 'data_query_count')
         AND (NEW.dimensions->>'member_principal_id') IS NOT NULL)
     OR (NEW.meter_key = 'file_storage_bytes' AND NOT NEW.dimensions ? 'member_principal_id'
         AND (NEW.event->'data'->>'bytes')::bigint = NEW.quantity))
   AND NEW.id = NEW.openmeter_event_id AND NEW.event->>'id' = NEW.id::text
   AND NEW.event->>'source' = 'urn:platform:core:usage' AND NEW.event->>'specversion' = '1.0'
   AND NEW.event->>'subject' = NEW.subject_key
   AND NEW.event->>'type' = CASE NEW.meter_key
     WHEN 'knowledge_answer_count' THEN 'kailo.component.knowledge.answer'
     WHEN 'data_query_count' THEN 'kailo.component.data.query'
     WHEN 'file_storage_bytes' THEN 'kailo.component.storage.bytes' END
   AND (NEW.event->>'time')::timestamptz = NEW.occurred_at
   AND NEW.event->'data' @> (NEW.dimensions - 'workspace_id')
 ) THEN
  RAISE EXCEPTION 'Component usage report lacks the exact binding generation, Customer and event shape'
   USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER component_report_usage_guard BEFORE INSERT OR UPDATE ON outbox.usage_event
    FOR EACH ROW WHEN (NEW.source_type = 'COMPONENT_REPORT')
    EXECUTE FUNCTION projection.guard_component_report_usage();
CREATE INDEX usage_event_component_report ON outbox.usage_event (component_binding_id, occurred_at)
    WHERE source_type = 'COMPONENT_REPORT';
