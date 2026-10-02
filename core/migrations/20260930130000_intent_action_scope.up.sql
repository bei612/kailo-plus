-- ServerKeyProvisionIntent 的 action_execution_id 只对 HUMAN 唯一（.design/03、DD-113 (2)）。
-- HUMAN 的 locator 由原 ActionExecution 派生，同一动作的重试续用同一意图；CONTROL 同一
-- operation 的重试在 fence 并销毁不可续用的写入后，为同一 ActionExecution 冻结新 key 的
-- 新意图。全表唯一会让这一步永远撞约束，Tenant 的 CONTROL 身份停在 503。
ALTER TABLE admission.server_key_provision_intent
    DROP CONSTRAINT server_key_provision_intent_action_key;
CREATE UNIQUE INDEX server_key_provision_intent_human_action
    ON admission.server_key_provision_intent (action_execution_id)
    WHERE key_kind = 'HUMAN';
