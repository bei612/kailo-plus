-- 停止发布/回退边界：真实派发或已发生用量不能用回滚丢掉因果与结算引用。
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM outbox.usage_event) OR EXISTS (SELECT 1 FROM projection.agent_model_trace) THEN
        RAISE EXCEPTION '模型已派发或 usage 尚有事实；停止回滚并保留对账' USING ERRCODE='restrict_violation';
    END IF;
END $$;
DROP TABLE outbox.usage_event;
DROP TABLE projection.agent_model_trace;
DROP FUNCTION projection.guard_agent_model_usage();
