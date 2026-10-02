-- 有 PLATFORM_SLOT 定义时停止回滚，不能抹去运行中的租约与终态证据。
ALTER TABLE catalog.action_definition DROP CONSTRAINT capacity_not_yet_enforced;
ALTER TABLE catalog.action_definition ADD CONSTRAINT capacity_not_yet_enforced CHECK (capacity_policy='NONE');
DROP TABLE admission.capacity_lease;
DROP FUNCTION admission.guard_capacity_lease();
DROP TABLE admission.capacity_pool;
