-- Stop rollback if it would erase an unresolved external effect or token ownership.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM projection.push_send_intent)
 OR EXISTS (SELECT 1 FROM admission.push_token_intent WHERE state <> 'RETIRED') THEN
 RAISE EXCEPTION 'push intents must be reconciled before rollback';
 END IF;
END $$;
DROP TABLE admission.push_token_intent;
DROP TABLE projection.push_send_intent;
ALTER TABLE projection.push_cursor DROP COLUMN lease_id, DROP COLUMN lease_until;
