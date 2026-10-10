-- Original WorkflowCard dates belong to the existing Automation authority.
-- Historical rows have no proven creation/update time: no backfill or DEFAULT.
ALTER TABLE catalog.automation_definition ADD COLUMN created_at timestamptz;
ALTER TABLE catalog.automation_definition ADD COLUMN updated_at timestamptz;
ALTER TABLE catalog.automation_version ADD COLUMN created_at timestamptz;
ALTER TABLE catalog.automation_version ADD COLUMN updated_at timestamptz;

CREATE FUNCTION catalog.record_automation_time() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  NEW.created_at=clock_timestamp();
  NEW.updated_at=NEW.created_at;
 ELSE
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
   RAISE EXCEPTION 'Automation creation time is immutable' USING ERRCODE='check_violation';
  END IF;
  IF (to_jsonb(NEW)-ARRAY['created_at','updated_at']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['created_at','updated_at']) THEN
   NEW.updated_at=clock_timestamp();
  ELSE
   NEW.updated_at=OLD.updated_at;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER automation_definition_time
 BEFORE INSERT OR UPDATE ON catalog.automation_definition
 FOR EACH ROW EXECUTE FUNCTION catalog.record_automation_time();

-- Record only this row. Updating a parent timestamp would require mutating its
-- original governance version fence. Original *_scope BEFORE triggers sort
-- before *_time: scope, immutable content and state transitions remain checked
-- before assigning derived timestamps; no business field is changed here.
CREATE TRIGGER automation_version_time
 BEFORE INSERT OR UPDATE ON catalog.automation_version
 FOR EACH ROW EXECUTE FUNCTION catalog.record_automation_time();
