-- 原 Catalog 引用/不可变守卫拒绝删除已消费定义；不删除业务 AE 或权限关系。
DELETE FROM catalog.action_definition WHERE action_key IN
 ('agent.installation.execute.grant','agent.installation.execute.revoke');
DELETE FROM catalog.approval_policy WHERE action_key='agent.installation.execute.grant';
