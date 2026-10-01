-- 已有写入意图时无法证明对应 KV 版本是否仍需对账，必须停止回滚。
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM admission.server_key_provision_intent) THEN
        RAISE EXCEPTION '已有 SERVER HUMAN 私钥写入意图，不能回滚此迁移';
    END IF;
END $$;
DROP TABLE admission.server_key_provision_intent;
