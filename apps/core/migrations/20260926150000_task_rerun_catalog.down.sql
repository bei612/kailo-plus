-- 已被 ActionExecution 引用的版本不可删除；此时停止回滚。
DROP INDEX admission.task_rerun_one_intent_per_original;
DELETE FROM catalog.action_definition
WHERE action_key IN ('task.rerun.workspace.create.v1',
                     'task.rerun.workspace.member.add.v1',
                     'task.rerun.workspace.member.revoke.v1',
                     'task.rerun.tenant.member.revoke.v1')
  AND version = 1;
DELETE FROM catalog.approval_policy
WHERE id = 'ae4bd8d6-2e9f-4abc-8c47-86fd6d0e9101' AND version = 1;
