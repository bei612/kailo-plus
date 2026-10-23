-- Reverse of DD-150 workspace.delete. Refuses while any Workspace delete has been admitted or any
-- Workspace is DELETING/DELETED: those tombstones, snapshots and audit chains are history that a
-- schema rollback cannot remove; roll back by stopping the release instead.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM admission.workspace_lifecycle_snapshot)
   OR EXISTS (SELECT 1 FROM identity.workspace WHERE state IN ('DELETING','DELETED'))
   OR EXISTS (SELECT 1 FROM admission.action_execution WHERE action_key = 'workspace.delete') THEN
   RAISE EXCEPTION 'DD-150 workspace delete history must not be discarded; stop the release instead'
     USING ERRCODE = '55000';
 END IF;
END $$;

DELETE FROM catalog.action_definition WHERE action_key = 'workspace.delete';

DROP TRIGGER workspace_lifecycle_snapshot_guard ON admission.workspace_lifecycle_snapshot;
DROP FUNCTION admission.guard_workspace_lifecycle_snapshot();
DROP TABLE admission.workspace_lifecycle_snapshot;

ALTER TABLE identity.workspace DROP CONSTRAINT workspace_state_enum;
ALTER TABLE identity.workspace ADD CONSTRAINT workspace_state_enum CHECK (state IN
    ('PROVISIONING','ACTIVE','SUSPENDING','SUSPENDED','RESTORING','ERROR'));
