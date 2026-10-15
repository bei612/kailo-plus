-- DD-116 (DD-107, 06 §9): the WEBHOOK trigger. A verified delivery is recorded
-- once per automation; its untrusted JSON body is only the trigger context of
-- that run. The run's source is the recorded delivery, never a Relay event.
-- 05 §2.9: the registered rotation of the WEBHOOK key, same management shape.
INSERT INTO catalog.action_definition
    (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
     permission,permission_object_type,execution_mode,confirmation_mode,
     capacity_policy,quota_policy,meters,result_exposure,audit_policy,
     obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,
     obs_cost_source,obs_redaction_policy,status)
VALUES ('automation.rotate_webhook_secret',1,'core','RESOURCE','SESSION_TENANT','TARGET_HOME_WORKSPACE',
        'manage','resource','SYNC','EXPLICIT','NONE','NONE','{}','NONE','FULL_LIFECYCLE',
        'OPERATION_REF','NONE','SYNC_RESULT','NONE','NONE','PLATFORM_METADATA_ONLY','ACTIVE')
ON CONFLICT DO NOTHING;

ALTER TABLE catalog.automation_definition ADD COLUMN webhook_secret_hint text;
ALTER TABLE catalog.automation_definition ADD CONSTRAINT automation_definition_webhook_hint CHECK (
 webhook_secret_hint IS NULL OR (webhook_secret_ref IS NOT NULL AND webhook_secret_hint ~ '^[A-Za-z0-9+/=]{4}$'));

CREATE TABLE catalog.automation_webhook_delivery (
 tenant_id uuid NOT NULL REFERENCES identity.tenant(id),
 automation_resource_id uuid NOT NULL REFERENCES catalog.resource(id),
 delivery_id text NOT NULL CHECK (length(delivery_id) BETWEEN 1 AND 256 AND delivery_id ~ '^[!-~]+$'),
 signed_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 payload jsonb,
 payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
 PRIMARY KEY (automation_resource_id, delivery_id)
);

CREATE FUNCTION catalog.guard_automation_webhook_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'A webhook delivery is run history' USING ERRCODE='check_violation';
 END IF;
 IF TG_OP='INSERT' THEN
  PERFORM 1 FROM catalog.resource r JOIN catalog.automation_definition d ON d.resource_id=r.id
  WHERE r.id=NEW.automation_resource_id AND r.tenant_id=NEW.tenant_id AND r.type_key='automation';
  IF NOT FOUND THEN
   RAISE EXCEPTION 'A webhook delivery belongs to an automation of its Tenant' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
 END IF;
 -- Only the untrusted body may be erased (Tenant deletion); nothing else changes.
 IF (to_jsonb(NEW)-'payload') IS DISTINCT FROM (to_jsonb(OLD)-'payload')
  OR (NEW.payload IS DISTINCT FROM OLD.payload AND NEW.payload IS NOT NULL) THEN
  RAISE EXCEPTION 'A webhook delivery is immutable' USING ERRCODE='check_violation';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER automation_webhook_delivery_guard BEFORE INSERT OR UPDATE OR DELETE
 ON catalog.automation_webhook_delivery FOR EACH ROW EXECUTE FUNCTION catalog.guard_automation_webhook_delivery();

CREATE FUNCTION admission.guard_automation_webhook_source() RETURNS trigger AS $$
BEGIN
    IF OLD.action_key='automation.run' AND OLD.parameters->>'sourceKind'='WEBHOOK' AND (
        NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
        OR NEW.parameters->'webhookDeliveryId' IS DISTINCT FROM OLD.parameters->'webhookDeliveryId'
        OR NEW.parameters->'sourceKind' IS DISTINCT FROM OLD.parameters->'sourceKind'
        OR NEW.parameters->'sourcePrincipalId' IS DISTINCT FROM OLD.parameters->'sourcePrincipalId'
        OR NEW.parameters->'sourceEventId' IS DISTINCT FROM OLD.parameters->'sourceEventId'
        OR NEW.parameters->'rootEventId' IS DISTINCT FROM OLD.parameters->'rootEventId'
        OR NEW.parameters ? 'sourcePubkey') THEN
        RAISE EXCEPTION 'Webhook Automation source is immutable' USING ERRCODE='check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER automation_webhook_source_guard BEFORE UPDATE ON admission.action_execution
    FOR EACH ROW EXECUTE FUNCTION admission.guard_automation_webhook_source();

