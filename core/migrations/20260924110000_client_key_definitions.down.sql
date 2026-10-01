-- 已有按这两个定义准入的动作时，guard_version 触发器拒绝删除（它们是准入证据）。
DELETE FROM catalog.action_definition
WHERE action_key IN ('identity.client_key.register', 'identity.client_key.revoke') AND version = 1;
