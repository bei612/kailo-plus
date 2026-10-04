-- 任一原生 Schedule 或 Schedule 来源 history 存在时停止回退，绝不丢弃对账责任。
DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM catalog.automation_definition WHERE schedule_id IS NOT NULL)
        OR EXISTS(SELECT 1 FROM catalog.agent_session WHERE source_kind='SCHEDULE')
        OR EXISTS(SELECT 1 FROM catalog.agent_invocation WHERE source_kind='SCHEDULE')
        OR EXISTS(SELECT 1 FROM admission.action_execution WHERE parameters ? 'scheduleIntent') THEN
        RAISE EXCEPTION 'Schedule native refs/history 尚存，不能回退来源合同' USING ERRCODE='restrict_violation';
    END IF;
END $$;
DROP TRIGGER agent_invocation_schedule_source ON catalog.agent_invocation;
DROP TRIGGER agent_session_schedule_source ON catalog.agent_session;
DROP FUNCTION catalog.guard_agent_schedule_source();
ALTER TABLE catalog.agent_session DROP CONSTRAINT agent_session_source;
ALTER TABLE catalog.agent_invocation DROP CONSTRAINT agent_invocation_source;
ALTER TABLE catalog.agent_session ADD CHECK(root_event_id ~ '^[0-9a-f]{64}$');
ALTER TABLE catalog.agent_invocation ADD CHECK(source_event_id ~ '^[0-9a-f]{64}$');
ALTER TABLE catalog.agent_invocation DROP COLUMN scheduled_at, DROP COLUMN schedule_id, DROP COLUMN source_kind;
ALTER TABLE catalog.agent_session DROP COLUMN source_kind;
