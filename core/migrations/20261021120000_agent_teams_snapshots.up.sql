-- DD-131(1)-(9)、05 §2.12、03 §3/§5/§7、DD-42：原版 Agents 页的团队、快照导出导入与目录分享。
-- 只登记平台核心 ResourceType agent.team、两种 TransferFormat、ExportPackage Asset 扩展与
-- 本会话上传暂存；不新增运行时、Agent 注册权威或 06 §5 闭集之外的 Workflow kind。

-- 1. agent.team：Tenant 级平台核心 Resource（home_workspace_id=NONE，HUMAN owner），
--    与其他平台核心 ResourceType 同经 tenant.delete 销毁链删除（DD-99）。
INSERT INTO catalog.resource_type_definition
 (type_key,capability_category,capability_contract_version,incremental_contracts,llm_gateway_contract,
  transfer_formats,tenant_delete_action_key,status)
VALUES ('agent.team',NULL,NULL,
 '[{"contract_key":"agent.team@v1","role":"NATIVE_INTERNAL","engine":"NATIVE","stable_key_rule":"catalog.resource.id","revision_rule":"catalog.resource.version","delete_semantics":"agent.team.delete writes the AgentTeam DELETED tombstone and removes its tenant#member grants; Tenant frozen inventory -> SpiceDB relationship deletion -> Core DELETED tombstone","reconciliation_trigger":"governance_reconcile resumes the same ActionExecution projection intent","readiness_semantics":"Resource ACTIVE with no pending projection; FullyConsistent SpiceDB relationships match Tenant and HUMAN owner"}]',
 'NOT_USED',
 '[{"format_key":"buzz-team-snapshot","format_version":1,"export_action_key":"agent.team.export","import_action_key":"agent.team.import","digest_rule":"sha256(package bytes)","package_media_type":["application/json","image/png"]}]',
 'tenant.delete','ACTIVE');

-- 03 §3：当前 Catalog 只为 DD-131 的两类平台核心类型登记成对 TransferFormat。
UPDATE catalog.resource_type_definition SET transfer_formats=
 '[{"format_key":"buzz-agent-snapshot","format_version":1,"export_action_key":"agent.definition.export","import_action_key":"agent.definition.import","digest_rule":"sha256(package bytes)","package_media_type":["application/json","image/png"]}]'
WHERE type_key='agent.definition' AND component_release_id IS NULL;

ALTER TABLE catalog.resource DROP CONSTRAINT resource_type_key_check;
ALTER TABLE catalog.resource DROP CONSTRAINT resource_home_workspace_check;
ALTER TABLE catalog.resource ADD CONSTRAINT resource_type_key_check CHECK
 (application_binding_id IS NOT NULL OR type_key IN
  ('agent.definition','agent.installation','llm_route','automation','tool.definition','agent.team'));
ALTER TABLE catalog.resource ADD CONSTRAINT resource_home_workspace_check CHECK
 (application_binding_id IS NOT NULL OR
  (type_key IN ('agent.definition','tool.definition','agent.team') AND home_workspace_id IS NULL) OR
  (type_key IN ('agent.installation','automation') AND home_workspace_id IS NOT NULL) OR type_key='llm_route');

-- 03 §7 AgentTeam：名称、说明与有序去重成员（同 Tenant AgentDefinition 引用，≤64）。
-- 不含原版团队 instructions；DELETED 是墓碑，不级联删除成员。
CREATE TABLE catalog.agent_team (
    resource_id uuid PRIMARY KEY REFERENCES catalog.resource(id),
    name text NOT NULL CHECK (btrim(name) <> '' AND name = btrim(name) AND char_length(name) <= 200),
    description text CHECK (description IS NULL OR (btrim(description) <> '' AND description = btrim(description)
        AND char_length(description) <= 2000)),
    member_agent_resource_ids uuid[] NOT NULL CHECK (cardinality(member_agent_resource_ids) <= 64
        AND array_position(member_agent_resource_ids, NULL) IS NULL),
    state text NOT NULL CONSTRAINT agent_team_state_check CHECK (state IN ('ACTIVE','DELETED'))
);
CREATE FUNCTION catalog.guard_agent_team() RETURNS trigger AS $$
DECLARE team_tenant uuid;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.resource_id IS DISTINCT FROM OLD.resource_id THEN
        RAISE EXCEPTION 'AgentTeam 的 Resource 不可替换' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.state = 'DELETED' AND NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION '已删除的 AgentTeam 是墓碑，不可改写' USING ERRCODE = 'check_violation';
    END IF;
    SELECT r.tenant_id INTO team_tenant FROM catalog.resource r
    WHERE r.id = NEW.resource_id AND r.type_key = 'agent.team' AND r.home_workspace_id IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'AgentTeam 必须扩展 Tenant 级 agent.team Resource' USING ERRCODE = 'check_violation';
    END IF;
    IF (SELECT count(DISTINCT m) FROM unnest(NEW.member_agent_resource_ids) m)
        <> cardinality(NEW.member_agent_resource_ids) THEN
        RAISE EXCEPTION 'AgentTeam 成员不得重复' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(NEW.member_agent_resource_ids) m
               WHERE NOT EXISTS (SELECT 1 FROM catalog.resource d
                   JOIN catalog.agent_definition a ON a.resource_id = d.id
                   WHERE d.id = m AND d.tenant_id = team_tenant AND d.type_key = 'agent.definition')) THEN
        RAISE EXCEPTION 'AgentTeam 成员必须是同 Tenant 的 AgentDefinition' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER agent_team_guard BEFORE INSERT OR UPDATE ON catalog.agent_team
    FOR EACH ROW EXECUTE FUNCTION catalog.guard_agent_team();

