-- DD-102 / ADR-12: machine-encoded vectors replace opaque narrative arrays.
-- Stop rather than rewrite immutable evidence or invent executable semantics.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM catalog.capability_contract) THEN
        RAISE EXCEPTION 'capability vector format migration requires an empty contract catalog; immutable existing evidence cannot be rewritten'
            USING ERRCODE='23514';
    END IF;
END $$;
ALTER TABLE catalog.capability_contract
    DROP CONSTRAINT capability_contract_test_vectors_check;
ALTER TABLE catalog.capability_contract
    ADD CONSTRAINT capability_contract_test_vectors_check CHECK ((
        jsonb_typeof(test_vectors)='object'
        AND test_vectors->>'formatVersion'='V1'
        AND jsonb_typeof(test_vectors->'cases')='array'
        AND jsonb_array_length(test_vectors->'cases')>0
    ) IS TRUE);
