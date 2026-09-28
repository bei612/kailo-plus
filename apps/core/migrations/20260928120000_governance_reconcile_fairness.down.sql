-- 此字段仅影响对账轮转顺序，旧版本忽略它；回滚不得改变业务状态。
ALTER TABLE admission.server_key_provision_intent
    DROP COLUMN reconcile_last_attempt_at;
ALTER TABLE admission.action_execution
    DROP COLUMN reconcile_last_attempt_at;
