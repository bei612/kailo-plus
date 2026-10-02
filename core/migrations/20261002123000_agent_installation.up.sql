-- DD-25/50/66/67、03 §7、17 §6、19：每个 Workspace 安装拥有独立运行身份。
-- 无默认身份、默认版本或 ACTIVE 种子；运行查证与 Task 消费同一组事实。
ALTER TABLE catalog.resource DROP CONSTRAINT resource_type_key_check;
ALTER TABLE catalog.resource DROP CONSTRAINT resource_home_workspace_id_check;
ALTER TABLE catalog.resource ADD CONSTRAINT resource_type_key_check
    CHECK (type_key IN ('agent.definition','agent.installation'));
ALTER TABLE catalog.resource ADD CONSTRAINT resource_home_workspace_check
    CHECK ((type_key='agent.definition') = (home_workspace_id IS NULL));
INSERT INTO catalog.resource_type_definition VALUES
    ('agent.installation',NULL,NULL,
     '[{"contract_key":"agent.installation@v1","role":"NATIVE_INTERNAL","engine":"NATIVE","stable_key_rule":"catalog.resource.id","revision_rule":"catalog.resource.version and active_projection_generation","delete_semantics":"drain Invocation and retire native projections before Resource DELETED","reconciliation_trigger":"existing ActionExecution and AgentTaskWorkflow observation","readiness_semantics":"fresh SpiceDB Workspace and Resource projection, native roster, Memory binding and exact runtime generation all agree"}]',
     'REQUIRED','[]','tenant.delete','DRAFT');

CREATE TABLE catalog.agent_installation (
    resource_id uuid PRIMARY KEY REFERENCES catalog.resource(id),
    workspace_id uuid NOT NULL REFERENCES identity.workspace(id),
    agent_resource_id uuid NOT NULL REFERENCES catalog.agent_definition(resource_id),
    pinned_version_asset_id uuid NOT NULL REFERENCES catalog.agent_version(asset_id),
    agent_principal_id uuid NOT NULL UNIQUE REFERENCES identity.principal(id),
    runtime_isolation_ref text NOT NULL UNIQUE CHECK (length(runtime_isolation_ref)>0),
    state text NOT NULL CONSTRAINT agent_installation_state_enum CHECK
        (state IN ('PROVISIONING','ACTIVE','DRAINING','DISABLED','ERROR')),
    active_projection_generation bigint CHECK (active_projection_generation>0),
    CHECK (state<>'ACTIVE' OR active_projection_generation IS NOT NULL)
);

CREATE FUNCTION catalog.guard_agent_installation_scope() RETURNS trigger AS $$
BEGIN
    PERFORM 1 FROM catalog.resource r
    JOIN identity.workspace w ON w.id=NEW.workspace_id AND w.tenant_id=r.tenant_id
    JOIN catalog.resource d ON d.id=NEW.agent_resource_id AND d.tenant_id=r.tenant_id
    JOIN catalog.agent_version v ON v.asset_id=NEW.pinned_version_asset_id
        AND v.agent_resource_id=d.id
    JOIN catalog.asset a ON a.id=v.asset_id AND a.tenant_id=r.tenant_id
    JOIN identity.principal p ON p.id=NEW.agent_principal_id
        AND p.tenant_id=r.tenant_id AND p.kind='AGENT'
    WHERE r.id=NEW.resource_id AND r.type_key='agent.installation'
        AND r.home_workspace_id=w.id AND d.type_key='agent.definition';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Installation、Version、Workspace、AGENT Principal 必须同 Tenant'
            USING ERRCODE='check_violation';
    END IF;
    IF TG_OP='UPDATE' AND (NEW.resource_id IS DISTINCT FROM OLD.resource_id
        OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
        OR NEW.agent_resource_id IS DISTINCT FROM OLD.agent_resource_id
        OR NEW.agent_principal_id IS DISTINCT FROM OLD.agent_principal_id
        OR NEW.runtime_isolation_ref IS DISTINCT FROM OLD.runtime_isolation_ref) THEN
        RAISE EXCEPTION 'Installation 的 scope 与独立身份不可原地替换'
            USING ERRCODE='check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER agent_installation_scope_guard BEFORE INSERT OR UPDATE
    ON catalog.agent_installation FOR EACH ROW
    EXECUTE FUNCTION catalog.guard_agent_installation_scope();

