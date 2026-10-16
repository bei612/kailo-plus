-- DD-118 / DD-81: Projects branch pushes (CREATE_BRANCH / DELETE_BRANCH) record
-- their intent before `git push`, in the same transaction as the DISPATCH audit.
-- One row per (person, Idempotency-Key). The intent is one ref update on one
-- Relay repository: `ref_name` from `old_commit` to `new_commit`, where an
-- all-zero object id is the absent side (create: old, delete: new). A retry with
-- the same key reconciles from the ref Relay advertises to the same person:
-- new = delivered, old = not delivered (push again, the key then names the new
-- operation), anything else = conflict. Repository content and ref authority
-- stay at Relay; this is not a ref mirror. Rows whose operation has an outcome
-- are removed after the publication idempotency retention.
CREATE TABLE admission.git_push_attempt (
    tenant_principal_id uuid        NOT NULL REFERENCES identity.principal (id),
    idempotency_key     uuid        NOT NULL,
    operation_id        uuid        NOT NULL,
    -- The 30617 coordinate the Browser named; Core derives the git path from it.
    repository          text        NOT NULL,
    ref_name            text        NOT NULL,
    -- CREATE_BRANCH only: the source branch whose head the new branch starts at.
    source_branch       text,
    old_commit          text        NOT NULL,
    new_commit          text        NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT git_push_attempt_pkey PRIMARY KEY (tenant_principal_id, idempotency_key),
    CONSTRAINT git_push_attempt_operation_key UNIQUE (operation_id),
    CONSTRAINT git_push_attempt_repository_check
        CHECK (repository ~ '^30617:[0-9a-f]{64}:[A-Za-z0-9._-]{1,64}$'),
    CONSTRAINT git_push_attempt_ref_name_check
        CHECK (ref_name ~ '^refs/heads/[A-Za-z0-9/._-]{1,255}$'),
    CONSTRAINT git_push_attempt_source_branch_check
        CHECK (source_branch IS NULL OR source_branch ~ '^[A-Za-z0-9/._-]{1,255}$'),
    CONSTRAINT git_push_attempt_commit_check CHECK (
        old_commit ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'
        AND new_commit ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'
        AND length(old_commit) = length(new_commit)
        AND old_commit <> new_commit
    ),
    -- Exactly one side is absent; only a creation names its source branch.
    CONSTRAINT git_push_attempt_update_check CHECK (
        (old_commit ~ '^0+$') <> (new_commit ~ '^0+$')
        AND (source_branch IS NOT NULL) = (old_commit ~ '^0+$')
    )
);
CREATE INDEX git_push_attempt_age ON admission.git_push_attempt (created_at);
