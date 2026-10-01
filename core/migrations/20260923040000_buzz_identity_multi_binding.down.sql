-- 回到一人一钥之前，必须先确认不存在同一 Principal 的多条 binding：旧主键容不下
-- 它们，而自动删掉其中任何一条都等于替用户撤掉一台设备。宁可拒绝回退。
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM identity.buzz_identity_binding
        GROUP BY tenant_id, principal_id HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION '存在同一 Principal 的多条 BuzzIdentityBinding，不能回退到一人一钥';
    END IF;
END $$;

ALTER TABLE identity.buzz_identity_binding DROP CONSTRAINT client_custody_is_human;
DROP INDEX identity.buzz_identity_binding_by_principal;
DROP INDEX identity.buzz_identity_binding_one_server;
ALTER TABLE identity.buzz_identity_binding DROP CONSTRAINT buzz_identity_binding_pkey;
ALTER TABLE identity.buzz_identity_binding ADD CONSTRAINT buzz_identity_binding_pubkey_key UNIQUE (pubkey);
ALTER TABLE identity.buzz_identity_binding ADD PRIMARY KEY (tenant_id, principal_id);
