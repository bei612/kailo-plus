-- Reverse of DD-154. An ABANDONED Session carries a RECONCILIATION audit fact;
-- returning it to UNKNOWN would re-block drains that already completed on its
-- account, so rollback is refused once any Session was abandoned: stop the
-- release instead.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM catalog.agent_session WHERE status = 'ABANDONED') THEN
   RAISE EXCEPTION 'DD-154 abandoned Sessions must not be rewritten; stop the release instead'
     USING ERRCODE = '55000';
 END IF;
END $$;

ALTER TABLE catalog.agent_session DROP CONSTRAINT agent_session_status_check;
ALTER TABLE catalog.agent_session ADD CONSTRAINT agent_session_status_check
    CHECK (status IN ('PENDING','STARTING','ACTIVE','UNKNOWN','CLOSED'));
