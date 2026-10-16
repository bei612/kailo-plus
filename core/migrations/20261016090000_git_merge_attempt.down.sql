-- Never discard the intent a dispatched merge still needs to be reconciled.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM admission.git_push_attempt WHERE pull_request_event_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Merge push attempts exist; retain their reconciliation records';
  END IF;
END $$;
ALTER TABLE admission.git_push_attempt
    DROP CONSTRAINT git_push_attempt_update_check,
    DROP CONSTRAINT git_push_attempt_commit_check,
    DROP COLUMN pull_request_event_id,
    DROP COLUMN source_commit,
    DROP COLUMN merge_author_name,
    DROP COLUMN merge_author_email,
    DROP COLUMN merged_at,
    ADD CONSTRAINT git_push_attempt_commit_check CHECK (
        old_commit ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'
        AND new_commit ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'
        AND length(old_commit) = length(new_commit)
        AND old_commit <> new_commit
    ),
    ADD CONSTRAINT git_push_attempt_update_check CHECK (
        (old_commit ~ '^0+$') <> (new_commit ~ '^0+$')
        AND (source_branch IS NOT NULL) = (old_commit ~ '^0+$')
    );
