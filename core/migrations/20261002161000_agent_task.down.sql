-- 回滚前先关闭入口、停止 AgentTaskWorkflow 与 Supervisor，并确认没有非终态引用。
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM catalog.agent_invocation WHERE status NOT IN ('COMPLETED','FAILED','CANCELED'))
       OR EXISTS (SELECT 1 FROM catalog.agent_session WHERE status <> 'CLOSED') THEN
        RAISE EXCEPTION 'Agent task 仍有活跃或 UNKNOWN 引用，停止回滚';
    END IF;
END $$;
DROP TABLE catalog.agent_invocation;
DROP TABLE catalog.agent_session;
DROP FUNCTION catalog.guard_agent_task_scope();
