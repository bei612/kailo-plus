-- Every historical handover remains an original append-only audit fact.
CREATE OR REPLACE FUNCTION admission.guard_capacity_lease() RETURNS trigger AS $$
BEGIN
    IF TG_OP='UPDATE' AND (
        NEW.id IS DISTINCT FROM OLD.id OR NEW.invocation_id IS DISTINCT FROM OLD.invocation_id OR
        NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
        NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.pool_key IS DISTINCT FROM OLD.pool_key OR
        NEW.workflow_id IS DISTINCT FROM OLD.workflow_id OR NEW.run_id IS DISTINCT FROM OLD.run_id OR
        NEW.activity_id IS DISTINCT FROM OLD.activity_id OR
        NEW.scheduled_event_id IS DISTINCT FROM OLD.scheduled_event_id OR
        NEW.units IS DISTINCT FROM OLD.units OR NEW.acquired_at IS DISTINCT FROM OLD.acquired_at OR
        NEW.attempt < OLD.attempt OR
        (OLD.state='RELEASED' AND NEW IS DISTINCT FROM OLD) OR
        (OLD.native_release_confirmed_at IS NOT NULL AND
            NEW.native_release_confirmed_at IS DISTINCT FROM OLD.native_release_confirmed_at) OR
        (OLD.terminal_event_id IS NOT NULL AND
            (NEW.terminal_event_id IS DISTINCT FROM OLD.terminal_event_id OR
             NEW.terminal_event_at IS DISTINCT FROM OLD.terminal_event_at))) THEN
        RAISE EXCEPTION 'CapacityLease scope、holder 或终态证据不可替换'
            USING ERRCODE='check_violation';
    END IF;
    PERFORM 1 FROM catalog.agent_invocation i
    JOIN admission.action_execution a ON a.id=i.action_execution_id
    JOIN projection.workflow_ref w ON w.workflow_id=i.workflow_id
    JOIN catalog.action_definition d ON d.action_key=a.action_key AND d.version=a.action_version
    WHERE i.id=NEW.invocation_id AND i.tenant_id=NEW.tenant_id AND i.workspace_id=NEW.workspace_id
      AND a.operation_id=NEW.operation_id AND a.tenant_id=NEW.tenant_id AND a.workspace_id=NEW.workspace_id
      AND w.operation_id=NEW.operation_id AND w.action_execution_id=a.id
      AND w.tenant_id=NEW.tenant_id AND w.workspace_id=NEW.workspace_id
      AND w.workflow_id=NEW.workflow_id AND w.workflow_type='AgentTaskWorkflow' AND w.kind IS NULL
      AND d.capacity_policy='PLATFORM_SLOT' AND d.capacity_pool_key=NEW.pool_key;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'CapacityLease 必须关联同 scope 的 Invocation/Operation/Workflow 与平台池'
            USING ERRCODE='check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP FUNCTION admission.capacity_invocation_unstarted(uuid);
