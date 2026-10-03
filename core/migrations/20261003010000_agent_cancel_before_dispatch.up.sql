-- DD-48/51, 03 §7/8: a CREATED cancellation has no dispatched model usage.
-- Keep native interruption distinct from the fenced absence of dispatch;
-- UNKNOWN/DISPATCHING can never use this no-turn terminal path.
ALTER TABLE catalog.agent_invocation DROP CONSTRAINT agent_invocation_check1;
ALTER TABLE catalog.agent_invocation ADD CONSTRAINT agent_invocation_check1 CHECK (
    status <> 'CANCELED' OR native_status IS NOT DISTINCT FROM 'interrupted'
    OR (cancel_pending AND native_status IS NULL AND runtime_turn_id IS NULL AND reply_event_id IS NULL)
);

CREATE FUNCTION catalog.guard_agent_cancel_before_dispatch() RETURNS trigger AS $$
BEGIN
    IF NEW.status='CANCELED' AND NEW.native_status IS NULL THEN
        IF TG_OP <> 'UPDATE' THEN
            RAISE EXCEPTION 'No-turn cancellation requires an existing CREATED intent'
                USING ERRCODE='check_violation';
        END IF;
        IF OLD.status NOT IN ('CREATED','CANCELED')
            OR OLD.runtime_turn_id IS NOT NULL OR OLD.native_status IS NOT NULL
            OR OLD.reply_event_id IS NOT NULL
            OR EXISTS (SELECT 1 FROM projection.agent_model_trace WHERE invocation_id=NEW.id)
            OR EXISTS (SELECT 1 FROM outbox.usage_event WHERE invocation_id=NEW.id) THEN
            RAISE EXCEPTION 'Dispatched or unknown model work cannot become no-turn cancellation'
                USING ERRCODE='check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER agent_invocation_cancel_evidence_guard BEFORE INSERT OR UPDATE
    ON catalog.agent_invocation FOR EACH ROW EXECUTE FUNCTION catalog.guard_agent_cancel_before_dispatch();
