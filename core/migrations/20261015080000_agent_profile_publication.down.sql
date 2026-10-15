-- Signed Agent profile events are external effects with audit references:
-- once any exists, rollback stops instead of erasing the publication evidence.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM projection.agent_profile_publication) THEN
  RAISE EXCEPTION 'Agent profile publication evidence exists; destructive rollback forbidden';
 END IF;
END $$;
DROP TABLE projection.agent_profile_publication;
DROP FUNCTION projection.guard_agent_profile_publication();
