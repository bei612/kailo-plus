-- 已存在 CHECK 定义时拒绝回滚，不把已有动作改写成 NONE。
ALTER TABLE catalog.action_definition
    DROP CONSTRAINT quota_check_supported,
    ADD CONSTRAINT quota_not_yet_enforced
        CHECK (quota_policy = 'NONE' AND cardinality(meters) = 0);