ALTER TABLE catalog.agent_session DROP CONSTRAINT agent_session_source;
ALTER TABLE catalog.agent_invocation DROP CONSTRAINT agent_invocation_source;
ALTER TABLE catalog.agent_session ADD CONSTRAINT agent_session_source CHECK (
    (source_kind='BUZZ_EVENT' AND root_event_id ~ '^[0-9a-f]{64}$')
    OR (source_kind='SCHEDULE' AND root_event_id LIKE 'schedule:platform:automation_schedule:%')
    OR (source_kind='MANUAL' AND root_event_id ~ '^manual:[0-9a-f-]{36}:[0-9a-f-]{36}:[0-9a-f-]{36}$')
    OR (source_kind='WEBHOOK' AND root_event_id ~ '^webhook:[0-9a-f-]{36}:[0-9a-f-]{36}$'));
ALTER TABLE catalog.agent_invocation ADD CONSTRAINT agent_invocation_source CHECK (
    (source_kind='BUZZ_EVENT' AND source_event_id ~ '^[0-9a-f]{64}$' AND schedule_id IS NULL AND scheduled_at IS NULL)
    OR (source_kind='SCHEDULE' AND schedule_id IS NOT NULL AND scheduled_at IS NOT NULL
        AND automation_resource_id IS NOT NULL AND automation_version_asset_id IS NOT NULL
        AND source_event_id=to_char(scheduled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
        AND date_trunc('second',scheduled_at)=scheduled_at
        AND root_event_id='schedule:'||schedule_id||':'||source_event_id)
    OR (source_kind='MANUAL' AND schedule_id IS NULL AND scheduled_at IS NULL
        AND automation_resource_id IS NOT NULL AND automation_version_asset_id IS NOT NULL
        AND root_event_id=source_event_id
        AND source_event_id ~ '^manual:[0-9a-f-]{36}:[0-9a-f-]{36}:[0-9a-f-]{36}$')
    OR (source_kind='WEBHOOK' AND schedule_id IS NULL AND scheduled_at IS NULL
        AND automation_resource_id IS NOT NULL AND automation_version_asset_id IS NOT NULL
        AND root_event_id=source_event_id
        AND source_event_id ~ '^webhook:[0-9a-f-]{36}:[0-9a-f-]{36}$'));

CREATE OR REPLACE FUNCTION catalog.guard_agent_schedule_source() RETURNS trigger AS $$
BEGIN
    IF TG_OP='UPDATE' AND (NEW.source_kind IS DISTINCT FROM OLD.source_kind
        OR (TG_TABLE_NAME='agent_invocation' AND (to_jsonb(NEW)->'schedule_id' IS DISTINCT FROM to_jsonb(OLD)->'schedule_id'
            OR to_jsonb(NEW)->'scheduled_at' IS DISTINCT FROM to_jsonb(OLD)->'scheduled_at'
            OR to_jsonb(NEW)->'trigger_target_event_id' IS DISTINCT FROM to_jsonb(OLD)->'trigger_target_event_id'))) THEN
        RAISE EXCEPTION 'Agent native source 已冻结' USING ERRCODE='check_violation';
    END IF;
    IF TG_TABLE_NAME='agent_invocation' THEN
        PERFORM 1 FROM catalog.agent_session s
          JOIN admission.action_execution ae ON ae.id=NEW.action_execution_id
          LEFT JOIN catalog.automation_version av ON av.asset_id=NEW.automation_version_asset_id
            AND av.automation_resource_id=NEW.automation_resource_id
        WHERE s.workspace_id=NEW.workspace_id AND s.root_event_id=NEW.root_event_id
          AND s.installation_resource_id=NEW.installation_resource_id AND s.source_kind=NEW.source_kind
          AND s.projection_generation=NEW.projection_generation AND s.agent_version_asset_id=NEW.agent_version_asset_id
          AND (NEW.source_kind='BUZZ_EVENT' OR
            (NEW.source_kind='SCHEDULE' AND ae.action_key='automation.run' AND ae.parameters->>'sourceKind'='SCHEDULE'
              AND ae.parameters->>'scheduleId'=NEW.schedule_id
              AND ae.parameters->>'scheduledAt'=NEW.source_event_id
              AND ae.parameters->>'rootEventId'=NEW.root_event_id
              AND av.trigger->>'kind'='SCHEDULE' AND av.result_target='CHANNEL'
              AND NEW.workflow_id='platform:automation_run:'||NEW.tenant_id::text||':'||NEW.automation_resource_id::text||'-'||NEW.source_event_id)
            OR (NEW.source_kind='MANUAL' AND ae.action_key='automation.run'
              AND ae.tenant_id=NEW.tenant_id AND ae.workspace_id=NEW.workspace_id AND ae.target_id=NEW.automation_resource_id
              AND ae.parent_action_execution_id IS NULL AND ae.parameters->>'sourceKind'='MANUAL'
              AND ae.parameters->>'sourcePrincipalId'=ae.initiator_principal_id::text
              AND NOT ae.parameters ? 'sourcePubkey'
              AND ae.parameters->>'sourceEventId'=NEW.source_event_id AND ae.parameters->>'rootEventId'=NEW.root_event_id
              AND NEW.source_event_id='manual:'||ae.initiator_principal_id::text||':'||ae.target_id::text||':'||ae.idempotency_key::text
              AND ae.parameters#>>'{manualRequest,idempotencyKey}'=ae.idempotency_key::text
              AND ae.parameters#>>'{manualRequest,resourceId}'=ae.target_id::text
              AND ae.parameters#>>'{manualRequest,workspaceId}'=ae.workspace_id::text
              AND ae.parameters#>>'{manualRequest,resourceVersion}'=ae.parameters->>'targetVersion'
              AND ae.parameters#>'{manualRequest,explicitConfirmation}'='true'::jsonb
              AND av.trigger->>'kind' IN ('CHANNEL_MESSAGE','MENTION','SCHEDULE','DIFF_POSTED','REACTION_ADDED','WEBHOOK')
              AND av.result_target=CASE WHEN av.trigger->>'kind' IN ('SCHEDULE','WEBHOOK') THEN 'CHANNEL' ELSE 'TRIGGER_THREAD' END
              AND NEW.workflow_id='platform:automation_run:'||NEW.tenant_id::text||':'||NEW.automation_resource_id::text||'-'||NEW.source_event_id)
            -- DD-116: a verified, recorded webhook delivery of this exact automation.
            OR (NEW.source_kind='WEBHOOK' AND ae.action_key='automation.run'
              AND ae.tenant_id=NEW.tenant_id AND ae.workspace_id=NEW.workspace_id AND ae.target_id=NEW.automation_resource_id
              AND ae.parent_action_execution_id IS NULL AND ae.parameters->>'sourceKind'='WEBHOOK'
              AND ae.parameters->>'sourcePrincipalId'=ae.initiator_principal_id::text
              AND NOT ae.parameters ? 'sourcePubkey'
              AND ae.parameters->>'sourceEventId'=NEW.source_event_id AND ae.parameters->>'rootEventId'=NEW.root_event_id
              AND NEW.source_event_id='webhook:'||ae.target_id::text||':'||ae.idempotency_key::text
              AND EXISTS(SELECT 1 FROM catalog.automation_webhook_delivery d WHERE d.tenant_id=ae.tenant_id
                AND d.automation_resource_id=ae.target_id AND d.delivery_id=ae.parameters->>'webhookDeliveryId')
              AND av.trigger->>'kind'='WEBHOOK' AND av.result_target='CHANNEL'
              AND NEW.workflow_id='platform:automation_run:'||NEW.tenant_id::text||':'||NEW.automation_resource_id::text||'-'||NEW.source_event_id));
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Agent source must belong to the exact Workflow/AE/Version/Session' USING ERRCODE='check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

