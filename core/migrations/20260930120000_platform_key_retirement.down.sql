-- 迁移补建、尚未进入退役的存量意图只是按当前 ref 登记的事实，可随回滚移除。
DELETE FROM admission.server_key_provision_intent
 WHERE origin = 'BACKFILLED' AND retire_operation_id IS NULL AND retired_at IS NULL;

-- 其余 CONTROL/OPERATOR 意图、已冻结退役或 RETIRED 的意图、撤销中的引用状态都已
-- 依赖新代码解释；旧约束无法表达它们。存在时拒绝回滚，而不是改写或丢弃这些事实。
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM admission.server_key_provision_intent
        WHERE key_kind <> 'HUMAN' OR origin <> 'PROVISIONED'
           OR retire_operation_id IS NOT NULL OR retired_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION '存在 CONTROL/OPERATOR、存量退役或 RETIRED 写入意图，禁止回滚此迁移';
    END IF;
    IF EXISTS (
        SELECT 1 FROM identity.buzz_identity_binding
        WHERE private_key_secret_status IN ('SUPERSEDED', 'REVOKED')
          AND state <> 'REVOKED'
    ) THEN
        RAISE EXCEPTION '存在撤销中的私钥引用状态，禁止回滚此迁移';
    END IF;
END $$;

ALTER TABLE identity.buzz_identity_binding
    DROP CONSTRAINT buzz_identity_secret_status_revoked,
    DROP CONSTRAINT buzz_identity_secret_status_present,
    DROP CONSTRAINT buzz_identity_secret_status_enum,
    DROP COLUMN private_key_secret_status;

DROP INDEX admission.server_key_provision_one_open_platform_key;
DROP INDEX admission.server_key_provision_one_open_human;
CREATE UNIQUE INDEX server_key_provision_one_open_principal
    ON admission.server_key_provision_intent (tenant_id, principal_id)
    WHERE finished_at IS NULL;

ALTER TABLE admission.server_key_provision_intent
    DROP CONSTRAINT server_key_provision_retire_operation_bound,
    DROP CONSTRAINT server_key_provision_retired_shape,
    DROP CONSTRAINT server_key_provision_commit_deadline,
    DROP CONSTRAINT server_key_provision_kind_shape,
    DROP CONSTRAINT server_key_provision_origin_shape,
    DROP CONSTRAINT server_key_provision_origin,
    DROP CONSTRAINT server_key_provision_key_kind,
    DROP CONSTRAINT server_key_provision_intent_action_key,
    DROP CONSTRAINT server_key_provision_intent_pkey,
    ALTER COLUMN principal_id SET NOT NULL,
    ALTER COLUMN action_execution_id SET NOT NULL,
    DROP COLUMN id,
    DROP COLUMN retired_at,
    DROP COLUMN retire_operation_id,
    DROP COLUMN commit_deadline_at,
    DROP COLUMN operation_id,
    DROP COLUMN origin,
    DROP COLUMN key_kind;
ALTER TABLE admission.server_key_provision_intent
    ADD CONSTRAINT server_key_provision_intent_pkey PRIMARY KEY (action_execution_id);
