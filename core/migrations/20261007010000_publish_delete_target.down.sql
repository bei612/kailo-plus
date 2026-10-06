-- Stop rollback if any deletion intent would lose its reconciliation identity.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM admission.publish_attempt WHERE delete_event_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Deletion attempts exist; keep additive schema until original reconciliation retires them';
    END IF;
END $$;
ALTER TABLE admission.publish_attempt DROP COLUMN delete_event_id;
