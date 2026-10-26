-- Stop rollback when submitted feedback would be lost.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM support.feedback_submission) THEN
    RAISE EXCEPTION 'feedback submissions exist; retain them';
  END IF;
END $$;
DROP TABLE support.feedback_submission;
DROP FUNCTION support.guard_feedback_submission();
DROP SCHEMA support;
