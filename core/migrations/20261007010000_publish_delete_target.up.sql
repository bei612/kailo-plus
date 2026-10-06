-- Additive: existing writers continue to create non-deletion attempts.
ALTER TABLE admission.publish_attempt ADD COLUMN delete_event_id text;
ALTER TABLE admission.publish_attempt ADD CONSTRAINT publish_delete_target_shape
    CHECK (delete_event_id IS NULL OR
        (delete_event_id ~ '^[0-9a-f]{64}$' AND message_kind = 5
         AND edit_event_id IS NULL AND parent_event_id IS NULL));
