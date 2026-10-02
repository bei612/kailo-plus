-- DD-13/70/71/99：只保存原生版本/摘要与受治理子投影的 SecretRef，不保存模型正文。
-- 前置：Installation migration；停止发布：Gateway 删除处理器与该类型不能同构建登记。
-- 因本迁移不开放公开 Route Action，类型保持 DRAFT，不能从人工 Gateway 导入 ACTIVE。
ALTER TABLE catalog.resource DROP CONSTRAINT resource_type_key_check;
ALTER TABLE catalog.resource DROP CONSTRAINT resource_home_workspace_check;
ALTER TABLE catalog.resource ADD CONSTRAINT resource_type_key_check
    CHECK (type_key IN ('agent.definition','agent.installation','llm_route'));
ALTER TABLE catalog.resource ADD CONSTRAINT resource_home_workspace_check
    CHECK ((type_key='agent.definition' AND home_workspace_id IS NULL)
        OR (type_key='agent.installation' AND home_workspace_id IS NOT NULL)
        OR type_key='llm_route');

INSERT INTO catalog.resource_type_definition VALUES
    ('llm_route',NULL,NULL,
     '[{"contract_key":"llm_route@v1","role":"NATIVE_INTERNAL","engine":"NATIVE","stable_key_rule":"catalog.resource.id","revision_rule":"AgentGateway ConfigResource revision/hash","delete_semantics":"Tenant frozen inventory -> delete native model/key projections -> read absence -> Core DELETED tombstone","reconciliation_trigger":"existing projection ActionExecution resumes native readback; unknown key create never replays","readiness_semantics":"Core Resource and fully consistent owner projection; exact native revision/hash; controlled credential readback"}]',
     'REQUIRED','[]','tenant.delete','DRAFT');

CREATE TABLE catalog.model_route (
    resource_id uuid PRIMARY KEY REFERENCES catalog.resource(id),
    action_execution_id uuid NOT NULL REFERENCES admission.action_execution(id),
    native_revision bigint NOT NULL CHECK (native_revision>0),
    native_config_hash text NOT NULL CHECK (native_config_hash ~ '^[0-9a-f]{64}$')
);
CREATE FUNCTION catalog.guard_model_route_scope() RETURNS trigger AS $$
BEGIN
    PERFORM 1 FROM catalog.resource r
    JOIN admission.action_execution a ON a.id=NEW.action_execution_id
      AND a.tenant_id=r.tenant_id AND a.target_id=r.id
    WHERE r.id=NEW.resource_id AND r.type_key='llm_route'
      AND r.application_binding_id IS NULL AND r.native_id=r.id::text;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Model route 必须来自同 scope 的受治理 Resource projection'
            USING ERRCODE='check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER model_route_scope_guard BEFORE INSERT OR UPDATE
    ON catalog.model_route FOR EACH ROW EXECUTE FUNCTION catalog.guard_model_route_scope();

CREATE TABLE catalog.agent_model_binding (
    installation_resource_id uuid NOT NULL,
    projection_generation bigint NOT NULL,
    model_route_resource_id uuid NOT NULL REFERENCES catalog.model_route(resource_id),
    action_execution_id uuid NOT NULL REFERENCES admission.action_execution(id),
    gateway_principal_id uuid NOT NULL UNIQUE REFERENCES identity.service_principal(principal_id),
    secret_locator text NOT NULL UNIQUE CHECK (length(secret_locator)>0),
    secret_version integer CHECK (secret_version>0),
    secret_audience text NOT NULL CHECK (length(secret_audience)>0),
    secret_status text NOT NULL CHECK (secret_status IN ('PENDING','ACTIVE','SUPERSEDED','REVOKED')),
    native_dispatch_started boolean NOT NULL DEFAULT false,
    native_key_id text UNIQUE,
    native_key_revision bigint CHECK (native_key_revision>0),
    PRIMARY KEY (installation_resource_id,projection_generation),
    FOREIGN KEY (installation_resource_id,projection_generation)
        REFERENCES catalog.agent_runtime_projection(installation_resource_id,generation),
    CHECK ((native_key_id IS NULL)=(native_key_revision IS NULL)),
    CHECK (NOT native_dispatch_started OR secret_version IS NOT NULL),
    CHECK (native_key_id IS NULL OR (length(native_key_id)>0 AND native_dispatch_started)),
    CHECK (secret_status<>'ACTIVE' OR (secret_version IS NOT NULL AND native_key_id IS NOT NULL))
);
CREATE FUNCTION catalog.guard_agent_model_binding_scope() RETURNS trigger AS $$
BEGIN
    PERFORM 1 FROM catalog.agent_installation i
    JOIN catalog.resource ir ON ir.id=i.resource_id
    JOIN catalog.agent_runtime_projection p ON p.installation_resource_id=i.resource_id
      AND p.generation=NEW.projection_generation AND p.model_route_resource_id=NEW.model_route_resource_id
    JOIN catalog.resource m ON m.id=NEW.model_route_resource_id AND m.tenant_id=ir.tenant_id
      AND m.type_key='llm_route' AND (m.home_workspace_id IS NULL OR m.home_workspace_id=i.workspace_id)
    JOIN admission.action_execution a ON a.id=NEW.action_execution_id
      AND a.tenant_id=ir.tenant_id AND a.workspace_id=i.workspace_id AND a.target_id=i.resource_id
    JOIN identity.principal gp ON gp.id=NEW.gateway_principal_id
      AND gp.tenant_id=ir.tenant_id AND gp.kind='SERVICE'
    WHERE i.resource_id=NEW.installation_resource_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Model credential 不得跨 Tenant、Workspace、Installation 或 projection'
            USING ERRCODE='check_violation';
    END IF;
    IF TG_OP='UPDATE' AND (NEW.installation_resource_id IS DISTINCT FROM OLD.installation_resource_id
        OR NEW.projection_generation IS DISTINCT FROM OLD.projection_generation
        OR NEW.model_route_resource_id IS DISTINCT FROM OLD.model_route_resource_id
        OR NEW.action_execution_id IS DISTINCT FROM OLD.action_execution_id
        OR NEW.gateway_principal_id IS DISTINCT FROM OLD.gateway_principal_id
        OR NEW.secret_locator IS DISTINCT FROM OLD.secret_locator
        OR NEW.secret_audience IS DISTINCT FROM OLD.secret_audience
        OR (OLD.secret_version IS NOT NULL AND NEW.secret_version IS DISTINCT FROM OLD.secret_version)
        OR (OLD.native_key_id IS NOT NULL AND
            (NEW.native_key_id IS DISTINCT FROM OLD.native_key_id
             OR NEW.native_key_revision IS DISTINCT FROM OLD.native_key_revision))
        OR (OLD.secret_status='ACTIVE' AND NEW.secret_status='PENDING')
        OR (OLD.secret_status='SUPERSEDED' AND NEW.secret_status NOT IN ('SUPERSEDED','REVOKED'))
        OR (OLD.secret_status='REVOKED' AND NEW.secret_status<>'REVOKED')
        OR (OLD.native_dispatch_started AND NOT NEW.native_dispatch_started)) THEN
        RAISE EXCEPTION 'Model credential 的冻结归属与 dispatch fence 不可原地改变'
            USING ERRCODE='check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER agent_model_binding_scope_guard BEFORE INSERT OR UPDATE
    ON catalog.agent_model_binding FOR EACH ROW EXECUTE FUNCTION catalog.guard_agent_model_binding_scope();
