-- DD-119(9)、V-SCN-99：成员以本人 SERVER 身份发布的原版主题命令（严格 h+topic 的
-- kind 9002）复用既有发布意图与对账账本；结果不明只对账，不另签新事件。
ALTER TABLE admission.publish_attempt
  DROP CONSTRAINT publish_attempt_message_kind_check,
  ADD CONSTRAINT publish_attempt_message_kind_check
    CHECK (message_kind IN (1, 5, 7, 9, 1618, 1621, 1630, 1631, 1632, 1633, 9002, 30300, 30617, 30621, 40003, 45001, 45003));
