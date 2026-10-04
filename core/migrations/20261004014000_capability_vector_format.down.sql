-- Keep registered immutable evidence; never erase it to make rollback pass.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM catalog.capability_contract) THEN
        RAISE EXCEPTION 'capability vector format rollback requires an empty contract catalog'
            USING ERRCODE='23514';
    END IF;
END $$;
ALTER TABLE catalog.capability_contract
    DROP CONSTRAINT capability_contract_test_vectors_check;
ALTER TABLE catalog.capability_contract
    ADD CONSTRAINT capability_contract_test_vectors_check
    CHECK (jsonb_typeof(test_vectors)='array' AND jsonb_array_length(test_vectors)>0);
