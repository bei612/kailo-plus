-- DD-125(8)、SF-BUZ-58(1)：原“不邀请直接发送 / 仍然发送”把频道外的 HUMAN 移出 p，
-- 改为每人一个原版 ["mention", <pubkey>] 显示引用。引用的公钥集合排序去重后冻结在
-- 同一发布意图里：同一幂等键换一组引用即 409，NOT_DELIVERED 重签沿用同一集合。
-- 只随新消息（kind 9 / 45001 / 45003，含线程回复），与通知用的 mention_pubkeys
-- 不相交，不随编辑、删除或“发送到频道”。增量；旧 writer 写默认空集合，原语义不变。
ALTER TABLE admission.publish_attempt
    ADD COLUMN reference_mention_pubkeys text[] NOT NULL DEFAULT '{}',
    ADD CONSTRAINT publish_reference_mentions_shape CHECK (
        array_position(reference_mention_pubkeys, NULL) IS NULL
        AND NOT (reference_mention_pubkeys && mention_pubkeys)
        AND (cardinality(reference_mention_pubkeys) = 0
             OR (message_kind IN (9, 45001, 45003) AND edit_event_id IS NULL
                 AND delete_event_id IS NULL AND send_to_channel_source_event_id IS NULL)));
