-- Never lose an existing publication's frozen mention intent on rollback.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM admission.publish_attempt WHERE cardinality(mention_pubkeys) <> 0) THEN
        RAISE EXCEPTION 'Human mention attempts exist; retain their reconciliation identity';
    END IF;
END $$;
ALTER TABLE admission.publish_attempt DROP COLUMN mention_pubkeys;
