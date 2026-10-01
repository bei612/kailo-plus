-- SecretRef 是三元组：locator + KV v2 版本号 + audience（.design/03 §9）。
-- Stage 1 的 identity 迁移只落了 locator 一列，取用时缺版本就只能取 latest，
-- 缺 audience 就没法校验「这把 secret 是不是给本服务用的」——两者都是 DD-70
-- 明写的边界。迁移只能追加，因此在此补列而不是改那份迁移。
--
-- 三列同生共死：custody=SERVER 时三列俱全，custody=CLIENT 时三列全空。
-- 原有的 custody_matches_secret_ref 只管 locator，这里把另外两列并进同一条件。
ALTER TABLE identity.buzz_identity_binding
    ADD COLUMN private_key_secret_version  integer,
    ADD COLUMN private_key_secret_audience text,
    ADD CONSTRAINT custody_matches_secret_triple CHECK (
        (custody = 'SERVER'
            AND private_key_secret_ref IS NOT NULL
            AND private_key_secret_version IS NOT NULL
            AND private_key_secret_audience IS NOT NULL)
        OR
        (custody = 'CLIENT'
            AND private_key_secret_ref IS NULL
            AND private_key_secret_version IS NULL
            AND private_key_secret_audience IS NULL)
    );
