-- TenantBuzzBinding 的 Relay 签名身份（DD-114(1)、.design/03 §2）。
--
-- NIP-11 的 `self` 是 Relay 自身签名公钥（SF-BUZ-47），NIP-43 事件由它验签。运行期
-- 以它判定「Relay 是否仍是登记的那一个」：文档摘要会因版本、图标等无关字段变化，
-- 而 `self` 改变说明 Relay 签名身份或部署已换，只在恢复为登记值后才能回到 ACTIVE。
--
-- 只加可空列，正在运行的旧版本不读不写它，向前兼容。存量行不在迁移里回填：迁移
-- 无法观察 Relay。存量 ACTIVE 行由 Core 治理对账器在「运行期文档摘要仍等于已查证
-- 快照」时登记——摘要相等即当时查证过的文档，其中的 `self` 就是查证过的值；摘要
-- 已变的存量行没有可比的登记值，漂移后停在 RECONCILING 等待运维处置，不自动登记。
--
-- 回滚条件：新版本 Core 回退时执行 down。旧版本不依赖此列，删除即可。
ALTER TABLE projection.tenant_buzz_binding
    ADD COLUMN relay_self_pubkey text,
    ADD CONSTRAINT relay_self_pubkey_is_hex CHECK (
        relay_self_pubkey IS NULL OR relay_self_pubkey ~ '^[0-9a-f]{64}$'
    );
