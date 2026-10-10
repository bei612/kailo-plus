DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM catalog.automation_definition WHERE created_at IS NOT NULL OR updated_at IS NOT NULL)
   OR EXISTS(SELECT 1 FROM catalog.automation_version WHERE created_at IS NOT NULL OR updated_at IS NOT NULL) THEN
  RAISE EXCEPTION 'Automation timestamps have observed writes; preserve their evidence before downgrade';
 END IF;
END $$;
DROP TRIGGER automation_version_time ON catalog.automation_version;
DROP TRIGGER automation_definition_time ON catalog.automation_definition;
DROP FUNCTION catalog.record_automation_time();
ALTER TABLE catalog.automation_version DROP COLUMN updated_at;
ALTER TABLE catalog.automation_version DROP COLUMN created_at;
ALTER TABLE catalog.automation_definition DROP COLUMN updated_at;
ALTER TABLE catalog.automation_definition DROP COLUMN created_at;
