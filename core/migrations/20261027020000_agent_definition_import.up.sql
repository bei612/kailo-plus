-- DD-131(2)、DD-143、DD-42、05 §2.12、06 §7.1：agent.definition.import 与本会话快照上传暂存。
-- 导入是目标 Tenant 的 ComponentTaskWorkflow(kind=RESOURCE_IMPORT)：只读本会话上传的包字节并重算
-- digest，创建新 AgentDefinition 与一个 DRAFT AgentVersion，不发布、不安装。TransferFormat 的
-- 登记须同时绑定导出端（03 §4），随 agent.definition.export 一并登记。

ALTER TABLE catalog.action_definition DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE catalog.action_definition ADD CONSTRAINT workflow_kind_enum CHECK (workflow_kind IN
 ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
 'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION','COMPONENT_RELEASE',
 'COMPONENT_BINDING','COMPONENT_DISABLE','RESOURCE_PROVISION','COMPONENT_ACTION','CONVERSATION_PROJECTION',
 'RESOURCE_IMPORT'));
ALTER TABLE projection.workflow_ref DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE projection.workflow_ref ADD CONSTRAINT workflow_kind_enum CHECK (kind IN
 ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
 'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION','COMPONENT_RELEASE',
 'COMPONENT_BINDING','COMPONENT_DISABLE','RESOURCE_PROVISION','PROTOCOL_SESSION_RECONCILE','COMPONENT_ACTION',
 'CONVERSATION_PROJECTION','RESOURCE_IMPORT'));

-- 上传只为同一 PlatformSession、本人暂存一次性包字节；不是 Resource 或 Asset。原版上限：
-- JSON 5 MiB、PNG 10 MiB。过期或 Workflow 到终态后清空字节，digest 与大小作为历史保留。
CREATE TABLE admission.transfer_upload (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES identity.tenant(id),
    session_id uuid NOT NULL REFERENCES identity.platform_session(id),
    principal_id uuid NOT NULL REFERENCES identity.principal(id),
    format_key text NOT NULL CONSTRAINT transfer_upload_format_enum
        CHECK (format_key IN ('buzz-agent-snapshot@1')),
    media_type text NOT NULL CONSTRAINT transfer_upload_media_type_enum
        CHECK (media_type IN ('application/json','image/png')),
    package bytea,
    package_digest text NOT NULL CHECK (package_digest ~ '^[0-9a-f]{64}$'),
    package_byte_size integer NOT NULL CHECK (package_byte_size > 0 AND package_byte_size <= 10485760),
    expires_at timestamptz NOT NULL,
    consumed_by_action_execution_id uuid REFERENCES admission.action_execution(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (package IS NULL OR octet_length(package) = package_byte_size),
    CHECK (media_type = 'image/png' OR package_byte_size <= 5242880)
);
CREATE INDEX transfer_upload_expiry ON admission.transfer_upload(expires_at)
    WHERE package IS NOT NULL;
CREATE UNIQUE INDEX transfer_upload_consumer
    ON admission.transfer_upload(consumed_by_action_execution_id)
    WHERE consumed_by_action_execution_id IS NOT NULL;

-- 05 §2.12 的唯一策略：Tenant `create`、TENANT_ONLY、TEMPORAL、EXPLICIT（预览后确认）；新 Definition
-- 的 owner 即导入人，指定他人为 owner 的审批分支不开放。Capacity/quota NONE、meters 空、
-- ResultExposure NONE、FULL_LIFECYCLE、观测终态取 Workflow。
INSERT INTO catalog.action_definition
 (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,permission,permission_object_type,
 execution_mode,confirmation_mode,approval_policy_id,approval_policy_version,workflow_type,workflow_kind,
 capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,obs_correlation_mode,
 obs_progress_source,obs_terminal_source,obs_usage_source,obs_cost_source,obs_redaction_policy,status)
VALUES ('agent.definition.import',1,'core','RESOURCE','SESSION_TENANT','TENANT_ONLY','create','tenant',
 'TEMPORAL','EXPLICIT',NULL,NULL,'ComponentTaskWorkflow','RESOURCE_IMPORT','NONE',NULL,'NONE','{}','NONE',
 'FULL_LIFECYCLE','OPERATION_REF','TEMPORAL','TEMPORAL','NONE','NONE','PLATFORM_METADATA_ONLY','ACTIVE');
