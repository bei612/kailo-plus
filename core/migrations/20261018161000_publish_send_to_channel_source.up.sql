-- DD-125(1), DD-81: the original "Send to channel" publishes a new top-level kind:9
-- whose body and semantic tags come from a re-read thread reply, never from the
-- browser. The source event ID is part of the frozen publication intent, so a
-- replay of the same idempotency key with another source is a conflict instead of
-- silently answering with the first event. Additive; existing writers leave it NULL.
ALTER TABLE admission.publish_attempt
    ADD COLUMN send_to_channel_source_event_id text,
    ADD CONSTRAINT publish_send_to_channel_source_shape
        CHECK (send_to_channel_source_event_id IS NULL OR
            (send_to_channel_source_event_id ~ '^[0-9a-f]{64}$' AND message_kind = 9
             AND parent_event_id IS NULL AND edit_event_id IS NULL
             AND delete_event_id IS NULL));
