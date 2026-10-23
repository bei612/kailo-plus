-- DD-42、DD-131(2)(7)、03 §3/§4、05 §2.3/§2.12、06 §7.1：通用 RESOURCE_EXPORT 与 Agent 快照导出。
-- 导出是源 Tenant 的 ComponentTaskWorkflow(kind=RESOURCE_EXPORT)：在 owner 批准后按登记的
-- TransferFormat 由 Core 生成 ExportPackage Asset 并冻结 digest；字节只经下载路由给当前对该
-- Asset 有 read 的 HUMAN，不进入 Workflow 历史、审计或任何跨 Tenant 关系。

ALTER TABLE catalog.action_definition DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE catalog.action_definition ADD CONSTRAINT workflow_kind_enum CHECK (workflow_kind IN
 ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
 'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION','COMPONENT_RELEASE',
 'COMPONENT_BINDING','COMPONENT_DISABLE','RESOURCE_PROVISION','COMPONENT_ACTION','CONVERSATION_PROJECTION',
 'RESOURCE_IMPORT','RESOURCE_EXPORT'));
ALTER TABLE projection.workflow_ref DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE projection.workflow_ref ADD CONSTRAINT workflow_kind_enum CHECK (kind IN
 ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
 'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION','COMPONENT_RELEASE',
 'COMPONENT_BINDING','COMPONENT_DISABLE','RESOURCE_PROVISION','PROTOCOL_SESSION_RECONCILE','COMPONENT_ACTION',
 'CONVERSATION_PROJECTION','RESOURCE_IMPORT','RESOURCE_EXPORT'));

-- 05 §2.12：导出动作的 ResultExposure 为 EXPORT（结果只是 ExportPackage 的 Asset 引用与 digest）。
-- 只对 Core 自己的 RESOURCE_EXPORT 开放，不放宽任何组件动作。
-- 取值闭集（与 contracts/enums/result_exposure 逐值相等）与作用域规则分成两条约束。
ALTER TABLE catalog.action_definition DROP CONSTRAINT result_exposure_enum;
ALTER TABLE catalog.action_definition ADD CONSTRAINT result_exposure_enum CHECK (
    result_exposure IN ('NONE','READ','CONSUME_ONLY','EXPORT'));
ALTER TABLE catalog.action_definition ADD CONSTRAINT result_exposure_scope CHECK (
    result_exposure IN ('NONE','READ')
    OR (component_release_id IS NOT NULL AND result_exposure IN ('CONSUME_ONLY','EXPORT'))
    OR (component_release_id IS NULL AND component_type_key = 'core'
        AND workflow_kind = 'RESOURCE_EXPORT' AND result_exposure = 'EXPORT'));

-- 03 §3：ExportPackage 是源 Tenant 内的 Asset 扩展，挂在来源 Resource 下，owner 为发起导出的 HUMAN。
ALTER TABLE catalog.asset DROP CONSTRAINT asset_type_key_check;
ALTER TABLE catalog.asset ADD CONSTRAINT asset_type_key_check
    CHECK (type_key IN ('agent.version','automation.version','skill.version','export.package'));

-- 03 §4 TransferFormat：一个格式必须同时绑定已登记的 RESOURCE_EXPORT 与 RESOURCE_IMPORT 动作；
-- 缺任一端不能登记。digest 规则固定为包字节 SHA-256。
CREATE TABLE catalog.transfer_format (
    format_key text PRIMARY KEY,
    format_version integer NOT NULL CHECK (format_version > 0),
    resource_type_key text NOT NULL,
    export_action_key text NOT NULL,
    import_action_key text NOT NULL,
    digest_rule text NOT NULL CHECK (digest_rule = 'SHA256_PACKAGE_BYTES'),
    package_media_types text[] NOT NULL CHECK (cardinality(package_media_types) > 0
        AND package_media_types <@ ARRAY['application/json','image/png']),
    status text NOT NULL CHECK (status IN ('ACTIVE','RETIRED')),
    CHECK (export_action_key <> import_action_key)
);

