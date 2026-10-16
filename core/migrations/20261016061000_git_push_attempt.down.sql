-- Never discard the intent a dispatched push still needs to be reconciled.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM admission.git_push_attempt) THEN
    RAISE EXCEPTION 'Git push attempts exist; retain their reconciliation records';
  END IF;
END $$;
DROP TABLE admission.git_push_attempt;
