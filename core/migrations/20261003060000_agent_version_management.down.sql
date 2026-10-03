-- 不删除真实 Version/Asset 或历史 AE 来强行移除其目录合同。
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM admission.action_execution
        WHERE action_key IN ('agent.version.create','agent.version.update','agent.version.publish')
          AND action_version=1
    ) THEN
        RAISE EXCEPTION 'AgentVersion 管理合同已被真实 ActionExecution 引用，停止收缩'
            USING ERRCODE='restrict_violation';
    END IF;
END $$;
DELETE FROM catalog.action_definition
WHERE action_key IN ('agent.version.create','agent.version.update','agent.version.publish')
  AND version=1;
