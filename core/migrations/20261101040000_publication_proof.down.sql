-- Stop rollback instead of erasing a proof that authorized a new attempt.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM audit.audit_event WHERE publication_proof IS NOT NULL) THEN
    RAISE EXCEPTION 'publication proof exists; preserve immutable audit and stop rollback';
  END IF;
END $$;
ALTER TABLE audit.audit_event DROP CONSTRAINT audit_publication_proof_closed;
ALTER TABLE audit.audit_event DROP COLUMN publication_proof;
DROP FUNCTION audit.publication_absence_proven(jsonb,jsonb);
