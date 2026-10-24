-- DD-154: AgentSession terminal state ABANDONED. Core reconciles an UNKNOWN
-- Session whose Invocations have all ended (and whose CapacityLeases are
-- released) past the reconciliation deadline; it never dispatches a turn on it
-- again. catalog.agent_installation_drained already counts only STARTING and
-- UNKNOWN Sessions as in-flight, so ABANDONED stops blocking the drain while
-- UNKNOWN Invocations keep blocking it.
ALTER TABLE catalog.agent_session DROP CONSTRAINT agent_session_status_check;
ALTER TABLE catalog.agent_session ADD CONSTRAINT agent_session_status_check
    CHECK (status IN ('PENDING','STARTING','ACTIVE','UNKNOWN','CLOSED','ABANDONED'));