CREATE TABLE catalog.export_package (
    asset_id uuid PRIMARY KEY REFERENCES catalog.asset(id),
    tenant_id uuid NOT NULL,
    source_resource_id uuid NOT NULL,
    source_asset_id uuid REFERENCES catalog.asset(id),
    source_object_version integer NOT NULL CHECK (source_object_version > 0),
    format_key text NOT NULL REFERENCES catalog.transfer_format(format_key),
    media_type text NOT NULL CHECK (media_type IN ('application/json','image/png')),
    export_action_execution_id uuid NOT NULL UNIQUE REFERENCES admission.action_execution(id),
    export_operation_id uuid NOT NULL,
    state text NOT NULL CONSTRAINT export_package_state_enum
        CHECK (state IN ('CREATING','READY','REVOKED','DELETED','ERROR')),
    package bytea,
    content_digest text CHECK (content_digest ~ '^[0-9a-f]{64}$'),
    byte_size integer CHECK (byte_size > 0 AND byte_size <= 52428800),
    file_name text CHECK (file_name IS NULL OR (btrim(file_name) <> '' AND char_length(file_name) <= 255)),
    created_at timestamptz NOT NULL DEFAULT now(),
    ready_at timestamptz,
    FOREIGN KEY (tenant_id, asset_id) REFERENCES catalog.asset(tenant_id, id),
    FOREIGN KEY (tenant_id, source_resource_id) REFERENCES catalog.resource(tenant_id, id),
    -- READY 才有字节与 digest；其余状态不留字节（DELETED/ERROR 只保留历史 digest）。
    CHECK (state <> 'READY' OR (package IS NOT NULL AND content_digest IS NOT NULL
        AND byte_size IS NOT NULL AND file_name IS NOT NULL AND ready_at IS NOT NULL)),
    CHECK (state = 'READY' OR package IS NULL),
    CHECK (package IS NULL OR octet_length(package) = byte_size),
    CHECK (media_type = 'image/png' OR byte_size IS NULL OR byte_size <= 26214400)
);
CREATE INDEX export_package_source ON catalog.export_package(tenant_id, source_resource_id);

-- 05 §2.12：agent.definition.export 的唯一策略。owner 审批（TARGET_OWNER，可自批），沿用既有
-- 明确 owner 审批的时限，不另设默认值。
INSERT INTO catalog.approval_policy
 (id,version,action_key,target_type,role_requirements,owner_requirement,self_approval,expires_in_seconds,status)
SELECT gen_random_uuid(),1,'agent.definition.export','RESOURCE','[]','TARGET_OWNER','ALLOW',
 expires_in_seconds,'ACTIVE'
FROM catalog.approval_policy WHERE action_key='resource.grant_read' AND status='ACTIVE';

INSERT INTO catalog.action_definition
 (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,permission,permission_object_type,
 execution_mode,confirmation_mode,approval_policy_id,approval_policy_version,workflow_type,workflow_kind,
 capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,obs_correlation_mode,
 obs_progress_source,obs_terminal_source,obs_usage_source,obs_cost_source,obs_redaction_policy,status)
SELECT 'agent.definition.export',1,'core','RESOURCE','SESSION_TENANT','TENANT_ONLY','export','resource',
 'TEMPORAL','APPROVAL',id,version,'ComponentTaskWorkflow','RESOURCE_EXPORT','NONE',NULL,'NONE','{}','EXPORT',
 'FULL_LIFECYCLE','OPERATION_REF','TEMPORAL','TEMPORAL','NONE','NONE','PLATFORM_METADATA_ONLY','ACTIVE'
FROM catalog.approval_policy WHERE action_key='agent.definition.export' AND status='ACTIVE';

-- 两端动作都已登记后才登记格式（03 §4）。
INSERT INTO catalog.transfer_format
 (format_key,format_version,resource_type_key,export_action_key,import_action_key,digest_rule,package_media_types,status)
SELECT 'buzz-agent-snapshot@1',1,'agent.definition','agent.definition.export','agent.definition.import',
 'SHA256_PACKAGE_BYTES',ARRAY['application/json','image/png'],'ACTIVE'
WHERE (SELECT count(*) FROM catalog.action_definition
       WHERE action_key IN ('agent.definition.export','agent.definition.import') AND status='ACTIVE') = 2;
