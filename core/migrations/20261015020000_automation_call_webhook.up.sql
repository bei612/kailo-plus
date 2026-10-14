-- REQ-23/24, DD-107, 06 §9.1: fixed Buzz ActionDef::CallWebhook as the final
-- effect of an immutable AutomationVersion. Core freezes one dispatch intent
-- (stable request reference, billing pin, request digest without secrets)
-- before the only send through AgentGateway, records the received HTTP status
-- once, and never resends: an undetermined send stays UNKNOWN.
ALTER TABLE catalog.agent_invocation
 ADD COLUMN webhook_request_id text,
 ADD COLUMN webhook_intent jsonb,
 ADD COLUMN webhook_outcome jsonb;

ALTER TABLE catalog.automation_version DROP CONSTRAINT automation_version_action_check;
ALTER TABLE catalog.automation_version ADD CONSTRAINT automation_version_action_check CHECK ((
 jsonb_typeof(action)='object' AND (
  (action->>'kind' IN ('AGENT_TURN','POST_MESSAGE','POST_MESSAGE_STEPS')
   AND jsonb_typeof(action->'template')='string' AND length(action->>'template')>0)
  OR (action->>'kind'='ADD_REACTION_STEPS' AND jsonb_typeof(action->'emoji')='string'
   AND length(action->>'emoji')>0 AND trigger->>'kind' IN ('CHANNEL_MESSAGE','MENTION','DIFF_POSTED','REACTION_ADDED'))
  OR (action->>'kind'='SET_CHANNEL_TOPIC_STEPS' AND jsonb_typeof(action->'topic')='string')
  OR (action->>'kind'='CALL_WEBHOOK_STEPS' AND jsonb_typeof(action->'url')='string'
   AND action->>'url' LIKE 'https://%'))
 AND (action->>'kind' NOT IN ('POST_MESSAGE_STEPS','ADD_REACTION_STEPS','SET_CHANNEL_TOPIC_STEPS','CALL_WEBHOOK_STEPS') OR (
  (action->'stepsVersion'='2'::jsonb OR (action->>'kind'='POST_MESSAGE_STEPS' AND action->'stepsVersion'='3'::jsonb))
  AND jsonb_typeof(action->'steps')='array' AND jsonb_array_length(action->'steps')>0))) IS TRUE);

ALTER TABLE catalog.agent_invocation DROP CONSTRAINT agent_invocation_check;
ALTER TABLE catalog.agent_invocation ADD CONSTRAINT agent_invocation_check CHECK(
 status<>'COMPLETED' OR (reply_event_id IS NOT NULL AND webhook_intent IS NULL AND (
   native_status IS NOT DISTINCT FROM 'completed'
   OR (post_message_intent IS NOT NULL AND runtime_turn_id IS NULL AND native_status IS NULL)))
 OR (automation_effect_skipped AND reply_event_id IS NULL AND post_message_intent IS NULL AND webhook_intent IS NULL
   AND runtime_turn_id IS NULL AND native_status IS NULL AND cardinality(automation_step_event_ids)=0)
 OR (webhook_intent IS NOT NULL AND webhook_outcome IS NOT NULL AND NOT automation_effect_skipped
   AND reply_event_id IS NULL AND post_message_intent IS NULL AND runtime_turn_id IS NULL
   AND native_status IS NULL AND cardinality(automation_step_event_ids)=0));

CREATE FUNCTION catalog.guard_automation_webhook() RETURNS trigger LANGUAGE plpgsql AS $$
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
    AND (NEW.webhook_intent->'usage'-ARRAY['created_at','customer_id','namespace','subject','binding_version','meter'])='{}'::jsonb
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
CREATE TRIGGER automation_webhook_guard BEFORE INSERT OR UPDATE ON catalog.agent_invocation
 FOR EACH ROW EXECUTE FUNCTION catalog.guard_automation_webhook();

