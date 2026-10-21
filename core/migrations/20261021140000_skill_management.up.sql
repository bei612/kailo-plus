-- DD-135、05 §2.14、03 §7、17 §5：Skills 管理。Tenant 级平台核心 ResourceType skill.definition、
-- 不可变 skill.version Asset（artifact kailo-skill@1 = 一个规范 SKILL.md）与本会话一次性上传暂存。
-- 不新增 Workflow kind、运行时、授权权威或 meter；全部动作 SYNC、HUMAN-only、无审批。

-- 1. skill.definition：Tenant 级（home_workspace_id=NONE、HUMAN owner），与其他平台核心
--    ResourceType 同经 tenant.delete 销毁链删除（DD-99）。不登记 TransferFormat。
INSERT INTO catalog.resource_type_definition
 (type_key,capability_category,capability_contract_version,incremental_contracts,llm_gateway_contract,
  transfer_formats,tenant_delete_action_key,status)
VALUES ('skill.definition',NULL,NULL,
 '[{"contract_key":"skill.definition@v1","role":"NATIVE_INTERNAL","engine":"NATIVE","stable_key_rule":"catalog.resource.id","revision_rule":"catalog.resource.version plus immutable SkillVersion Assets","delete_semantics":"skill.definition.disable is an irreversible DISABLED state; Tenant frozen inventory -> SpiceDB relationship deletion -> Core DELETED tombstone with artifact bytes cleared","reconciliation_trigger":"governance_reconcile resumes the same ActionExecution projection intent","readiness_semantics":"Resource ACTIVE with no pending projection; FullyConsistent SpiceDB relationships match Tenant and HUMAN owner"}]',
 'NOT_USED','[]','tenant.delete','ACTIVE');

ALTER TABLE catalog.resource DROP CONSTRAINT resource_type_key_check;
ALTER TABLE catalog.resource DROP CONSTRAINT resource_home_workspace_check;
ALTER TABLE catalog.resource ADD CONSTRAINT resource_type_key_check CHECK
 (application_binding_id IS NOT NULL OR type_key IN
  ('agent.definition','agent.installation','llm_route','automation','tool.definition','skill.definition'));
ALTER TABLE catalog.resource ADD CONSTRAINT resource_home_workspace_check CHECK
 (application_binding_id IS NOT NULL OR
  (type_key IN ('agent.definition','tool.definition','skill.definition') AND home_workspace_id IS NULL) OR
  (type_key IN ('agent.installation','automation') AND home_workspace_id IS NOT NULL) OR type_key='llm_route');

-- 2. SkillDefinition：slug 即 Codex skill 名（≤64、小写字母数字连字符，首尾字母或数字，
--    SF-COD-18），同 Tenant 未删除定义内唯一且不可改写。DISABLED 不可逆。
CREATE TABLE catalog.skill_definition (
    resource_id uuid PRIMARY KEY REFERENCES catalog.resource(id),
    tenant_id uuid NOT NULL,
    stable_slug text NOT NULL CHECK (stable_slug ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
    display_name text NOT NULL CHECK (btrim(display_name) <> '' AND display_name = btrim(display_name)
        AND char_length(display_name) <= 200),
    current_published_version_asset_id uuid,
    status text NOT NULL CONSTRAINT skill_definition_status_enum
        CHECK (status IN ('PROVISIONING','ACTIVE','DISABLED','DELETED')),
    FOREIGN KEY (tenant_id, resource_id) REFERENCES catalog.resource(tenant_id, id)
);
CREATE UNIQUE INDEX skill_definition_slug ON catalog.skill_definition(tenant_id, stable_slug)
    WHERE status <> 'DELETED';
CREATE FUNCTION catalog.guard_skill_definition() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' OR NEW.resource_id IS DISTINCT FROM OLD.resource_id
        OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
        PERFORM 1 FROM catalog.resource r
        WHERE r.id = NEW.resource_id AND r.tenant_id = NEW.tenant_id
          AND r.type_key = 'skill.definition' AND r.home_workspace_id IS NULL;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'SkillDefinition 必须扩展同 Tenant 的 Tenant 级 skill.definition Resource'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.stable_slug IS DISTINCT FROM OLD.stable_slug
        OR NEW.resource_id IS DISTINCT FROM OLD.resource_id
        OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
        OR (OLD.status = 'DELETED' AND NEW IS DISTINCT FROM OLD)
        OR (OLD.status = 'DISABLED' AND NEW.status NOT IN ('DISABLED','DELETED'))
        OR (OLD.status = 'ACTIVE' AND NEW.status = 'PROVISIONING')) THEN
        RAISE EXCEPTION 'SkillDefinition 的 slug 与 Resource 不可改写，DISABLED 不可逆'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER skill_definition_guard BEFORE INSERT OR UPDATE ON catalog.skill_definition
    FOR EACH ROW EXECUTE FUNCTION catalog.guard_skill_definition();

