-- 已有 Huddle 绑定时停止回滚：它们是 CONTROL 临时频道投影的唯一 Core 证据，旧版本 Core
-- 也无法收敛或结束它们。
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM projection.huddle_buzz_binding) THEN
    RAISE EXCEPTION 'huddle bindings exist; retain their projection records';
  END IF;
END $$;
DROP TABLE projection.huddle_buzz_binding;
-- 已有按这些定义准入的动作时，catalog.guard_version 触发器拒绝删除：该情形停止回滚。
DELETE FROM catalog.action_definition
WHERE action_key IN ('huddle.start', 'huddle.agent.add', 'huddle.agent.remove', 'huddle.end')
  AND version = 1;
