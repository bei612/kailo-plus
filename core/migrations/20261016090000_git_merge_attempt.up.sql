-- DD-118 batch 2b / DD-81: a pull-request merge is one more Relay ref update
-- recorded before `git push`. The target branch moves from the head the merge
-- was made on (old_commit) to the merge commit (new_commit). Both sides exist;
-- they are equal when the review is already contained in the target (the
-- original "Already up to date"). The merge inputs are frozen with the intent
-- so a not-delivered update re-creates the same merge commit: the review
-- (pull_request_event_id), its branch (source_branch) and expected head
-- (source_commit), and the author/committer identity and time (merged_at,
-- Unix seconds). Branch create/delete rows keep their shape with these NULL.
ALTER TABLE admission.git_push_attempt
    ADD COLUMN pull_request_event_id text,
    ADD COLUMN source_commit text,
    ADD COLUMN merge_author_name text,
    ADD COLUMN merge_author_email text,
    ADD COLUMN merged_at bigint,
    DROP CONSTRAINT git_push_attempt_commit_check,
    DROP CONSTRAINT git_push_attempt_update_check,
    ADD CONSTRAINT git_push_attempt_commit_check CHECK (
        old_commit ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'
        AND new_commit ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'
        AND length(old_commit) = length(new_commit)
    ),
    ADD CONSTRAINT git_push_attempt_update_check CHECK (
        (
            -- Branch create/delete: exactly one side is absent; only a creation
            -- names its source branch.
            pull_request_event_id IS NULL
            AND source_commit IS NULL
            AND merge_author_name IS NULL
            AND merge_author_email IS NULL
            AND merged_at IS NULL
            AND old_commit <> new_commit
            AND (old_commit ~ '^0+$') <> (new_commit ~ '^0+$')
            AND (source_branch IS NOT NULL) = (old_commit ~ '^0+$')
        ) OR (
            -- Merge: both sides exist and every frozen input is present.
            pull_request_event_id IS NOT NULL
            AND pull_request_event_id ~ '^[0-9a-f]{64}$'
            AND source_branch IS NOT NULL
            AND source_commit IS NOT NULL
            AND source_commit ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'
            AND length(source_commit) = length(old_commit)
            AND old_commit !~ '^0+$'
            AND new_commit !~ '^0+$'
            AND merge_author_name IS NOT NULL
            AND length(merge_author_name) BETWEEN 1 AND 128
            AND merge_author_email IS NOT NULL
            AND length(merge_author_email) BETWEEN 3 AND 512
            AND merged_at IS NOT NULL
            AND merged_at > 0
        )
    );