-- 3. SkillVersion：Asset 扩展，创建即冻结 artifact 与元数据；状态只沿 DRAFT→PUBLISHED→RETIRED
--    前进（生命周期取值与 AgentVersion 同一封闭枚举）。artifact 字节只在 Tenant 销毁时清空。
ALTER TABLE catalog.asset DROP CONSTRAINT asset_type_key_check;
ALTER TABLE catalog.asset ADD CONSTRAINT asset_type_key_check
    CHECK (type_key IN ('agent.version','automation.version','skill.version'));
CREATE TABLE catalog.skill_version (
    asset_id uuid PRIMARY KEY REFERENCES catalog.asset(id),
    tenant_id uuid NOT NULL,
    skill_resource_id uuid NOT NULL REFERENCES catalog.skill_definition(resource_id),
    ordinal integer NOT NULL CHECK (ordinal > 0),
    skill_name text NOT NULL,
    description text NOT NULL CHECK (btrim(description) <> '' AND char_length(description) <= 1024),
    short_description text CHECK (short_description IS NULL
        OR (btrim(short_description) <> '' AND char_length(short_description) <= 1024)),
    artifact_format text NOT NULL CHECK (artifact_format = 'kailo-skill@1'),
    artifact bytea,
    artifact_digest text NOT NULL CHECK (artifact_digest ~ '^[0-9a-f]{64}$'),
    artifact_byte_size integer NOT NULL CHECK (artifact_byte_size > 0 AND artifact_byte_size <= 65536),
    metadata_hash text NOT NULL CHECK (metadata_hash ~ '^[0-9a-f]{64}$'),
    capability_requirements text[] NOT NULL CHECK (array_position(capability_requirements, NULL) IS NULL),
    upload_digest text NOT NULL CHECK (upload_digest ~ '^[0-9a-f]{64}$'),
    state text NOT NULL CONSTRAINT agent_version_state_enum
        CHECK (state IN ('DRAFT','PUBLISHED','RETIRED')),
    UNIQUE (skill_resource_id, ordinal),
    FOREIGN KEY (tenant_id, asset_id) REFERENCES catalog.asset(tenant_id, id),
    CHECK (artifact IS NULL OR octet_length(artifact) = artifact_byte_size)
);
CREATE FUNCTION catalog.guard_skill_version() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM 1 FROM catalog.asset a
        JOIN catalog.resource r ON r.id = a.resource_id AND r.tenant_id = a.tenant_id
        JOIN catalog.skill_definition d ON d.resource_id = r.id
        WHERE a.id = NEW.asset_id AND a.tenant_id = NEW.tenant_id AND a.type_key = 'skill.version'
          AND r.id = NEW.skill_resource_id AND r.type_key = 'skill.definition'
          AND d.stable_slug = NEW.skill_name AND NEW.artifact IS NOT NULL;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'SkillVersion 必须是同 Tenant skill.definition 下的 Asset，名称等于 slug'
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.asset_id IS DISTINCT FROM OLD.asset_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
        OR NEW.skill_resource_id IS DISTINCT FROM OLD.skill_resource_id
        OR NEW.ordinal IS DISTINCT FROM OLD.ordinal OR NEW.skill_name IS DISTINCT FROM OLD.skill_name
        OR NEW.description IS DISTINCT FROM OLD.description
        OR NEW.short_description IS DISTINCT FROM OLD.short_description
        OR NEW.artifact_format IS DISTINCT FROM OLD.artifact_format
        OR NEW.artifact_digest IS DISTINCT FROM OLD.artifact_digest
        OR NEW.artifact_byte_size IS DISTINCT FROM OLD.artifact_byte_size
        OR NEW.metadata_hash IS DISTINCT FROM OLD.metadata_hash
        OR NEW.capability_requirements IS DISTINCT FROM OLD.capability_requirements
        OR NEW.upload_digest IS DISTINCT FROM OLD.upload_digest
        OR (OLD.state = 'PUBLISHED' AND NEW.state NOT IN ('PUBLISHED','RETIRED'))
        OR (OLD.state = 'RETIRED' AND NEW.state <> 'RETIRED')
        OR (NEW.artifact IS DISTINCT FROM OLD.artifact AND NOT (NEW.artifact IS NULL AND EXISTS (
            SELECT 1 FROM catalog.asset a WHERE a.id = NEW.asset_id AND a.state = 'DELETED'))) THEN
        RAISE EXCEPTION 'SkillVersion 的 artifact 与元数据创建即冻结，状态只能前进'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER skill_version_guard BEFORE INSERT OR UPDATE ON catalog.skill_version
    FOR EACH ROW EXECUTE FUNCTION catalog.guard_skill_version();