-- 03 §3 ExportPackage：源 Tenant 内 Asset 扩展，父 Resource 是被导出的 Definition 或 Team；
-- owner 是导出发起 HUMAN（DD-42）。字节只在 READY 时可下载，删除/销毁时清空。
ALTER TABLE catalog.asset DROP CONSTRAINT asset_type_key_check;
ALTER TABLE catalog.asset ADD CONSTRAINT asset_type_key_check
    CHECK (type_key IN ('agent.version','automation.version','export.package'));
CREATE TABLE catalog.export_package (
    asset_id uuid PRIMARY KEY REFERENCES catalog.asset(id),
    tenant_id uuid NOT NULL,
    source_resource_id uuid NOT NULL,
    source_asset_id uuid REFERENCES catalog.asset(id),
    source_object_version integer NOT NULL CHECK (source_object_version > 0),
    format_key text NOT NULL CHECK (format_key IN ('buzz-agent-snapshot','buzz-team-snapshot')),
    format_version integer NOT NULL CHECK (format_version = 1),
    encoding text NOT NULL CONSTRAINT agent_snapshot_encoding_enum CHECK (encoding IN ('JSON','PNG')),
    media_type text NOT NULL CHECK ((encoding = 'JSON' AND media_type = 'application/json')
        OR (encoding = 'PNG' AND media_type = 'image/png')),
    file_name text NOT NULL CHECK (file_name ~ '^[^/\\]+\.(agent|team)\.(json|png)$'),
    content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
    byte_size integer NOT NULL CHECK (byte_size > 0),
    content bytea,
    export_operation_id uuid NOT NULL,
    state text NOT NULL CONSTRAINT export_package_state_enum
        CHECK (state IN ('CREATING','READY','REVOKED','DELETED','ERROR')),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, asset_id) REFERENCES catalog.asset(tenant_id, id),
    FOREIGN KEY (tenant_id, source_resource_id) REFERENCES catalog.resource(tenant_id, id),
    CHECK ((state IN ('CREATING','READY')) = (content IS NOT NULL)),
    CHECK (content IS NULL OR octet_length(content) = byte_size),
    CHECK ((format_key = 'buzz-agent-snapshot') = (source_asset_id IS NOT NULL))
);

-- DD-42、05 §2.12：导入只接收同一 PlatformSession 上传的包字节；暂存不是 Resource，
-- 过期或被导入消费后清空字节，只留 digest 作为审计关联。
CREATE TABLE admission.agent_snapshot_upload (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES identity.tenant(id),
    session_id uuid NOT NULL REFERENCES identity.platform_session(id),
    principal_id uuid NOT NULL REFERENCES identity.principal(id),
    snapshot_kind text NOT NULL CONSTRAINT agent_snapshot_kind_enum CHECK (snapshot_kind IN ('AGENT','TEAM')),
    encoding text NOT NULL CONSTRAINT agent_snapshot_encoding_enum CHECK (encoding IN ('JSON','PNG')),
    content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
    byte_size integer NOT NULL CHECK (byte_size > 0),
    content bytea,
    expires_at timestamptz NOT NULL,
    consumed_by_action_execution_id uuid REFERENCES admission.action_execution(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (content IS NULL OR octet_length(content) = byte_size)
);
CREATE INDEX agent_snapshot_upload_expiry ON admission.agent_snapshot_upload(expires_at) WHERE content IS NOT NULL;
CREATE UNIQUE INDEX agent_snapshot_upload_consumer ON admission.agent_snapshot_upload(consumed_by_action_execution_id)
    WHERE consumed_by_action_execution_id IS NOT NULL;

-- 06 §5 闭集中的 RESOURCE_EXPORT/RESOURCE_IMPORT 随首个产出方（DD-131）实现。两张表的约束
-- 与 contracts/enums/workflow_kind 逐值相同。
ALTER TABLE catalog.action_definition DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE catalog.action_definition ADD CONSTRAINT workflow_kind_enum CHECK (workflow_kind IN
 ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
 'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION','COMPONENT_RELEASE',
 'COMPONENT_BINDING','COMPONENT_DISABLE','RESOURCE_PROVISION','PROTOCOL_SESSION_RECONCILE','COMPONENT_ACTION',
 'CONVERSATION_PROJECTION','RESOURCE_EXPORT','RESOURCE_IMPORT'));
