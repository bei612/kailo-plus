-- Never silently discard product visibility or historical admission evidence.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM identity.workspace WHERE visibility <> 'private') THEN
    RAISE EXCEPTION 'Open workspaces prevent visibility rollback';
  END IF;
END $$;
DELETE FROM catalog.action_definition WHERE action_key = 'workspace.join' AND version = 1;
ALTER TABLE identity.workspace DROP COLUMN visibility;
