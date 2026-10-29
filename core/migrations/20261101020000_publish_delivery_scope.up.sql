-- DD-81: immutable actual-event and admission metadata, never body/tags.
-- Historical NULL scopes cannot be reconstructed from today's host or defaults.
ALTER TABLE admission.publish_attempt ADD COLUMN delivery_scope jsonb
    CHECK (delivery_scope IS NULL OR jsonb_typeof(delivery_scope) = 'object');
