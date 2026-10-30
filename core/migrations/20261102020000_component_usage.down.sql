-- DD-165(5)：回滚条件。尚未 COMMITTED 的组件上报是还没在 OpenMeter 落库的已发生用量，
-- 删除它会丢失计量：存在任一这样的行即停止回滚，不改数据。已 COMMITTED 的行已在 OpenMeter
-- 落库，删除其 Core outbox 行不改变账本。管理员对新额度项或带成员上限的设置意图在旧 Core
-- 下不可解析、不可对账，存在即停止回滚；部署引导为新额度项建立的默认额度意图未结论时同样
-- 停止，已结论的只删除意图行（其 ActionExecution 与审计保留，OpenMeter entitlement 在旧
-- Core 下不被引用）。
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM outbox.usage_event
             WHERE source_type = 'COMPONENT_REPORT' AND settlement_status <> 'COMMITTED') THEN
    RAISE EXCEPTION 'uncommitted component usage reports exist; let the outbox commit them before rolling back';
  END IF;
  IF EXISTS (SELECT 1 FROM admission.tenant_quota_intent
             WHERE member_limit_per_period IS NOT NULL
                OR (feature_key NOT IN ('agent_tokens', 'automation_runs', 'agent_memory_writes')
                    AND (origin = 'SET' OR outcome IS NULL))) THEN
    RAISE EXCEPTION 'DD-165 quota intents exist; the previous Core cannot reconcile them';
  END IF;
END $$;
DELETE FROM admission.tenant_quota_intent
 WHERE origin = 'DEFAULT' AND outcome IS NOT NULL
   AND feature_key NOT IN ('agent_tokens', 'automation_runs', 'agent_memory_writes');
DROP INDEX outbox.usage_event_component_report;
DROP TRIGGER component_report_usage_guard ON outbox.usage_event;
DELETE FROM outbox.usage_event WHERE source_type = 'COMPONENT_REPORT';
DROP FUNCTION projection.guard_component_report_usage();
ALTER TABLE outbox.usage_event DROP CONSTRAINT usage_application_columns;
ALTER TABLE outbox.usage_event ADD CONSTRAINT usage_application_columns CHECK (
    source_type = 'APPLICATION_ADAPTER_USAGE'
    OR (source_type = 'GATEWAY_DURABLE_USAGE' AND invocation_id IS NULL
        AND agent_installation_resource_id IS NULL AND component_binding_id IS NOT NULL
        AND component_release_id IS NOT NULL AND component_projection_generation IS NOT NULL)
    OR (component_binding_id IS NULL AND component_release_id IS NULL
        AND component_projection_generation IS NULL AND agent_installation_resource_id IS NOT NULL
        AND workspace_id IS NOT NULL));
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
        AND component_projection_generation IS NOT NULL));
ALTER TABLE outbox.usage_event DROP CONSTRAINT usage_source_type;
ALTER TABLE outbox.usage_event ADD CONSTRAINT usage_source_type CHECK (source_type IN
    ('GATEWAY_DURABLE_USAGE', 'AGENT_INVOCATION', 'BUZZ_AGENT_MEMORY', 'APPLICATION_ADAPTER_USAGE'));
ALTER TABLE admission.tenant_quota_intent DROP CONSTRAINT tenant_quota_intent_member_limit_check;
ALTER TABLE admission.tenant_quota_intent DROP COLUMN member_limit_per_period;
ALTER TABLE admission.tenant_quota_intent DROP CONSTRAINT tenant_quota_intent_feature_check;
ALTER TABLE admission.tenant_quota_intent ADD CONSTRAINT tenant_quota_intent_feature_check
    CHECK (feature_key IN ('agent_tokens', 'automation_runs', 'agent_memory_writes'));
