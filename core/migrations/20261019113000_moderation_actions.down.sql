-- 已发送或待对账的审核事件引用是 UNKNOWN 对账的唯一依据：存在即停止回滚。
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM admission.moderation_publication) THEN
    RAISE EXCEPTION 'moderation publications exist; retain their reconciliation schema';
  END IF;
END $$;
DROP TABLE admission.moderation_publication;
-- 已有按这些定义准入的动作时，catalog.guard_version 触发器拒绝删除：那些
-- ActionExecution 是 Relay 举报、限制与审核决定的准入证据。该情形停止回滚。
DELETE FROM catalog.action_definition
WHERE action_key IN ('moderation.report.submit', 'moderation.ban', 'moderation.unban',
                     'moderation.timeout', 'moderation.untimeout', 'moderation.report.resolve',
                     'moderation.message.delete')
  AND version = 1;