CREATE OR REPLACE FUNCTION catalog.guard_automation_effect_skipped() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE action jsonb; skipped jsonb;
BEGIN
 IF TG_OP='UPDATE' AND OLD.automation_effect_skipped THEN
  IF NOT NEW.automation_effect_skipped OR NEW.status<>'COMPLETED' THEN
   RAISE EXCEPTION 'A no-effect completion is terminal' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
 END IF;
 IF NOT NEW.automation_effect_skipped THEN RETURN NEW; END IF;
 SELECT v.action INTO action FROM catalog.automation_version v
  WHERE v.asset_id=NEW.automation_version_asset_id AND v.automation_resource_id=NEW.automation_resource_id;
 skipped:=catalog.automation_skipped_steps(NEW.action_execution_id);
 IF TG_OP<>'UPDATE' OR OLD.status<>'CREATED' OR NEW.status<>'COMPLETED' OR NEW.cancel_pending
  OR NEW.webhook_intent IS NOT NULL
  OR action->>'kind' NOT IN ('POST_MESSAGE_STEPS','ADD_REACTION_STEPS','SET_CHANNEL_TOPIC_STEPS','CALL_WEBHOOK_STEPS')
  OR jsonb_typeof(action->'steps') IS DISTINCT FROM 'array'
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(action->'steps') s
   WHERE s->>'action' IN ('send_message','add_reaction','set_channel_topic','call_webhook') AND NOT skipped ? (s->>'id'))
  OR NOT EXISTS(SELECT 1 FROM admission.action_execution a WHERE a.id=NEW.action_execution_id
   AND a.action_key='automation.run' AND a.gate_state='ALLOWED' AND a.dispatch_state='DISPATCHED'
   AND a.tenant_id=NEW.tenant_id AND a.workspace_id=NEW.workspace_id AND a.target_id=NEW.automation_resource_id) THEN
  RAISE EXCEPTION 'Only a run whose every effect step was frozen as skipped completes without an effect'
   USING ERRCODE='check_violation';
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION admission.reject_message_capacity() RETURNS trigger AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM catalog.agent_invocation i JOIN catalog.automation_version v
   ON v.asset_id=i.automation_version_asset_id AND v.automation_resource_id=i.automation_resource_id
   WHERE i.id=NEW.invocation_id AND v.action->>'kind' IN ('POST_MESSAGE','POST_MESSAGE_STEPS','ADD_REACTION_STEPS','SET_CHANNEL_TOPIC_STEPS','CALL_WEBHOOK_STEPS')) THEN
   RAISE EXCEPTION 'POST_MESSAGE capacity policy is NONE' USING ERRCODE='check_violation';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION projection.guard_agent_model_usage() RETURNS trigger AS $$
