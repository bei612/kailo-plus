-- Exact public identity references only; message bodies stay on Buzz Relay.
ALTER TABLE admission.publish_attempt
    ADD COLUMN mention_pubkeys text[] NOT NULL DEFAULT '{}';
ALTER TABLE admission.publish_attempt ADD CONSTRAINT publish_human_mentions_shape
    CHECK (array_position(mention_pubkeys, NULL) IS NULL
        AND (delete_event_id IS NULL OR cardinality(mention_pubkeys) = 0));
