-- 有发布意图冻结了引用提及时停止回滚：旧版本 Core 读不到该字段，同一幂等键的重发会被
-- 当成另一次意图，NOT_DELIVERED 重签也会丢掉这些引用。
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM admission.publish_attempt
               WHERE cardinality(reference_mention_pubkeys) <> 0) THEN
        RAISE EXCEPTION 'Reference mention publication intents exist; keep additive schema until original reconciliation retires them';
    END IF;
END $$;
ALTER TABLE admission.publish_attempt
    DROP CONSTRAINT publish_reference_mentions_shape,
    DROP COLUMN reference_mention_pubkeys;
