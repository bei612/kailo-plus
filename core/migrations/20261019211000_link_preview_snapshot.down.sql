-- 有发布意图冻结了快照引用或抑制标记时停止回滚：旧版本 Core 读不到这两个字段，同一
-- 幂等键的重发会被当成另一次意图。快照本身是短期数据，可随表删除。
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM admission.publish_attempt
               WHERE cardinality(link_preview_snapshot_ids) > 0 OR suppress_link_previews) THEN
        RAISE EXCEPTION 'Link-preview publication intents exist; keep additive schema until original reconciliation retires them';
    END IF;
END $$;
ALTER TABLE admission.publish_attempt
    DROP CONSTRAINT publish_link_preview_shape,
    DROP COLUMN suppress_link_previews,
    DROP COLUMN link_preview_snapshot_ids;
DROP TABLE admission.link_preview_snapshot;