DECLARE native_namespace text;
BEGIN

    IF TG_TABLE_NAME='usage_event' THEN
      IF NEW.source_type='AGENT_INVOCATION' AND NEW.native_turn_id IS NULL THEN
        IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['settlement_status','stored_at','updated_at'])
            IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['settlement_status','stored_at','updated_at'])
            OR (OLD.settlement_status='COMMITTED' AND NEW IS DISTINCT FROM OLD)) THEN
            RAISE EXCEPTION 'POST_MESSAGE UsageEvent frozen source cannot change' USING ERRCODE='check_violation';
        END IF;
        -- Original call_webhook: one COUNT per run, only after the response of
        -- this run's single frozen dispatch was recorded in the same operation.
        IF EXISTS(SELECT 1 FROM catalog.agent_invocation wi JOIN catalog.automation_version wv
            ON wv.asset_id=wi.automation_version_asset_id AND wv.automation_resource_id=wi.automation_resource_id
          WHERE wi.id=NEW.invocation_id AND wv.action->>'kind'='CALL_WEBHOOK_STEPS') THEN
          PERFORM 1 FROM catalog.agent_invocation i
          JOIN admission.action_execution a ON a.id=i.action_execution_id
            AND a.tenant_id=i.tenant_id AND a.workspace_id=i.workspace_id AND a.action_key='automation.run'
            AND a.target_id=i.automation_resource_id AND a.gate_state='ALLOWED' AND a.dispatch_state='DISPATCHED'
          WHERE i.id=NEW.invocation_id AND NEW.source_id=i.id AND NEW.operation_id=a.operation_id
            AND NEW.tenant_id=i.tenant_id AND NEW.workspace_id=i.workspace_id
            AND NEW.agent_installation_resource_id=i.installation_resource_id
            AND i.runtime_turn_id IS NULL AND i.native_status IS NULL AND i.reply_event_id IS NULL
            AND i.webhook_request_id IS NOT NULL AND i.webhook_outcome IS NOT NULL
            AND NEW.native_seq IS NULL AND NEW.quantity=1 AND NEW.meter_key='automation.run'
            AND NEW.openmeter_namespace=i.webhook_intent->'usage'->>'namespace'
            AND NEW.openmeter_customer_id=i.webhook_intent->'usage'->>'customer_id'
            AND NEW.subject_key=i.webhook_intent->'usage'->>'subject'
            AND NEW.occurred_at=(i.webhook_intent->'usage'->>'created_at')::timestamptz
            AND NEW.openmeter_event_id=NEW.id AND NEW.event->>'id'=NEW.id::text
            AND NEW.event->>'source'='urn:platform:core:usage' AND NEW.event->>'specversion'='1.0'
            AND NEW.event->>'type'=i.webhook_intent->'usage'->'meter'->>'event_type'
            AND NEW.event->>'subject'=NEW.subject_key AND (NEW.event->>'time')::timestamptz=NEW.occurred_at
            AND NEW.event->'data'=NEW.dimensions
            AND NEW.dimensions=jsonb_build_object('tenant_id',i.tenant_id,'workspace_id',i.workspace_id,
              'operation_id',a.operation_id,'agent_installation_resource_id',i.installation_resource_id,
              'agent_version_asset_id',i.agent_version_asset_id,'automation_resource_id',i.automation_resource_id,
              'webhook_request_id',i.webhook_request_id)
            AND EXISTS(SELECT 1 FROM audit.audit_event e WHERE e.operation_id=a.operation_id
              AND e.tenant_id=i.tenant_id AND e.workspace_id=i.workspace_id
              AND e.action_key=a.action_key AND e.action_version=a.action_version
              AND e.actor_principal_id=a.actor_principal_id AND e.parameter_hash=a.parameter_hash
              AND e.event_type='OUTCOME' AND e.result_code='RESPONDED'
              AND e.event_key=a.operation_id::text || ':agent-turn:' || i.id::text
                || ':webhook:' || i.webhook_request_id || ':outcome');
          IF NOT FOUND THEN RAISE EXCEPTION 'Webhook count needs the same-operation recorded response'
            USING ERRCODE='check_violation'; END IF;
          RETURN NEW;
        END IF;
        PERFORM 1 FROM catalog.agent_invocation i
        JOIN catalog.automation_version v ON v.asset_id=i.automation_version_asset_id
          AND v.automation_resource_id=i.automation_resource_id AND v.action->>'kind' IN ('POST_MESSAGE','POST_MESSAGE_STEPS','ADD_REACTION_STEPS','SET_CHANNEL_TOPIC_STEPS')
        JOIN admission.action_execution a ON a.id=i.action_execution_id
          AND a.tenant_id=i.tenant_id AND a.workspace_id=i.workspace_id AND a.action_key='automation.run'
          AND a.target_id=i.automation_resource_id AND a.gate_state='ALLOWED' AND a.dispatch_state='DISPATCHED'
        WHERE i.id=NEW.invocation_id AND NEW.source_id=i.id AND NEW.operation_id=a.operation_id
          AND NEW.tenant_id=i.tenant_id AND NEW.workspace_id=i.workspace_id
          AND NEW.agent_installation_resource_id=i.installation_resource_id
          AND i.runtime_turn_id IS NULL AND i.native_status IS NULL AND i.reply_event_id IS NOT NULL
          AND NEW.native_seq IS NULL AND NEW.quantity=1 AND NEW.meter_key='automation.run'
          AND NEW.openmeter_namespace=i.post_message_intent->>'namespace'
          AND NEW.openmeter_customer_id=i.post_message_intent->>'customer_id'
          AND NEW.subject_key=i.post_message_intent->>'subject'
          AND NEW.occurred_at=(i.post_message_intent->>'created_at')::timestamptz
          AND NEW.openmeter_event_id=NEW.id AND NEW.event->>'id'=NEW.id::text
          AND NEW.event->>'source'='urn:platform:core:usage' AND NEW.event->>'specversion'='1.0'
          AND NEW.event->>'type'=i.post_message_intent->'meter'->>'event_type'
          AND NEW.event->>'subject'=NEW.subject_key AND (NEW.event->>'time')::timestamptz=NEW.occurred_at
          AND NEW.event->'data'=NEW.dimensions
          AND NEW.dimensions=jsonb_build_object('tenant_id',i.tenant_id,'workspace_id',i.workspace_id,
            'operation_id',a.operation_id,'agent_installation_resource_id',i.installation_resource_id,
            'agent_version_asset_id',i.agent_version_asset_id,'automation_resource_id',i.automation_resource_id,
            'buzz_event_id',i.reply_event_id)
          AND EXISTS(SELECT 1 FROM audit.audit_event e WHERE e.operation_id=a.operation_id
            AND e.tenant_id=i.tenant_id AND e.workspace_id=i.workspace_id
            AND e.action_key=a.action_key AND e.action_version=a.action_version
            AND e.actor_principal_id=a.actor_principal_id AND e.parameter_hash=a.parameter_hash
            AND e.event_type='RECONCILIATION' AND e.result_code='ACCEPTED'
            AND e.evidence_refs @> jsonb_build_array(
              jsonb_build_object('kind','BUZZ_EVENT_ID','value',i.reply_event_id),
              jsonb_build_object('kind','ACTION_EXECUTION_ID','value',a.id::text)));
        IF NOT FOUND THEN RAISE EXCEPTION 'POST_MESSAGE count needs same-operation native publication'
            USING ERRCODE='check_violation'; END IF;
        RETURN NEW;
      END IF;
    END IF;
    IF TG_TABLE_NAME='agent_model_trace' AND EXISTS(
        SELECT 1 FROM catalog.agent_invocation i JOIN catalog.automation_version v
          ON v.asset_id=i.automation_version_asset_id AND v.automation_resource_id=i.automation_resource_id
        WHERE i.id=NEW.invocation_id AND v.action->>'kind' IN ('POST_MESSAGE','POST_MESSAGE_STEPS','ADD_REACTION_STEPS','SET_CHANNEL_TOPIC_STEPS','CALL_WEBHOOK_STEPS')) THEN
        RAISE EXCEPTION 'POST_MESSAGE cannot create a model trace' USING ERRCODE='check_violation';
    END IF;

    IF TG_TABLE_NAME='usage_event' THEN
        IF NEW.source_type='BUZZ_AGENT_MEMORY' AND EXISTS(
          SELECT 1 FROM admission.action_execution c WHERE c.id=NEW.source_id
            AND c.parent_action_execution_id IS NOT NULL) THEN
            IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['settlement_status','stored_at','updated_at'])
                IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['settlement_status','stored_at','updated_at']) THEN
                RAISE EXCEPTION 'Memory UsageEvent 原生引用/归属/CloudEvent 不可替换' USING ERRCODE='check_violation';
            END IF;
            IF TG_OP='UPDATE' AND OLD.settlement_status='COMMITTED' AND NEW IS DISTINCT FROM OLD THEN
                RAISE EXCEPTION '已 stored 的 Memory usage 不得回退' USING ERRCODE='check_violation';
            END IF;
            PERFORM 1 FROM admission.action_execution a
            JOIN admission.action_execution parent ON parent.id=a.parent_action_execution_id
              AND parent.parent_action_execution_id IS NULL
            JOIN catalog.agent_invocation invocation ON invocation.action_execution_id=parent.id
              AND invocation.id=NEW.invocation_id
              AND invocation.installation_resource_id=a.target_id
              AND invocation.tenant_id=a.tenant_id AND invocation.workspace_id=a.workspace_id
            JOIN identity.principal actor ON actor.id=a.actor_principal_id
              AND actor.tenant_id=a.tenant_id AND actor.kind='AGENT'
            JOIN identity.principal initiator ON initiator.id=a.initiator_principal_id
              AND initiator.tenant_id=a.tenant_id AND initiator.kind='HUMAN'
            JOIN catalog.agent_installation i ON i.resource_id=a.target_id AND i.workspace_id=a.workspace_id
            JOIN catalog.resource r ON r.id=i.resource_id AND r.tenant_id=a.tenant_id
            JOIN catalog.action_definition d ON d.action_key=a.action_key AND d.version=a.action_version
            JOIN LATERAL jsonb_array_elements(a.parameters->'memoryUsage'->'meters') m(value) ON true
            WHERE a.id=NEW.source_id AND a.operation_id=NEW.operation_id
              AND a.tenant_id=NEW.tenant_id AND a.workspace_id=NEW.workspace_id
              AND a.actor_principal_id=i.agent_principal_id
              AND a.actor_principal_id=parent.actor_principal_id
              AND a.initiator_principal_id=parent.initiator_principal_id
              AND a.operation_id=parent.operation_id AND a.correlation_id=parent.correlation_id
              AND a.tenant_id=parent.tenant_id AND a.workspace_id=parent.workspace_id
              AND parent.action_key IN ('agent.invoke','automation.run')
              AND invocation.id=(a.parameters->>'invocationId')::uuid
              AND invocation.runtime_turn_id=a.parameters->>'runtimeTurnId'
              AND a.gate_state='ALLOWED' AND d.permission='read' AND d.permission_object_type='resource'
              AND a.action_key IN ('agent.memory.entry.list','agent.memory.entry.read')
              AND d.workspace_rule='WORKSPACE_REQUIRED' AND d.execution_mode='SYNC'
              AND d.confirmation_mode='NONE' AND d.approval_policy_id IS NULL
              AND d.approval_policy_version IS NULL AND d.quota_policy='NONE'
              AND NEW.agent_installation_resource_id=i.resource_id AND r.type_key='agent.installation'
              AND NEW.native_seq IS NULL AND NEW.native_turn_id IS NULL
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
                AND e.event_type='ACCESS' AND e.event_key='memory-child:' || a.id::text || ':read' AND e.action_key=a.action_key
                AND e.tenant_id=a.tenant_id AND e.workspace_id=a.workspace_id AND e.target_id=i.resource_id
                AND e.actor_principal_id=a.actor_principal_id
                AND e.initiator_principal_id=a.initiator_principal_id
                AND e.parameter_hash=a.parameter_hash AND e.action_version=a.action_version
                AND e.decision='ALLOW'
                AND e.result_code=NEW.dimensions->>'read_outcome'
                AND e.result_code IN ('FOUND','ABSENT','COMPLETE')
                AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.dimensions->'native_event_ids') n(id)
                  WHERE n.id !~ '^[0-9a-f]{64}$' OR NOT EXISTS(
                    SELECT 1 FROM jsonb_array_elements(e.evidence_refs) evidence(value)
                    WHERE evidence.value->>'kind'='BUZZ_EVENT_ID' AND evidence.value->>'value'=n.id)));
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Memory child usage lacks exact Invocation/parent scope/native head/billing pin' USING ERRCODE='check_violation';
            END IF;
            RETURN NEW;
        END IF;
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
                    WHERE evidence.value->>'kind'='BUZZ_EVENT_ID' AND evidence.value->>'value'=n.id)));
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
                    WHERE evidence.value->>'kind'='BUZZ_EVENT_ID' AND evidence.value->>'value'=n.id)));
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
          AND o.version=NEW.binding_version AND NEW.subject_key=o.subject_key_prefix || i.installation_resource_id::text
          AND ((a.action_key='automation.run' AND a.target_id=i.automation_resource_id
                AND i.automation_resource_id IS NOT NULL
                AND i.automation_version_asset_id IS NOT NULL AND NEW.invocation_meter_projection IS NOT NULL
                AND ((jsonb_typeof(NEW.invocation_meter_projection)='object'
                  AND NEW.invocation_meter_projection->>'key'='automation.run') IS TRUE))
            OR (a.action_key='agent.invoke' AND a.target_id=i.installation_resource_id
                AND i.automation_resource_id IS NULL
                AND i.automation_version_asset_id IS NULL AND NEW.invocation_meter_projection IS NULL));
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

