-- Never remove evidence required to reconcile an already dispatched review.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM admission.publish_attempt WHERE message_kind IN (1618, 1630, 1632, 1633)) THEN
    RAISE EXCEPTION 'Review publication attempts exist; retain their reconciliation schema';
  END IF;
END $$;
ALTER TABLE admission.publish_attempt
  DROP CONSTRAINT publish_attempt_message_kind_check,
  ADD CONSTRAINT publish_attempt_message_kind_check
    CHECK (message_kind IN (1, 5, 7, 9, 1621, 30300, 30617, 30621, 40003, 45001, 45003));
