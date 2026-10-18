-- 已派发的额度意图是 OpenMeter entitlement 写入的唯一 Core 证据；结果仍需对账时停止回滚。
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM admission.tenant_quota_intent) THEN
    RAISE EXCEPTION 'tenant quota intents exist; retain their reconciliation records';
  END IF;
END $$;
DROP TABLE admission.tenant_quota_intent;
-- 已有按该定义准入的动作时，catalog.guard_version 触发器拒绝删除：那些 ActionExecution
-- 是 OpenMeter 额度写入的准入证据，旧版本 Core 也无法收敛它们。该情形停止回滚。
DELETE FROM catalog.action_definition WHERE action_key = 'tenant.quota.set' AND version = 1;
