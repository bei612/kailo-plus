-- NIP-34 issues reuse the existing publication intent and reconciliation ledger.
ALTER TABLE admission.publish_attempt
  DROP CONSTRAINT publish_attempt_message_kind_check,
  ADD CONSTRAINT publish_attempt_message_kind_check
    CHECK (message_kind IN (1, 5, 7, 9, 1621, 30300, 30617, 30621, 40003, 45001, 45003));
