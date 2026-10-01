-- 已有按这两个定义准入的动作时，catalog.guard_version 触发器拒绝删除：那些
-- ActionExecution 是业务 Tenant 进入 SUSPENDING/RESTORING 的准入证据。该情形停止回滚。
DELETE FROM catalog.action_definition
WHERE action_key IN ('tenant.suspend', 'tenant.restore') AND version = 1;
