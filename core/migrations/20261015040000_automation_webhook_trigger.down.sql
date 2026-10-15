-- Webhook deliveries and WEBHOOK runs are history: stop instead of discarding them.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM catalog.automation_webhook_delivery)
  OR EXISTS(SELECT 1 FROM catalog.agent_session WHERE source_kind='WEBHOOK')
  OR EXISTS(SELECT 1 FROM catalog.agent_invocation WHERE source_kind='WEBHOOK')
  OR EXISTS(SELECT 1 FROM catalog.automation_definition WHERE webhook_secret_hint IS NOT NULL)
  OR EXISTS(SELECT 1 FROM admission.action_execution WHERE action_key='automation.rotate_webhook_secret') THEN
  RAISE EXCEPTION 'Webhook deliveries, runs or key hints prevent downgrade' USING ERRCODE='check_violation';
 END IF;
END $$;

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
              AND av.trigger->>'kind' IN ('CHANNEL_MESSAGE','MENTION','SCHEDULE','DIFF_POSTED','REACTION_ADDED')
              AND av.result_target=CASE WHEN av.trigger->>'kind'='SCHEDULE' THEN 'CHANNEL' ELSE 'TRIGGER_THREAD' END
              AND NEW.workflow_id='platform:automation_run:'||NEW.tenant_id::text||':'||NEW.automation_resource_id::text||'-'||NEW.source_event_id));
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Agent source must belong to the exact Workflow/AE/Version/Session' USING ERRCODE='check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


ALTER TABLE catalog.agent_session DROP CONSTRAINT agent_session_source;
ALTER TABLE catalog.agent_invocation DROP CONSTRAINT agent_invocation_source;
ALTER TABLE catalog.agent_session ADD CONSTRAINT agent_session_source CHECK (
    (source_kind='BUZZ_EVENT' AND root_event_id ~ '^[0-9a-f]{64}$')
    OR (source_kind='SCHEDULE' AND root_event_id LIKE 'schedule:platform:automation_schedule:%')
    OR (source_kind='MANUAL' AND root_event_id ~ '^manual:[0-9a-f-]{36}:[0-9a-f-]{36}:[0-9a-f-]{36}$'));
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
        AND source_event_id ~ '^manual:[0-9a-f-]{36}:[0-9a-f-]{36}:[0-9a-f-]{36}$'));

DROP TRIGGER automation_webhook_source_guard ON admission.action_execution;
DROP FUNCTION admission.guard_automation_webhook_source();
DROP TRIGGER automation_webhook_delivery_guard ON catalog.automation_webhook_delivery;
DROP FUNCTION catalog.guard_automation_webhook_delivery();
DROP TABLE catalog.automation_webhook_delivery;
ALTER TABLE catalog.automation_definition DROP CONSTRAINT automation_definition_webhook_hint;
ALTER TABLE catalog.automation_definition DROP COLUMN webhook_secret_hint;
DELETE FROM catalog.action_definition WHERE action_key='automation.rotate_webhook_secret' AND version=1;
