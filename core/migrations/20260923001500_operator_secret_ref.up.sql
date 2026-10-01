-- RelayOperatorIdentity 的 SecretRef 同样是三元组（.design/03 §9）：locator 之外
-- 还要版本与 audience。缺版本只能取 latest，一次无关的轮换就会改变已 active 的
-- binding 行为；缺 audience 就没法校验这把 secret 是不是给本服务用的。
--
-- 注意与已有的 audience 列区分：那一列是 operator API 的 audience（签名目标
-- 所服务的部署），这一列是允许取用该 secret 的 service identity。两者同名不同义，
-- 合并会让「谁能取这把钥匙」被「这把钥匙服务谁」悄悄覆盖。
ALTER TABLE identity.relay_operator_identity
    ADD COLUMN private_key_secret_version  integer,
    ADD COLUMN private_key_secret_audience text,
    ADD CONSTRAINT active_requires_secret_triple CHECK (
        state <> 'ACTIVE'
        OR (private_key_secret_version IS NOT NULL AND private_key_secret_audience IS NOT NULL)
    );
