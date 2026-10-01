-- 已被 ActionExecution 引用的定义受 catalog.guard_version 保护；该情形需先停止回滚。
DROP INDEX admission.task_cancel_one_intent_per_original;
DELETE FROM catalog.action_definition
WHERE action_key IN ('task.cancel.workspace.create.v1',
                     'task.cancel.workspace.member.add.v1',
                     'task.cancel.workspace.member.revoke.v1',
                     'task.cancel.tenant.member.revoke.v1')
  AND version = 1;
ALTER TABLE admission.action_execution DROP COLUMN cancel_first_run_id;
