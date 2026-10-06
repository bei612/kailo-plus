-- Original Buzz edit reference, frozen in the existing publication intent.
-- No message body or alternate message authority is persisted in Core.
ALTER TABLE admission.publish_attempt
  ADD COLUMN edit_event_id text,
  DROP CONSTRAINT publish_attempt_message_kind_check,
  ADD CONSTRAINT publish_attempt_message_kind_check CHECK (message_kind IN (9, 40003, 45001, 45003)),
  ADD CONSTRAINT publish_attempt_edit_event_id_check CHECK (
    (edit_event_id IS NULL AND message_kind <> 40003) OR
    (edit_event_id IS NOT NULL AND edit_event_id ~ '^[0-9a-f]{64}$' AND message_kind = 40003 AND parent_event_id IS NULL)
  );
