-- Stop rollback if any send-to-channel intent would lose its frozen source identity.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM admission.publish_attempt
               WHERE send_to_channel_source_event_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Send-to-channel attempts exist; keep additive schema until original reconciliation retires them';
    END IF;
END $$;
ALTER TABLE admission.publish_attempt
    DROP CONSTRAINT publish_send_to_channel_source_shape,
    DROP COLUMN send_to_channel_source_event_id;
