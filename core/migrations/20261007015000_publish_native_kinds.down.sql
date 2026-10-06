-- Never discard publication/reconciliation identities to make rollback succeed.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM admission.publish_attempt WHERE message_kind IN (1, 5, 7)) THEN
    RAISE EXCEPTION 'Native publication attempts exist; retain their reconciliation schema';
  END IF;
END $$;
ALTER TABLE admission.publish_attempt
  DROP CONSTRAINT publish_attempt_message_kind_check,
  ADD CONSTRAINT publish_attempt_message_kind_check
    CHECK (message_kind IN (9, 40003, 45001, 45003));
