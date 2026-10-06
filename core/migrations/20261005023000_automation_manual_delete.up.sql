-- DD-107 / 06 §9.1: one authenticated owner run and irreversible Definition
-- tombstones, using the existing AE, AgentTaskWorkflow and Resource authority.
DO $$ DECLARE name text; BEGIN
    SELECT c.conname INTO STRICT name FROM pg_constraint c
    WHERE c.conrelid='catalog.automation_definition'::regclass AND c.contype='c'
      AND (SELECT array_agg(a.attname::text ORDER BY k.ordinality)
           FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
           JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum)=ARRAY['state'];
    EXECUTE format('ALTER TABLE catalog.automation_definition DROP CONSTRAINT %I',name);
END $$;
ALTER TABLE catalog.automation_definition ADD CONSTRAINT automation_definition_state_check
    CHECK(state IN ('DRAFT','ENABLED','PAUSED','DISABLED','DELETED'));

INSERT INTO catalog.action_definition
    (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
     permission,permission_object_type,execution_mode,confirmation_mode,
     capacity_policy,quota_policy,meters,result_exposure,audit_policy,
     obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,
     obs_cost_source,obs_redaction_policy,status)
VALUES ('automation.delete',1,'core','RESOURCE','SESSION_TENANT','TARGET_HOME_WORKSPACE',
        'manage','resource','SYNC','EXPLICIT','NONE','NONE','{}','NONE','FULL_LIFECYCLE',
        'OPERATION_REF','NONE','SYNC_RESULT','NONE','NONE','PLATFORM_METADATA_ONLY','ACTIVE');

CREATE FUNCTION catalog.guard_automation_tombstone() RETURNS trigger AS $$
BEGIN
    IF TG_OP<>'INSERT' AND OLD.state='DELETED' THEN
        RAISE EXCEPTION 'Deleted AutomationDefinition is immutable history' USING ERRCODE='restrict_violation';
    END IF;
    IF TG_OP<>'DELETE' AND NEW.state='DELETED' THEN
        IF TG_OP='INSERT' OR OLD.state<>'DISABLED'
            OR NEW.schedule_id IS NOT NULL OR NEW.webhook_secret_ref IS NOT NULL THEN
            RAISE EXCEPTION 'Automation deletion requires confirmed trigger/secret retirement' USING ERRCODE='check_violation';
        END IF;
        PERFORM 1 FROM catalog.resource r JOIN admission.action_execution ae
          ON ae.tenant_id=r.tenant_id AND ae.workspace_id=NEW.workspace_id AND ae.target_id=r.id
          JOIN identity.principal p ON p.id=ae.initiator_principal_id AND p.tenant_id=r.tenant_id AND p.kind='HUMAN'
        WHERE r.id=NEW.resource_id AND ae.action_key='automation.delete' AND ae.action_version=1
          AND ae.parent_action_execution_id IS NULL AND ae.initiator_principal_id=ae.actor_principal_id
          -- Original SYNC admission marks local completion before prewrite;
          -- native-intent recovery instead remains NOT_DISPATCHED/UNKNOWN.
          AND ae.gate_state='ALLOWED' AND ae.dispatch_state IN ('NOT_DISPATCHED','UNKNOWN','DISPATCHED')
          AND (r.projection_action_execution_id IS NULL OR r.projection_action_execution_id=ae.id)
          AND r.version=(ae.parameters->>'targetVersion')::integer+1;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Automation tombstone needs the original admitted delete AE' USING ERRCODE='check_violation';
        END IF;
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER automation_definition_tombstone BEFORE INSERT OR UPDATE OR DELETE
    ON catalog.automation_definition FOR EACH ROW EXECUTE FUNCTION catalog.guard_automation_tombstone();

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

CREATE FUNCTION admission.guard_automation_manual_source() RETURNS trigger AS $$
BEGIN
    IF OLD.action_key='automation.run' AND OLD.parameters->>'sourceKind'='MANUAL' AND (
        NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
        OR NEW.parameters->'manualRequest' IS DISTINCT FROM OLD.parameters->'manualRequest'
        OR NEW.parameters->'sourceKind' IS DISTINCT FROM OLD.parameters->'sourceKind'
        OR NEW.parameters->'sourcePrincipalId' IS DISTINCT FROM OLD.parameters->'sourcePrincipalId'
        OR NEW.parameters->'sourceEventId' IS DISTINCT FROM OLD.parameters->'sourceEventId'
        OR NEW.parameters->'rootEventId' IS DISTINCT FROM OLD.parameters->'rootEventId'
        OR NEW.parameters ? 'sourcePubkey') THEN
        RAISE EXCEPTION 'Manual Automation source is immutable' USING ERRCODE='check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER automation_manual_source BEFORE UPDATE ON admission.action_execution
    FOR EACH ROW EXECUTE FUNCTION admission.guard_automation_manual_source();
