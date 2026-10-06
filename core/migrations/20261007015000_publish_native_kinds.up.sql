-- REQ-24 / DD-81: Pulse and author deletion use the existing publication ledger.
-- Add only the native kinds already consumed by BFF; retain all target constraints.
ALTER TABLE admission.publish_attempt
  DROP CONSTRAINT publish_attempt_message_kind_check,
  ADD CONSTRAINT publish_attempt_message_kind_check
    CHECK (message_kind IN (1, 5, 7, 9, 40003, 45001, 45003));
