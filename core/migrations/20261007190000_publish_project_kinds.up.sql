-- REQ-24 / DD-80 / DD-81: native project bootstrap uses the existing ledger.
-- Event bodies and coordinate ownership remain at Relay.
ALTER TABLE admission.publish_attempt
  DROP CONSTRAINT publish_attempt_message_kind_check,
  ADD CONSTRAINT publish_attempt_message_kind_check
    CHECK (message_kind IN (1, 5, 7, 9, 30617, 30621, 40003, 45001, 45003));
