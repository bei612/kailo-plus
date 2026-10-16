-- DD-118 batch 2b: the owner-signed NIP-34 merged status (1631) published after
-- a Projects merge reuses the existing publication intent and reconciliation
-- ledger, like the other review lifecycle decisions (1630/1632/1633).
ALTER TABLE admission.publish_attempt
  DROP CONSTRAINT publish_attempt_message_kind_check,
  ADD CONSTRAINT publish_attempt_message_kind_check
    CHECK (message_kind IN (1, 5, 7, 9, 1618, 1621, 1630, 1631, 1632, 1633, 30300, 30617, 30621, 40003, 45001, 45003));
