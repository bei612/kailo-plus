-- The prior contract cannot represent a proven cancellation without a native
-- turn. Do not invent an interrupted turn or erase its retained audit evidence.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM catalog.agent_invocation
        WHERE status='CANCELED' AND native_status IS NULL) THEN
        RAISE EXCEPTION 'No-turn cancellation must be preserved; rollback is not representable';
    END IF;
END;
$$;
DROP TRIGGER agent_invocation_cancel_evidence_guard ON catalog.agent_invocation;
DROP FUNCTION catalog.guard_agent_cancel_before_dispatch();
ALTER TABLE catalog.agent_invocation DROP CONSTRAINT agent_invocation_check1;
ALTER TABLE catalog.agent_invocation ADD CONSTRAINT agent_invocation_check1 CHECK (
    status <> 'CANCELED' OR native_status IS NOT DISTINCT FROM 'interrupted'
);
