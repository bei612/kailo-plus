-- ADR-14：CHECK 只消费 OpenMeter 的真实授权；STRICT 的 producer 闭合未成立。
-- 不登记 CHECK 动作、不创建 meter/feature/entitlement 或第二份额度账本。
ALTER TABLE catalog.action_definition
    DROP CONSTRAINT quota_not_yet_enforced,
    ADD CONSTRAINT quota_check_supported CHECK (
        (quota_policy = 'NONE' AND cardinality(meters) = 0)
        OR (quota_policy = 'CHECK' AND cardinality(meters) > 0
            AND array_ndims(meters) = 1
            AND array_position(meters, NULL) IS NULL
            AND array_position(meters, '') IS NULL)
    );
