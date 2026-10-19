-- 已签发的 Canvas 意图是 CONTROL 40100 写入的唯一 Core 证据；仍有记录时停止回滚。
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM admission.workspace_canvas_intent) THEN
    RAISE EXCEPTION 'workspace canvas intents exist; retain their reconciliation records';
  END IF;
END $$;
DROP TABLE admission.workspace_canvas_intent;
-- 已有按该定义准入的动作时，catalog.guard_version 触发器拒绝删除：那些 ActionExecution 是
-- Canvas 写入的准入证据，旧版本 Core 也无法收敛它们。该情形停止回滚。
DELETE FROM catalog.action_definition WHERE action_key = 'workspace.canvas.set' AND version = 1;
