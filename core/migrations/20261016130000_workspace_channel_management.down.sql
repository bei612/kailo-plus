-- 已有按这两个定义准入的动作时，catalog.guard_version 触发器拒绝删除：那些
-- ActionExecution 是 Workspace 可见性改写、Channel 元数据签发与成员进入 REVOKING 的
-- 准入证据，旧版本 Core 也无法收敛它们。该情形停止回滚。
DELETE FROM catalog.action_definition
WHERE action_key IN ('workspace.update', 'workspace.leave') AND version = 1;
