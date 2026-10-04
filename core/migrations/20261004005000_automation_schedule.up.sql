-- DD-107 / 06 §3.1 的 additive 来源变体；在线 60 的旧 BUZZ_EVENT 写入保持原约束。
ALTER TABLE catalog.agent_session ADD COLUMN source_kind text NOT NULL DEFAULT 'BUZZ_EVENT';
ALTER TABLE catalog.agent_invocation ADD COLUMN source_kind text NOT NULL DEFAULT 'BUZZ_EVENT';
ALTER TABLE catalog.agent_invocation ADD COLUMN schedule_id text;
ALTER TABLE catalog.agent_invocation ADD COLUMN scheduled_at timestamptz;
ALTER TABLE catalog.agent_session DROP CONSTRAINT agent_session_root_event_id_check;
ALTER TABLE catalog.agent_invocation DROP CONSTRAINT agent_invocation_source_event_id_check;
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
-- 20261002230000 已按普通/Automation 分离两个真实来源唯一索引。
-- Schedule nominal time 沿同 Automation 唯一索引去重，不改其业务边界。
CREATE FUNCTION catalog.guard_agent_schedule_source() RETURNS trigger AS $$
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
CREATE TRIGGER agent_session_schedule_source BEFORE INSERT OR UPDATE ON catalog.agent_session
    FOR EACH ROW EXECUTE FUNCTION catalog.guard_agent_schedule_source();
CREATE TRIGGER agent_invocation_schedule_source BEFORE INSERT OR UPDATE ON catalog.agent_invocation
    FOR EACH ROW EXECUTE FUNCTION catalog.guard_agent_schedule_source();
