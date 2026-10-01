-- 一人多绑定（DD-77）：BuzzIdentityBinding 以 pubkey 为身份。
--
-- 原主键 (tenant_id, principal_id) 只容一把 pubkey，同一个人不能既用 Web（Core
-- 托管，SERVER）又用原生端（本机持钥，CLIENT）。改为 pubkey 主键之后：
--   * 每个 Principal 至多一条非 REVOKED 的 SERVER binding——Core 代签只能有一个
--     确定的身份，两把托管私钥会让「以谁的名义签」变成需要选择的事；
--   * CLIENT binding 只属于 HUMAN：AGENT 与 CONTROL 的私钥由 Core 托管（DD-72）。
-- 设备数的上界是部署登记值，在登记入口处执行，不写进约束。
--
-- 既有数据每个 Principal 至多一行，满足新约束，无需搬迁。

ALTER TABLE identity.buzz_identity_binding DROP CONSTRAINT buzz_identity_binding_pkey;
ALTER TABLE identity.buzz_identity_binding DROP CONSTRAINT buzz_identity_binding_pubkey_key;
ALTER TABLE identity.buzz_identity_binding ADD PRIMARY KEY (pubkey);

CREATE UNIQUE INDEX buzz_identity_binding_one_server
    ON identity.buzz_identity_binding (tenant_id, principal_id)
    WHERE custody = 'SERVER' AND state <> 'REVOKED';

-- 投影与撤权按 Principal 取全部 pubkey
CREATE INDEX buzz_identity_binding_by_principal
    ON identity.buzz_identity_binding (tenant_id, principal_id);

ALTER TABLE identity.buzz_identity_binding
    ADD CONSTRAINT client_custody_is_human CHECK (custody = 'SERVER' OR kind = 'HUMAN');
