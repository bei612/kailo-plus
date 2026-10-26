-- Stop rollback while any frozen publication scope exists. Dropping it would
-- erase the only original scope of an UNKNOWN dispatch; never infer it later.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM admission.publish_attempt WHERE delivery_scope IS NOT NULL) THEN
        RAISE EXCEPTION 'cannot remove publication delivery scope while frozen attempts exist';
    END IF;
END $$;
ALTER TABLE admission.publish_attempt DROP COLUMN delivery_scope;