ALTER TABLE projection.workflow_ref DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE projection.workflow_ref ADD CONSTRAINT workflow_kind_enum CHECK (kind IN
 ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
 'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION','COMPONENT_RELEASE',
 'COMPONENT_BINDING','COMPONENT_DISABLE','RESOURCE_PROVISION','PROTOCOL_SESSION_RECONCILE','COMPONENT_ACTION',
 'CONVERSATION_PROJECTION','RESOURCE_EXPORT','RESOURCE_IMPORT'));

-- 05 §2.12：导出动作的 ResultExposure 为 EXPORT（结果只是 ExportPackage 引用与 digest）。
-- 平台动作只有这两个键可取 EXPORT。
ALTER TABLE catalog.action_definition DROP CONSTRAINT result_exposure_enum;
ALTER TABLE catalog.action_definition ADD CONSTRAINT result_exposure_enum CHECK (
    result_exposure IN ('NONE','READ')
    OR (component_release_id IS NOT NULL AND result_exposure IN ('CONSUME_ONLY','EXPORT'))
    OR (component_release_id IS NULL AND result_exposure = 'EXPORT'
        AND action_key IN ('agent.definition.export','agent.team.export')));

-- 导出 owner 审批：Definition 导出取目标 owner，团队导出取团队与全部成员定义的不同 owner；
-- 均允许 owner 自批（显式决定，不是自动通过）。时限沿既有职责分离策略。
INSERT INTO catalog.approval_policy
 (id,version,action_key,target_type,role_requirements,owner_requirement,self_approval,expires_in_seconds,status)
SELECT gen_random_uuid(),1,k.action_key,'RESOURCE','[]',k.owner_requirement,'ALLOW',p.expires_in_seconds,'ACTIVE'
FROM (VALUES ('agent.definition.export','TARGET_OWNER'),('agent.team.export','ALL_AFFECTED_OWNERS'))
     k(action_key,owner_requirement)
CROSS JOIN (SELECT expires_in_seconds FROM catalog.approval_policy
            WHERE action_key='tenant.member.revoke' AND status='ACTIVE') p;

-- 05 §2.12 的唯一 ActionDefinition 策略：全部 HUMAN 发起、TENANT_ONLY、quota NONE、
-- FULL_LIFECYCLE；管理动作 SYNC/EXPLICIT，导出 TEMPORAL/APPROVAL，导入 TEMPORAL/EXPLICIT。
INSERT INTO catalog.action_definition
 (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
 permission,permission_object_type,execution_mode,confirmation_mode,approval_policy_id,approval_policy_version,
 workflow_type,workflow_kind,capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,
 obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,obs_cost_source,obs_redaction_policy,status)
SELECT k.action_key,1,'core','RESOURCE','SESSION_TENANT','TENANT_ONLY',k.permission,k.object_type,'SYNC',
 'EXPLICIT',NULL,NULL,NULL,NULL,'NONE',NULL,'NONE','{}','NONE','FULL_LIFECYCLE',
 'OPERATION_REF','NONE','SYNC_RESULT','NONE','NONE','PLATFORM_METADATA_ONLY','ACTIVE'
FROM (VALUES ('agent.team.create','create','tenant'),
             ('agent.team.update','update','resource'),
             ('agent.team.delete','manage','resource'),
             ('agent.team.share','share','resource'),
             ('agent.team.unshare','share','resource'),
             ('agent.definition.share','share','resource'),
             ('agent.definition.unshare','share','resource')) k(action_key,permission,object_type);
INSERT INTO catalog.action_definition
 (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
 permission,permission_object_type,execution_mode,confirmation_mode,approval_policy_id,approval_policy_version,
 workflow_type,workflow_kind,capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,
 obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,obs_cost_source,obs_redaction_policy,status)
SELECT k.action_key,1,'core','RESOURCE','SESSION_TENANT','TENANT_ONLY',k.permission,k.object_type,'TEMPORAL',
 k.confirmation,p.id,p.version,'ComponentTaskWorkflow',k.kind,'NONE',NULL,'NONE','{}',k.exposure,'FULL_LIFECYCLE',
 'OPERATION_REF','TEMPORAL','TEMPORAL','NONE','NONE','PLATFORM_METADATA_ONLY','ACTIVE'
FROM (VALUES ('agent.definition.export','export','resource','APPROVAL','RESOURCE_EXPORT','EXPORT'),
             ('agent.team.export','export','resource','APPROVAL','RESOURCE_EXPORT','EXPORT'),
             ('agent.definition.import','create','tenant','EXPLICIT','RESOURCE_IMPORT','NONE'),
             ('agent.team.import','create','tenant','EXPLICIT','RESOURCE_IMPORT','NONE'))
     k(action_key,permission,object_type,confirmation,kind,exposure)
LEFT JOIN catalog.approval_policy p ON p.action_key=k.action_key AND p.status='ACTIVE';
