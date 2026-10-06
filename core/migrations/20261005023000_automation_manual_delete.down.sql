-- History cannot be deleted merely to revert the source contract.
DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM catalog.automation_definition WHERE state='DELETED')
        OR EXISTS(SELECT 1 FROM catalog.agent_session WHERE source_kind='MANUAL')
        OR EXISTS(SELECT 1 FROM catalog.agent_invocation WHERE source_kind='MANUAL')
        OR EXISTS(SELECT 1 FROM admission.action_execution WHERE action_key='automation.delete'
            OR (action_key='automation.run' AND parameters->>'sourceKind'='MANUAL')) THEN
        RAISE EXCEPTION 'Manual/delete history exists; refusing destructive rollback' USING ERRCODE='restrict_violation';
    END IF;
END $$;
DROP TRIGGER automation_manual_source ON admission.action_execution;
DROP FUNCTION admission.guard_automation_manual_source();
DROP TRIGGER automation_definition_tombstone ON catalog.automation_definition;
DROP FUNCTION catalog.guard_automation_tombstone();
DELETE FROM catalog.action_definition WHERE action_key='automation.delete' AND version=1;
ALTER TABLE catalog.automation_definition DROP CONSTRAINT automation_definition_state_check;
ALTER TABLE catalog.automation_definition ADD CONSTRAINT automation_definition_state_check
    CHECK(state IN ('DRAFT','ENABLED','PAUSED','DISABLED'));
ALTER TABLE catalog.agent_session DROP CONSTRAINT agent_session_source;
ALTER TABLE catalog.agent_invocation DROP CONSTRAINT agent_invocation_source;
ALTER TABLE catalog.agent_session ADD CONSTRAINT agent_session_source CHECK (
    (source_kind='BUZZ_EVENT' AND root_event_id ~ '^[0-9a-f]{64}$')
    OR (source_kind='SCHEDULE' AND root_event_id LIKE 'schedule:platform:automation_schedule:%'));
ALTER TABLE catalog.agent_invocation ADD CONSTRAINT agent_invocation_source CHECK (
    (source_kind='BUZZ_EVENT' AND source_event_id ~ '^[0-9a-f]{64}$' AND schedule_id IS NULL AND scheduled_at IS NULL)
    OR (source_kind='SCHEDULE' AND schedule_id IS NOT NULL AND scheduled_at IS NOT NULL
        AND automation_resource_id IS NOT NULL AND automation_version_asset_id IS NOT NULL
        AND source_event_id=to_char(scheduled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
        AND date_trunc('second',scheduled_at)=scheduled_at
        AND root_event_id='schedule:'||schedule_id||':'||source_event_id));
CREATE OR REPLACE FUNCTION catalog.guard_agent_schedule_source() RETURNS trigger AS $$
BEGIN
    IF TG_OP='UPDATE' AND (NEW.source_kind IS DISTINCT FROM OLD.source_kind
        OR (TG_TABLE_NAME='agent_invocation' AND (to_jsonb(NEW)->'schedule_id' IS DISTINCT FROM to_jsonb(OLD)->'schedule_id'
            OR to_jsonb(NEW)->'scheduled_at' IS DISTINCT FROM to_jsonb(OLD)->'scheduled_at'))) THEN
        RAISE EXCEPTION 'Agent native source 已冻结' USING ERRCODE='check_violation';
    END IF;
    IF TG_TABLE_NAME='agent_invocation' THEN
        PERFORM 1 FROM catalog.agent_session s
          JOIN admission.action_execution ae ON ae.id=NEW.action_execution_id
          LEFT JOIN catalog.automation_version av ON av.asset_id=NEW.automation_version_asset_id
            AND av.automation_resource_id=NEW.automation_resource_id
        WHERE s.workspace_id=NEW.workspace_id AND s.root_event_id=NEW.root_event_id
          AND s.installation_resource_id=NEW.installation_resource_id AND s.source_kind=NEW.source_kind
          AND (NEW.source_kind='BUZZ_EVENT' OR
            (ae.action_key='automation.run' AND ae.parameters->>'sourceKind'='SCHEDULE'
              AND ae.parameters->>'scheduleId'=NEW.schedule_id
              AND ae.parameters->>'scheduledAt'=NEW.source_event_id
              AND ae.parameters->>'rootEventId'=NEW.root_event_id
              AND av.trigger->>'kind'='SCHEDULE' AND av.result_target='CHANNEL'
              AND NEW.workflow_id='platform:automation_run:'||NEW.tenant_id::text||':'||NEW.automation_resource_id::text||'-'||NEW.source_event_id));
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Agent Schedule source 不属于确切 native Workflow/AE/Version/Session' USING ERRCODE='check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
