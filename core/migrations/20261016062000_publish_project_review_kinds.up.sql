-- DD-118: NIP-34 review creation (1618) and the review lifecycle decisions
-- (1630/1632/1633, already published by projects.publish) reuse the existing
-- publication intent and reconciliation ledger.
ALTER TABLE admission.publish_attempt
  DROP CONSTRAINT publish_attempt_message_kind_check,
  ADD CONSTRAINT publish_attempt_message_kind_check
    CHECK (message_kind IN (1, 5, 7, 9, 1618, 1621, 1630, 1632, 1633, 30300, 30617, 30621, 40003, 45001, 45003));
