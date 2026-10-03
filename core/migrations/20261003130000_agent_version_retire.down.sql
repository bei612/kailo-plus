-- 被真实执行引用后停止收缩；不删除 Audit/Usage/Version 来迎合回退。
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM admission.action_execution
        WHERE action_key='agent.version.retire' AND action_version=1) THEN
        RAISE EXCEPTION 'AgentVersion retire 已被 ActionExecution 引用，停止收缩'
            USING ERRCODE='restrict_violation';
    END IF;
END $$;
DELETE FROM catalog.action_definition WHERE action_key='agent.version.retire' AND version=1;