CREATE TABLE catalog.agent_runtime_projection (
    installation_resource_id uuid NOT NULL REFERENCES catalog.agent_installation(resource_id),
    generation bigint NOT NULL CHECK (generation>0),
    agent_version_asset_id uuid NOT NULL REFERENCES catalog.agent_version(asset_id),
    runtime_profile_key text NOT NULL CHECK (length(runtime_profile_key)>0),
    model_route_resource_id uuid NOT NULL REFERENCES catalog.resource(id),
    gateway_resource_ids uuid[] NOT NULL,
    skill_root_ref text,
    effective_fields jsonb NOT NULL CHECK (jsonb_typeof(effective_fields)='array'),
    config_hash text NOT NULL CHECK (config_hash ~ '^[0-9a-f]{64}$'),
    state text NOT NULL CONSTRAINT agent_runtime_projection_state_enum
        CHECK (state IN ('PENDING','ACTIVE','ERROR','REVOKED')),
    PRIMARY KEY (installation_resource_id,generation)
);
ALTER TABLE catalog.agent_installation ADD CONSTRAINT agent_installation_active_generation
    FOREIGN KEY (resource_id,active_projection_generation)
    REFERENCES catalog.agent_runtime_projection(installation_resource_id,generation)
    DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION catalog.guard_agent_runtime_projection() RETURNS trigger AS $$
DECLARE
    field_index integer;
    old_field jsonb;
    new_field jsonb;
BEGIN
    PERFORM 1 FROM catalog.agent_installation i
    JOIN catalog.resource r ON r.id=i.resource_id
    JOIN catalog.agent_version v ON v.asset_id=NEW.agent_version_asset_id
        AND v.agent_resource_id=i.agent_resource_id
    JOIN catalog.asset a ON a.id=v.asset_id AND a.tenant_id=r.tenant_id
    JOIN catalog.resource model ON model.id=NEW.model_route_resource_id
        AND model.tenant_id=r.tenant_id AND model.type_key='llm_route'
        AND (model.home_workspace_id IS NULL OR model.home_workspace_id=i.workspace_id)
    WHERE i.resource_id=NEW.installation_resource_id
      AND NEW.runtime_profile_key=v.content->>'runtimeProfileKey'
      AND NEW.model_route_resource_id::text=v.content->>'modelRouteResourceId';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'runtime projection 必须来自同 scope 的精确 Version/model route'
            USING ERRCODE='check_violation';
    END IF;
    IF TG_OP='UPDATE' AND (NEW.installation_resource_id IS DISTINCT FROM OLD.installation_resource_id
        OR NEW.generation IS DISTINCT FROM OLD.generation
        OR NEW.agent_version_asset_id IS DISTINCT FROM OLD.agent_version_asset_id
        OR NEW.runtime_profile_key IS DISTINCT FROM OLD.runtime_profile_key
        OR NEW.model_route_resource_id IS DISTINCT FROM OLD.model_route_resource_id
        OR NEW.gateway_resource_ids IS DISTINCT FROM OLD.gateway_resource_ids
        OR NEW.skill_root_ref IS DISTINCT FROM OLD.skill_root_ref) THEN
        RAISE EXCEPTION 'runtime generation 内容不可原地改写，须建立新 generation'
            USING ERRCODE='check_violation';
    END IF;
    IF TG_OP='UPDATE' AND (NEW.effective_fields IS DISTINCT FROM OLD.effective_fields
        OR NEW.config_hash IS DISTINCT FROM OLD.config_hash) THEN
        -- One initial materialization, after native readback. It cannot change
        -- requested values/source/field order, or rewrite any previously effective field.
        IF OLD.state<>'PENDING' OR NEW.state<>'PENDING'
            OR jsonb_array_length(OLD.effective_fields)=0
            OR jsonb_array_length(NEW.effective_fields)<>jsonb_array_length(OLD.effective_fields)
            OR NEW.config_hash=OLD.config_hash THEN
            RAISE EXCEPTION 'effective 只可在固定 PENDING generation 一次核验收敛'
                USING ERRCODE='check_violation';
        END IF;
        FOR field_index IN 0..jsonb_array_length(OLD.effective_fields)-1 LOOP
            old_field := OLD.effective_fields->field_index;
            new_field := NEW.effective_fields->field_index;
            IF jsonb_typeof(old_field) IS DISTINCT FROM 'object'
                OR jsonb_typeof(new_field) IS DISTINCT FROM 'object'
                OR old_field->'effectiveValueHash' IS DISTINCT FROM 'null'::jsonb
                OR old_field->>'reasonCode' IS DISTINCT FROM 'PROJECTION_FAILED'
                OR jsonb_typeof(old_field->'requestedValueHash') IS DISTINCT FROM 'string'
                OR old_field->>'requestedValueHash' !~ '^[0-9a-f]{64}$'
                OR (new_field-'effectiveValueHash'-'reasonCode')
                    IS DISTINCT FROM (old_field-'effectiveValueHash'-'reasonCode')
                OR ((new_field->'effectiveValueHash'=old_field->'requestedValueHash'
                        AND new_field->'reasonCode'='null'::jsonb)
                    OR (new_field->'effectiveValueHash'='null'::jsonb
                        AND new_field->>'reasonCode'='NOT_SUPPORTED_BY_RUNTIME')) IS NOT TRUE THEN
                RAISE EXCEPTION 'effective 收敛不得改变 requested/source 或重写既有核验值'
                    USING ERRCODE='check_violation';
            END IF;
        END LOOP;
        IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.effective_fields) f
            WHERE jsonb_typeof(f->'effectiveValueHash')='string') THEN
            RAISE EXCEPTION 'effective 收敛必须包含已查证字段'
                USING ERRCODE='check_violation';
        END IF;
    END IF;
    IF NEW.state='ACTIVE' AND (cardinality(NEW.gateway_resource_ids)=0
        OR jsonb_array_length(NEW.effective_fields)=0
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.effective_fields) f
            WHERE jsonb_typeof(f->'effectiveValueHash') IS DISTINCT FROM 'string'
                OR f->'effectiveValueHash' IS DISTINCT FROM f->'requestedValueHash'
                OR f->'reasonCode' IS DISTINCT FROM 'null'::jsonb)) THEN
        RAISE EXCEPTION 'ACTIVE runtime projection 不得缺少 Gateway 与 effective 字段证据'
            USING ERRCODE='check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER agent_runtime_projection_guard BEFORE INSERT OR UPDATE
    ON catalog.agent_runtime_projection FOR EACH ROW
    EXECUTE FUNCTION catalog.guard_agent_runtime_projection();

