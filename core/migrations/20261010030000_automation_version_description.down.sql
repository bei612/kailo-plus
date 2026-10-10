DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM catalog.automation_version WHERE description IS NOT NULL) THEN
  RAISE EXCEPTION 'Automation descriptions exist; stop rollback without discarding version content';
 END IF;
END $$;
ALTER TABLE catalog.automation_version DROP COLUMN description;
