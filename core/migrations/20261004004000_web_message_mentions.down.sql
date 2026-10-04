-- 已发布 mention 的原意图不能因降级变成普通空目标；须先按原保留流程收敛。
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM admission.publish_attempt
             WHERE cardinality(mention_installation_ids) <> 0) THEN
    RAISE EXCEPTION 'web message mention references remain; stop downgrade';
  END IF;
END $$;
ALTER TABLE admission.publish_attempt DROP COLUMN mention_installation_ids;
