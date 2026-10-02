-- DD-47、03 §8、11 §2：Core 的 PLATFORM_SLOT；不是 native 组件容量账本。
-- pool 行提供串行边界和已接受的配置投影；容量值始终由执行配置投递。
CREATE TABLE admission.capacity_pool (
    pool_key text PRIMARY KEY CHECK (pool_key <> ''),
    capacity_units bigint NOT NULL CHECK (capacity_units > 0)
);
CREATE TABLE admission.capacity_lease (
    id uuid PRIMARY KEY,
    invocation_id uuid NOT NULL UNIQUE REFERENCES catalog.agent_invocation(id),
    operation_id uuid NOT NULL UNIQUE REFERENCES admission.action_execution(operation_id),
    tenant_id uuid NOT NULL REFERENCES identity.tenant(id),
    workspace_id uuid NOT NULL REFERENCES identity.workspace(id),
    pool_key text NOT NULL REFERENCES admission.capacity_pool(pool_key),
    workflow_id text NOT NULL REFERENCES projection.workflow_ref(workflow_id),
    run_id uuid NOT NULL,
    activity_id text NOT NULL CHECK (activity_id <> ''),
    attempt integer NOT NULL CHECK (attempt > 0),
    scheduled_event_id bigint NOT NULL CHECK (scheduled_event_id > 0),
    units bigint NOT NULL CHECK (units > 0),
    acquired_at timestamptz NOT NULL,
    renewed_at timestamptz,
    expires_at timestamptz NOT NULL,
    state text NOT NULL CHECK (state IN ('HELD','RELEASING','RELEASED','EXPIRED','UNKNOWN')),
    native_release_confirmed_at timestamptz,
    terminal_event_id bigint,
    terminal_event_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at > acquired_at),
    CHECK (renewed_at IS NULL OR renewed_at >= acquired_at),
    CHECK ((terminal_event_id IS NULL) = (terminal_event_at IS NULL)),
    CHECK (terminal_event_id IS NULL OR terminal_event_id > scheduled_event_id),
    CHECK (state <> 'RELEASED' OR
        (native_release_confirmed_at IS NOT NULL AND terminal_event_id IS NOT NULL))
);
CREATE INDEX capacity_lease_reconcile ON admission.capacity_lease(updated_at)
    WHERE state <> 'RELEASED';

CREATE FUNCTION admission.guard_capacity_lease() RETURNS trigger AS $$
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
CREATE TRIGGER capacity_lease_guard BEFORE INSERT OR UPDATE ON admission.capacity_lease
    FOR EACH ROW EXECUTE FUNCTION admission.guard_capacity_lease();

-- 只解除平台 slot 禁止；NATIVE 无此 producer，仍不可由 Core 冒充。
ALTER TABLE catalog.action_definition DROP CONSTRAINT capacity_not_yet_enforced;
ALTER TABLE catalog.action_definition ADD CONSTRAINT capacity_not_yet_enforced
    CHECK (capacity_policy IN ('NONE','PLATFORM_SLOT'));