ALTER TABLE catalog.skill_definition ADD CONSTRAINT skill_definition_published_asset
    FOREIGN KEY (current_published_version_asset_id) REFERENCES catalog.skill_version(asset_id);
CREATE FUNCTION catalog.guard_skill_published_pointer() RETURNS trigger AS $$
BEGIN
    IF NEW.current_published_version_asset_id IS NOT NULL THEN
        PERFORM 1 FROM catalog.skill_version v JOIN catalog.asset a ON a.id = v.asset_id
        WHERE v.asset_id = NEW.current_published_version_asset_id
          AND v.skill_resource_id = NEW.resource_id AND v.state = 'PUBLISHED'
          AND a.state = 'PUBLISHED' AND a.projection_action_execution_id IS NULL;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Skill 发布指针只能引用自己的已发布且投影闭合的版本'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER skill_published_pointer_guard BEFORE INSERT OR UPDATE OF current_published_version_asset_id
    ON catalog.skill_definition FOR EACH ROW EXECUTE FUNCTION catalog.guard_skill_published_pointer();

-- 4. DD-135(3)：上传只为同一 PlatformSession、本人、指定定义暂存一次性输入；不是 Resource
--    或 Asset。只保存规范 artifact 与校验出的元数据，过期或被消费后清空字节。
CREATE TABLE admission.skill_artifact_upload (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES identity.tenant(id),
    session_id uuid NOT NULL REFERENCES identity.platform_session(id),
    principal_id uuid NOT NULL REFERENCES identity.principal(id),
    skill_resource_id uuid NOT NULL,
    encoding text NOT NULL CONSTRAINT skill_artifact_encoding_enum
        CHECK (encoding IN ('SKILL_MD','TAR','TAR_GZIP')),
    upload_digest text NOT NULL CHECK (upload_digest ~ '^[0-9a-f]{64}$'),
    upload_byte_size integer NOT NULL CHECK (upload_byte_size > 0 AND upload_byte_size <= 1048576),
    artifact bytea,
    artifact_digest text NOT NULL CHECK (artifact_digest ~ '^[0-9a-f]{64}$'),
    artifact_byte_size integer NOT NULL CHECK (artifact_byte_size > 0 AND artifact_byte_size <= 65536),
    skill_name text NOT NULL,
    description text NOT NULL,
    short_description text,
    expires_at timestamptz NOT NULL,
    consumed_by_action_execution_id uuid REFERENCES admission.action_execution(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, skill_resource_id) REFERENCES catalog.resource(tenant_id, id),
    CHECK (artifact IS NULL OR octet_length(artifact) = artifact_byte_size)
);
CREATE INDEX skill_artifact_upload_expiry ON admission.skill_artifact_upload(expires_at)
    WHERE artifact IS NOT NULL;
CREATE UNIQUE INDEX skill_artifact_upload_consumer
    ON admission.skill_artifact_upload(consumed_by_action_execution_id)
    WHERE consumed_by_action_execution_id IS NOT NULL;

-- 5. 05 §2.14 的唯一 ActionDefinition 策略：TENANT_ONLY、SYNC、EXPLICIT、无审批，
--    quota NONE、meters 空、ResultExposure NONE、FULL_LIFECYCLE。
INSERT INTO catalog.action_definition
 (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
 permission,permission_object_type,execution_mode,confirmation_mode,approval_policy_id,approval_policy_version,
 workflow_type,workflow_kind,capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,
 obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,obs_cost_source,obs_redaction_policy,status)
SELECT k.action_key,1,'core',k.target_type,'SESSION_TENANT','TENANT_ONLY',k.permission,k.object_type,'SYNC',
 'EXPLICIT',NULL,NULL,NULL,NULL,'NONE',NULL,'NONE','{}','NONE','FULL_LIFECYCLE',
 'OPERATION_REF','NONE','SYNC_RESULT','NONE','NONE','PLATFORM_METADATA_ONLY','ACTIVE'
FROM (VALUES ('skill.definition.create','RESOURCE','create','tenant'),
             ('skill.version.create','RESOURCE','create','resource'),
             ('skill.version.publish','ASSET','manage','asset'),
             ('skill.version.retire','ASSET','manage','asset'),
             ('skill.definition.disable','RESOURCE','manage','resource'),
             ('skill.definition.share','RESOURCE','share','resource'),
             ('skill.definition.unshare','RESOURCE','share','resource'))
     k(action_key,target_type,permission,object_type);
