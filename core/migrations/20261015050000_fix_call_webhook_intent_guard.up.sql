-- 20261015020000 的守卫里 `NEW.webhook_intent->'usage'-ARRAY[...]` 按 PostgreSQL 运算符优先级
-- 解析为 `webhook_intent->('usage'-ARRAY[...])`，'usage' 被当作 jsonb 字面量解析失败
-- （invalid input syntax for type json），任何 call_webhook 都无法冻结发送意图。
-- 只给该子表达式加括号，其余判定与原函数逐字相同。
CREATE OR REPLACE FUNCTION catalog.guard_automation_webhook() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind text;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.webhook_request_id IS NOT NULL OR NEW.webhook_intent IS NOT NULL OR NEW.webhook_outcome IS NOT NULL THEN
   RAISE EXCEPTION 'A webhook dispatch starts empty' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
 END IF;
 IF OLD.webhook_intent IS NOT NULL AND (NEW.webhook_intent IS DISTINCT FROM OLD.webhook_intent
   OR NEW.webhook_request_id IS DISTINCT FROM OLD.webhook_request_id) THEN
  RAISE EXCEPTION 'Webhook dispatch intent is immutable' USING ERRCODE='check_violation';
 END IF;
 IF OLD.webhook_outcome IS NOT NULL AND NEW.webhook_outcome IS DISTINCT FROM OLD.webhook_outcome THEN
  RAISE EXCEPTION 'Webhook response is recorded once' USING ERRCODE='check_violation';
 END IF;
 IF NEW.webhook_intent IS NULL THEN
  IF NEW.webhook_request_id IS NOT NULL OR NEW.webhook_outcome IS NOT NULL THEN
   RAISE EXCEPTION 'Webhook facts require a dispatch intent' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
 END IF;
 IF OLD.webhook_intent IS NULL THEN
  SELECT v.action->>'kind' INTO kind FROM catalog.automation_version v
   WHERE v.asset_id=NEW.automation_version_asset_id AND v.automation_resource_id=NEW.automation_resource_id;
  IF kind IS DISTINCT FROM 'CALL_WEBHOOK_STEPS' OR OLD.status<>'CREATED' OR NEW.status<>'DISPATCHING'
   OR NEW.cancel_pending OR NEW.automation_effect_skipped OR NEW.webhook_outcome IS NOT NULL
   OR NEW.reply_event_id IS NOT NULL OR NEW.post_message_intent IS NOT NULL
   OR NEW.runtime_turn_id IS NOT NULL OR NEW.native_status IS NOT NULL
   OR cardinality(NEW.automation_step_event_ids)<>0
   OR NEW.webhook_request_id IS NULL
   OR NEW.webhook_request_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR NOT ((jsonb_typeof(NEW.webhook_intent)='object'
    AND (NEW.webhook_intent-ARRAY['usage','request_digest','destination'])='{}'::jsonb
    AND NEW.webhook_intent->>'request_digest' ~ '^[0-9a-f]{64}$'
    AND length(NEW.webhook_intent->>'destination')>0
    AND ((NEW.webhook_intent->'usage')-ARRAY['created_at','customer_id','namespace','subject','binding_version','meter'])='{}'::jsonb
    AND NEW.webhook_intent->'usage'->'meter'->>'key'='automation.run'
    AND length(NEW.webhook_intent->'usage'->'meter'->>'id')>0
    AND length(NEW.webhook_intent->'usage'->'meter'->>'event_type')>0) IS TRUE) THEN
   RAISE EXCEPTION 'Webhook dispatch intent requires the exact admitted run' USING ERRCODE='check_violation';
  END IF;
  PERFORM 1 FROM projection.openmeter_binding o JOIN admission.action_execution a
    ON a.id=NEW.action_execution_id AND a.tenant_id=NEW.tenant_id AND a.workspace_id=NEW.workspace_id
  WHERE o.tenant_id=NEW.tenant_id AND o.status='ACTIVE'
    AND a.action_key='automation.run' AND a.target_id=NEW.automation_resource_id
    AND a.gate_state='ALLOWED' AND a.dispatch_state='DISPATCHED'
    AND o.customer_id=NEW.webhook_intent->'usage'->>'customer_id'
    AND o.namespace=NEW.webhook_intent->'usage'->>'namespace'
    AND o.subject_key_prefix || NEW.installation_resource_id::text=NEW.webhook_intent->'usage'->>'subject'
    AND o.version=(NEW.webhook_intent->'usage'->>'binding_version')::bigint
    AND (NEW.webhook_intent->'usage'->>'created_at')::timestamptz<=clock_timestamp();
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Webhook dispatch intent scope/Customer missing' USING ERRCODE='check_violation';
  END IF;
 END IF;
 IF OLD.webhook_outcome IS NULL AND NEW.webhook_outcome IS NOT NULL AND (
   OLD.status NOT IN ('DISPATCHING','UNKNOWN') OR NEW.status NOT IN ('DISPATCHING','UNKNOWN','COMPLETED')
   OR NOT ((jsonb_typeof(NEW.webhook_outcome)='object'
    AND (NEW.webhook_outcome-'status')='{}'::jsonb
    AND jsonb_typeof(NEW.webhook_outcome->'status')='number'
    AND (NEW.webhook_outcome->>'status')::numeric BETWEEN 100 AND 599
    AND (NEW.webhook_outcome->>'status')::numeric=trunc((NEW.webhook_outcome->>'status')::numeric)) IS TRUE)) THEN
  RAISE EXCEPTION 'Webhook response belongs to its one dispatch' USING ERRCODE='check_violation';
 END IF;
 IF NEW.status IS DISTINCT FROM OLD.status THEN
  -- Once the intent exists the request may have left: no cancellation, and
  -- UNKNOWN only ends by the recorded response of the same dispatch.
  IF NEW.status='CANCELED' OR (OLD.status='UNKNOWN' AND NEW.status<>'COMPLETED')
   OR (NEW.status='FAILED' AND (OLD.status<>'DISPATCHING' OR NEW.webhook_outcome IS NOT NULL))
   OR (NEW.status='COMPLETED' AND NEW.webhook_outcome IS NULL) THEN
   RAISE EXCEPTION 'A dispatched webhook keeps its evidence-bound status' USING ERRCODE='check_violation';
  END IF;
  IF NEW.status='COMPLETED' THEN
   PERFORM 1 FROM outbox.usage_event u JOIN admission.action_execution a
     ON a.id=NEW.action_execution_id AND a.operation_id=u.operation_id
   WHERE u.invocation_id=NEW.id AND u.tenant_id=NEW.tenant_id AND u.workspace_id=NEW.workspace_id
     AND u.source_type='AGENT_INVOCATION' AND u.source_id=NEW.id AND u.native_turn_id IS NULL
     AND u.meter_key='automation.run' AND u.quantity=1 AND u.settlement_status='COMMITTED'
     AND u.stored_at IS NOT NULL AND u.dimensions->>'webhook_request_id'=NEW.webhook_request_id;
   IF NOT FOUND THEN
    RAISE EXCEPTION 'Webhook completion requires its committed COUNT' USING ERRCODE='check_violation';
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
