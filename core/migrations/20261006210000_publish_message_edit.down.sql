-- Refuse rollback while a recorded edit still needs its original receipt.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM admission.publish_attempt WHERE message_kind = 40003) THEN
    RAISE EXCEPTION 'message edit receipts exist; stop rollback without deleting evidence';
  END IF;
END $$;
ALTER TABLE admission.publish_attempt
  DROP CONSTRAINT publish_attempt_edit_event_id_check,
  DROP CONSTRAINT publish_attempt_message_kind_check,
  DROP COLUMN edit_event_id,
  ADD CONSTRAINT publish_attempt_message_kind_check CHECK (message_kind IN (9, 45001, 45003));
