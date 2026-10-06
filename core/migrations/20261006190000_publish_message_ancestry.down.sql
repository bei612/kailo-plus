DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM admission.publish_attempt
             WHERE message_kind <> 9 OR parent_event_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot remove live native message idempotency references';
  END IF;
END $$;
ALTER TABLE admission.publish_attempt DROP COLUMN parent_event_id, DROP COLUMN message_kind;
