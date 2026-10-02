-- DD-24/25/45/47、03 §4/§7、17 §3/§6：Version 是 Definition Resource 下的 Asset。
-- 不登记 RuntimeProfile、LLM Route、Installation 或运行就绪假对象。
CREATE TABLE catalog.asset (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES identity.tenant(id),
    resource_id uuid NOT NULL,
    type_key text NOT NULL,
    owner_principal_id uuid NOT NULL REFERENCES identity.principal(id),
    producer_principal_id uuid REFERENCES identity.principal(id),
    native_ref text NOT NULL,
    state text NOT NULL,
    version integer NOT NULL CHECK (version > 0),
    projection_action_execution_id uuid REFERENCES admission.action_execution(id),
    UNIQUE (tenant_id,id),
    FOREIGN KEY (tenant_id,resource_id) REFERENCES catalog.resource(tenant_id,id),
    CHECK (type_key='agent.version'),
    CHECK (native_ref=id::text)
);
CREATE INDEX asset_owner ON catalog.asset(tenant_id,owner_principal_id);
CREATE TRIGGER agent_asset_owner_guard BEFORE INSERT OR UPDATE OF owner_principal_id
    ON catalog.asset FOR EACH ROW EXECUTE FUNCTION catalog.guard_agent_resource_owner();

CREATE TABLE catalog.agent_version (
    asset_id uuid PRIMARY KEY REFERENCES catalog.asset(id),
    agent_resource_id uuid NOT NULL REFERENCES catalog.agent_definition(resource_id),
    ordinal integer NOT NULL CHECK (ordinal > 0),
    content jsonb NOT NULL CHECK (jsonb_typeof(content)='object'),
    config_hash text NOT NULL,
    state text NOT NULL CONSTRAINT agent_version_state_enum
        CHECK (state IN ('DRAFT','PUBLISHED','RETIRED')),
    UNIQUE (agent_resource_id,ordinal)
);
CREATE FUNCTION catalog.guard_agent_version() RETURNS trigger AS $$
BEGIN
    IF TG_OP='INSERT' OR NEW.asset_id IS DISTINCT FROM OLD.asset_id
        OR NEW.agent_resource_id IS DISTINCT FROM OLD.agent_resource_id THEN
        PERFORM 1 FROM catalog.asset a
        JOIN catalog.resource r ON r.id=a.resource_id AND r.tenant_id=a.tenant_id
        WHERE a.id=NEW.asset_id AND r.id=NEW.agent_resource_id
          AND r.type_key='agent.definition'
          AND (a.producer_principal_id IS NULL OR EXISTS (
              SELECT 1 FROM identity.principal p
              WHERE p.id=a.producer_principal_id AND p.tenant_id=a.tenant_id));
        IF NOT FOUND THEN
            RAISE EXCEPTION 'AgentVersion 与 Asset、Definition、producer 必须同 Tenant'
                USING ERRCODE='check_violation';
        END IF;
    END IF;
    IF TG_OP='UPDATE' AND OLD.state <> 'DRAFT' AND (
        NEW.content IS DISTINCT FROM OLD.content OR
        NEW.config_hash IS DISTINCT FROM OLD.config_hash OR
        NEW.asset_id IS DISTINCT FROM OLD.asset_id OR
        NEW.agent_resource_id IS DISTINCT FROM OLD.agent_resource_id OR
        NEW.ordinal IS DISTINCT FROM OLD.ordinal OR
        (OLD.state='PUBLISHED' AND NEW.state NOT IN ('PUBLISHED','RETIRED')) OR
        (OLD.state='RETIRED' AND NEW.state <> 'RETIRED')) THEN
        RAISE EXCEPTION '已发布 AgentVersion 内容不可变'
            USING ERRCODE='check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER agent_version_guard BEFORE INSERT OR UPDATE ON catalog.agent_version
    FOR EACH ROW EXECUTE FUNCTION catalog.guard_agent_version();

-- 原首刀明确禁止 published pointer；只解除这条确切旧约束，保留其它防线。
ALTER TABLE catalog.agent_definition DROP CONSTRAINT agent_definition_current_published_version_asset_id_check;
ALTER TABLE catalog.agent_definition ADD CONSTRAINT agent_definition_published_asset
    FOREIGN KEY (current_published_version_asset_id) REFERENCES catalog.agent_version(asset_id);
CREATE FUNCTION catalog.guard_agent_published_pointer() RETURNS trigger AS $$
BEGIN
    IF NEW.current_published_version_asset_id IS NOT NULL THEN
        PERFORM 1 FROM catalog.agent_version v JOIN catalog.asset a ON a.id=v.asset_id
        WHERE v.asset_id=NEW.current_published_version_asset_id
          AND v.agent_resource_id=NEW.resource_id AND v.state='PUBLISHED'
          AND a.state='PUBLISHED' AND a.projection_action_execution_id IS NULL;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Definition pointer 只能引用自己的已发布且投影闭合的 Version'
                USING ERRCODE='check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER agent_published_pointer_guard BEFORE INSERT OR UPDATE OF current_published_version_asset_id
    ON catalog.agent_definition FOR EACH ROW EXECUTE FUNCTION catalog.guard_agent_published_pointer();
