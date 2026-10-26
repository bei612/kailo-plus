-- Stop rollback once a governed profile write or icon fact exists.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM admission.action_execution WHERE action_key = 'tenant.profile.update')
     OR EXISTS (SELECT 1 FROM identity.tenant WHERE icon IS NOT NULL) THEN
    RAISE EXCEPTION 'tenant profile facts/admission records exist; retain them';
  END IF;
END $$;
DELETE FROM catalog.action_definition WHERE action_key = 'tenant.profile.update' AND version = 1;
ALTER TABLE identity.tenant DROP CONSTRAINT tenant_icon_check;
ALTER TABLE identity.tenant DROP COLUMN icon;
