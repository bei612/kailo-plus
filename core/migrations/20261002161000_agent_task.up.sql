-- DD-47/48/65、03 §7、06 §6：Session/Invocation 保存原生引用；Temporal 是执行权威。
-- 前置：同批 AgentInstallation migration 已成功；停止发布条件是任何 scope FK 不成立。
CREATE TABLE catalog.agent_session (
    tenant_id uuid NOT NULL REFERENCES identity.tenant(id),
    workspace_id uuid NOT NULL REFERENCES identity.workspace(id),
    root_event_id text NOT NULL CHECK (root_event_id ~ '^[0-9a-f]{64}$'),
    installation_resource_id uuid NOT NULL REFERENCES catalog.agent_installation(resource_id),
    agent_version_asset_id uuid NOT NULL REFERENCES catalog.agent_version(asset_id),
    projection_generation bigint NOT NULL CHECK (projection_generation > 0),
    runtime_thread_id text,
    core_memory_state text NOT NULL CHECK (core_memory_state IN ('FOUND','ABSENT','UNREADABLE')),
    core_memory_event_id text CHECK (core_memory_event_id ~ '^[0-9a-f]{64}$'),
    status text NOT NULL CHECK (status IN ('PENDING','STARTING','ACTIVE','UNKNOWN','CLOSED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id,root_event_id,installation_resource_id),
    UNIQUE (installation_resource_id,runtime_thread_id),
    CHECK ((core_memory_state='FOUND') = (core_memory_event_id IS NOT NULL)),
    CHECK (status <> 'ACTIVE' OR runtime_thread_id IS NOT NULL),
    FOREIGN KEY (installation_resource_id,projection_generation)
        REFERENCES catalog.agent_runtime_projection(installation_resource_id,generation)
);
CREATE TABLE catalog.agent_invocation (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES identity.tenant(id),
    workspace_id uuid NOT NULL,
    root_event_id text NOT NULL,
    source_event_id text NOT NULL CHECK (source_event_id ~ '^[0-9a-f]{64}$'),
    installation_resource_id uuid NOT NULL,
    agent_version_asset_id uuid NOT NULL REFERENCES catalog.agent_version(asset_id),
    projection_generation bigint NOT NULL CHECK (projection_generation > 0),
    parent_invocation_id uuid REFERENCES catalog.agent_invocation(id),
    delegation_id uuid,
    automation_version_asset_id uuid,
    action_execution_id uuid NOT NULL UNIQUE REFERENCES admission.action_execution(id),
    workflow_id text NOT NULL UNIQUE,
    runtime_turn_id text,
    native_status text,
    reply_event_id text CHECK (reply_event_id ~ '^[0-9a-f]{64}$'),
    status text NOT NULL CHECK (status IN ('CREATED','DISPATCHING','RUNNING','UNKNOWN','COMPLETED','FAILED','CANCELED')),
    cancel_pending boolean NOT NULL DEFAULT false,
    observation_cursor text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id,source_event_id,installation_resource_id),
    FOREIGN KEY (workspace_id,root_event_id,installation_resource_id)
        REFERENCES catalog.agent_session(workspace_id,root_event_id,installation_resource_id),
    CHECK (status <> 'COMPLETED' OR
        (native_status IS NOT DISTINCT FROM 'completed' AND reply_event_id IS NOT NULL)),
    CHECK (status <> 'CANCELED' OR native_status IS NOT DISTINCT FROM 'interrupted')
);
CREATE FUNCTION catalog.guard_agent_task_scope() RETURNS trigger AS $$
BEGIN
    IF TG_OP='UPDATE' AND (
        NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
        NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR
        NEW.root_event_id IS DISTINCT FROM OLD.root_event_id OR
        NEW.installation_resource_id IS DISTINCT FROM OLD.installation_resource_id OR
        NEW.agent_version_asset_id IS DISTINCT FROM OLD.agent_version_asset_id OR
        NEW.projection_generation IS DISTINCT FROM OLD.projection_generation) THEN
        RAISE EXCEPTION 'Session/Invocation 的 scope 与版本/generation 已冻结'
            USING ERRCODE='check_violation';
    END IF;
    IF TG_TABLE_NAME='agent_session' THEN
        IF TG_OP='UPDATE' AND OLD.runtime_thread_id IS NOT NULL
            AND NEW.runtime_thread_id IS DISTINCT FROM OLD.runtime_thread_id THEN
            RAISE EXCEPTION 'Session 不得替换已绑定的 native thread'
                USING ERRCODE='check_violation';
        END IF;
    END IF;
    PERFORM 1 FROM catalog.agent_installation i
    JOIN catalog.resource r ON r.id=i.resource_id
    JOIN identity.workspace w ON w.id=i.workspace_id
    JOIN catalog.asset a ON a.id=NEW.agent_version_asset_id
    JOIN catalog.agent_version v ON v.asset_id=a.id
    JOIN catalog.agent_runtime_projection p ON p.installation_resource_id=i.resource_id
      AND p.generation=NEW.projection_generation AND p.agent_version_asset_id=a.id
    WHERE i.resource_id=NEW.installation_resource_id AND i.workspace_id=NEW.workspace_id
      AND r.tenant_id=NEW.tenant_id AND w.tenant_id=NEW.tenant_id AND a.tenant_id=NEW.tenant_id
      AND v.agent_resource_id=i.agent_resource_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Agent task 的 Installation、Workspace、Version 必须同 Tenant'
            USING ERRCODE='check_violation';
    END IF;
    IF TG_TABLE_NAME='agent_invocation' THEN
        IF TG_OP='UPDATE' AND (
            NEW.source_event_id IS DISTINCT FROM OLD.source_event_id OR
            NEW.action_execution_id IS DISTINCT FROM OLD.action_execution_id OR
            NEW.workflow_id IS DISTINCT FROM OLD.workflow_id OR
            NEW.parent_invocation_id IS DISTINCT FROM OLD.parent_invocation_id OR
            NEW.delegation_id IS DISTINCT FROM OLD.delegation_id OR
            NEW.automation_version_asset_id IS DISTINCT FROM OLD.automation_version_asset_id OR
            (OLD.runtime_turn_id IS NOT NULL AND NEW.runtime_turn_id IS DISTINCT FROM OLD.runtime_turn_id)) THEN
            RAISE EXCEPTION 'Invocation 的触发/Workflow/native turn 引用已冻结'
                USING ERRCODE='check_violation';
        END IF;
        PERFORM 1 FROM catalog.agent_session s
        JOIN admission.action_execution ae ON ae.id=NEW.action_execution_id
        WHERE s.workspace_id=NEW.workspace_id AND s.root_event_id=NEW.root_event_id
          AND s.installation_resource_id=NEW.installation_resource_id
          AND s.tenant_id=NEW.tenant_id AND s.agent_version_asset_id=NEW.agent_version_asset_id
          AND s.projection_generation=NEW.projection_generation
          AND ae.tenant_id=NEW.tenant_id AND ae.workspace_id=NEW.workspace_id
          AND (NEW.parent_invocation_id IS NULL OR EXISTS (
              SELECT 1 FROM catalog.agent_invocation p WHERE p.id=NEW.parent_invocation_id
                AND p.tenant_id=NEW.tenant_id AND p.workspace_id=NEW.workspace_id));
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Invocation 与 Session/Action/parent 必须同 scope 与冻结版本'
                USING ERRCODE='check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER agent_session_scope_guard BEFORE INSERT OR UPDATE
    ON catalog.agent_session FOR EACH ROW EXECUTE FUNCTION catalog.guard_agent_task_scope();
CREATE TRIGGER agent_invocation_scope_guard BEFORE INSERT OR UPDATE
    ON catalog.agent_invocation FOR EACH ROW EXECUTE FUNCTION catalog.guard_agent_task_scope();
