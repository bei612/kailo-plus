-- 已有按这两个定义准入的动作时，catalog.guard_version 触发器拒绝删除：那些
-- ActionExecution 是 Workspace 进入 SUSPENDING/RESTORING 的准入证据，旧版本 Core
-- 也不能收敛处于这两个状态的 Workspace。该情形停止回滚。
DELETE FROM catalog.action_definition
WHERE action_key IN ('workspace.suspend', 'workspace.restore') AND version = 1;
