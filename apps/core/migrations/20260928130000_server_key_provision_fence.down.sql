-- FENCED/DESTROYED 行已依赖新代码解释，不允许回滚到会忽略 fence 的旧版本。
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM admission.server_key_provision_intent
        WHERE fenced_at IS NOT NULL OR destroyed_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION '存在 SERVER HUMAN 封堵或销毁意图，禁止回滚此迁移';
    END IF;
END $$;

ALTER TABLE admission.server_key_provision_intent
    DROP CONSTRAINT server_key_provision_terminal_shape,
    DROP COLUMN destroyed_at,
    DROP COLUMN fenced_at;
