-- Stop conditions: rollback aborts while any reaction target is frozen, or (via the
-- restored constraints) while any DIFF_POSTED/REACTION_ADDED version exists. Such
-- rows are never rewritten or deleted here.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM catalog.agent_invocation WHERE trigger_target_event_id IS NOT NULL) THEN
        RAISE EXCEPTION 'reaction trigger targets exist; rollback refused' USING ERRCODE='check_violation';
    END IF;
END $$;
ALTER TABLE catalog.automation_version DROP CONSTRAINT automation_version_trigger_check;
ALTER TABLE catalog.automation_version ADD CONSTRAINT automation_version_trigger_check CHECK((jsonb_typeof(trigger)='object'
    AND trigger->>'kind' IN ('CHANNEL_MESSAGE','MENTION','SCHEDULE','WEBHOOK')) IS TRUE);
ALTER TABLE catalog.automation_version DROP CONSTRAINT automation_version_action_check;
ALTER TABLE catalog.automation_version ADD CONSTRAINT automation_version_action_check CHECK ((
 jsonb_typeof(action)='object' AND (
  (action->>'kind' IN ('AGENT_TURN','POST_MESSAGE','POST_MESSAGE_STEPS')
   AND jsonb_typeof(action->'template')='string' AND length(action->>'template')>0)
  OR (action->>'kind'='ADD_REACTION_STEPS' AND jsonb_typeof(action->'emoji')='string'
   AND length(action->>'emoji')>0 AND trigger->>'kind' IN ('CHANNEL_MESSAGE','MENTION'))
  OR (action->>'kind'='SET_CHANNEL_TOPIC_STEPS' AND jsonb_typeof(action->'topic')='string'))
 AND (action->>'kind' NOT IN ('POST_MESSAGE_STEPS','ADD_REACTION_STEPS','SET_CHANNEL_TOPIC_STEPS') OR (
  (action->'stepsVersion'='2'::jsonb OR (action->>'kind'='POST_MESSAGE_STEPS' AND action->'stepsVersion'='3'::jsonb))
  AND jsonb_typeof(action->'steps')='array' AND jsonb_array_length(action->'steps')>0))) IS TRUE);
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
              AND av.trigger->>'kind' IN ('CHANNEL_MESSAGE','MENTION','SCHEDULE')
              AND av.result_target=CASE WHEN av.trigger->>'kind'='SCHEDULE' THEN 'CHANNEL' ELSE 'TRIGGER_THREAD' END
              AND NEW.workflow_id='platform:automation_run:'||NEW.tenant_id::text||':'||NEW.automation_resource_id::text||'-'||NEW.source_event_id));
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Agent source must belong to the exact Workflow/AE/Version/Session' USING ERRCODE='check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER TABLE catalog.agent_invocation DROP COLUMN trigger_target_event_id;
