-- 对账调度元数据不改变门禁、派发或密钥写入事实；失败记录须让出批次。
ALTER TABLE admission.action_execution
    ADD COLUMN reconcile_last_attempt_at timestamptz;
ALTER TABLE admission.server_key_provision_intent
    ADD COLUMN reconcile_last_attempt_at timestamptz;