CREATE TABLE catalog.channel_agent_binding (
    workspace_id uuid NOT NULL REFERENCES identity.workspace(id),
    installation_resource_id uuid PRIMARY KEY REFERENCES catalog.agent_installation(resource_id),
    triggers text[] NOT NULL CHECK (cardinality(triggers)>0
        AND triggers <@ ARRAY['MENTION','MANUAL_ASSIGNMENT']::text[]),
    status text NOT NULL CHECK (status IN ('ACTIVE','DISABLED','ERROR'))
);

CREATE TABLE catalog.agent_memory_binding (
    installation_resource_id uuid PRIMARY KEY REFERENCES catalog.agent_installation(resource_id),
    agent_buzz_identity_binding_id text NOT NULL UNIQUE REFERENCES identity.buzz_identity_binding(pubkey),
    memory_counterparty_buzz_identity_binding_id text NOT NULL REFERENCES identity.buzz_identity_binding(pubkey),
    core_head_event_id text,
    core_head_created_at bigint,
    listing_state text NOT NULL CHECK (listing_state IN ('COMPLETE','BOUND_EXCEEDED','UNKNOWN')),
    head_state text NOT NULL CHECK (head_state IN ('CONSISTENT','HEAD_AHEAD_OF_RELAY','UNKNOWN')),
    state text NOT NULL CONSTRAINT agent_memory_binding_state_enum
        CHECK (state IN ('PROVISIONING','ACTIVE','ERROR','REVOKED')),
    version integer NOT NULL CHECK (version>0),
    CHECK ((core_head_event_id IS NULL) = (core_head_created_at IS NULL)),
    CHECK (core_head_event_id IS NULL OR core_head_event_id ~ '^[0-9a-f]{64}$'),
    CHECK (agent_buzz_identity_binding_id<>memory_counterparty_buzz_identity_binding_id),
    CHECK (state<>'ACTIVE' OR (listing_state='COMPLETE' AND head_state='CONSISTENT'))
);

CREATE FUNCTION catalog.guard_agent_binding_scope() RETURNS trigger AS $$
BEGIN
    IF TG_TABLE_NAME='channel_agent_binding' THEN
        PERFORM 1 FROM catalog.agent_installation i
        WHERE i.resource_id=NEW.installation_resource_id AND i.workspace_id=NEW.workspace_id;
    ELSE
        PERFORM 1 FROM catalog.agent_installation i
        JOIN catalog.resource r ON r.id=i.resource_id
        JOIN identity.buzz_identity_binding a ON a.pubkey=NEW.agent_buzz_identity_binding_id
            AND a.tenant_id=r.tenant_id AND a.principal_id=i.agent_principal_id
            AND a.kind='AGENT' AND a.custody='SERVER'
        JOIN projection.tenant_buzz_binding t ON t.tenant_id=r.tenant_id
        JOIN identity.buzz_identity_binding c ON c.pubkey=NEW.memory_counterparty_buzz_identity_binding_id
            AND c.tenant_id=r.tenant_id AND c.principal_id=t.control_service_principal_id
            AND c.kind='CONTROL' AND c.custody='SERVER'
        WHERE i.resource_id=NEW.installation_resource_id;
    END IF;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Agent Channel/Memory binding 不得跨 scope 或共享身份'
            USING ERRCODE='check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER channel_agent_binding_scope_guard BEFORE INSERT OR UPDATE
    ON catalog.channel_agent_binding FOR EACH ROW EXECUTE FUNCTION catalog.guard_agent_binding_scope();
CREATE TRIGGER agent_memory_binding_scope_guard BEFORE INSERT OR UPDATE
    ON catalog.agent_memory_binding FOR EACH ROW EXECUTE FUNCTION catalog.guard_agent_binding_scope();
