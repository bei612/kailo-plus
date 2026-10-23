-- DD-148、SF-BUZ-62(7)：原 Agent 收件人栏。addressed_installation_ids 是同一发布意图
-- mention_installation_ids 的子集，排序去重后冻结；同一幂等键换一组收件人即 409，
-- NOT_DELIVERED 重签沿用同一集合。只随新消息（kind 9 / 45001 / 45003，含线程回复），
-- 不随编辑、删除或“发送到频道”。增量；旧 writer 写默认空集合，原语义不变。
ALTER TABLE admission.publish_attempt
    ADD COLUMN addressed_installation_ids uuid[] NOT NULL DEFAULT '{}',
    ADD CONSTRAINT publish_agent_address_shape CHECK (
        array_position(addressed_installation_ids, NULL) IS NULL
        AND addressed_installation_ids <@ mention_installation_ids
        AND (cardinality(addressed_installation_ids) = 0
             OR (message_kind IN (9, 45001, 45003) AND edit_event_id IS NULL
                 AND delete_event_id IS NULL AND send_to_channel_source_event_id IS NULL)));
