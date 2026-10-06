-- Freeze native message semantics alongside the existing idempotent event reference.
-- No body, attachment contents or body hash is stored in Core.
ALTER TABLE admission.publish_attempt
  ADD COLUMN message_kind integer NOT NULL DEFAULT 9,
  ADD COLUMN parent_event_id text,
  ADD CHECK (message_kind IN (9, 45001, 45003)),
  ADD CHECK (parent_event_id IS NULL OR parent_event_id ~ '^[0-9a-f]{64}$');
