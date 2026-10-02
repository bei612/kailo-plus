-- 同一 ActionExecution 已有多条意图（CONTROL 重试冻结的新 key）时，全表唯一无法表达
-- 这些事实。存在时拒绝回滚，而不是改写或丢弃它们。
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM admission.server_key_provision_intent
        WHERE action_execution_id IS NOT NULL
        GROUP BY action_execution_id HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION '同一 ActionExecution 已有多条 ServerKeyProvisionIntent，拒绝回滚';
    END IF;
END $$;
DROP INDEX admission.server_key_provision_intent_human_action;
ALTER TABLE admission.server_key_provision_intent
    ADD CONSTRAINT server_key_provision_intent_action_key UNIQUE (action_execution_id);
