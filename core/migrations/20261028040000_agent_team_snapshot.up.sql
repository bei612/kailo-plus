-- DD-131(3)、DD-42、03 §4、05 §2.12、06 §7.1：团队快照 buzz-team-snapshot@1 的导出与导入。
-- 两端动作与格式在同一迁移登记（03 §4）。导出审批冻结 Team owner 与各成员 Definition owner 的
-- 去重集合（ALL_AFFECTED_OWNERS，与 Tenant 删除的多 owner 冻结同一机制），每位 owner 各自批准、
-- 本人可自批；导入在一次 RESOURCE_IMPORT 中为每个成员建 Definition 与 DRAFT，再建 agent_team，
-- 任一成员失败整包不提交。成员内联头像按 DD-131(2)(7) 逐个暂存为媒体对象，以包 digest 与成员
-- 序号为键，推进时逐一复核。

-- 1. 上传暂存接受团队格式；团队上限沿原版 JSON 25 MiB、PNG 50 MiB，Agent 上限不变。
--    原上限约束是列/表级匿名 CHECK：按定义在目录中定位后删除，再以显式名称重建。
ALTER TABLE admission.transfer_upload DROP CONSTRAINT transfer_upload_format_enum;
ALTER TABLE admission.transfer_upload ADD CONSTRAINT transfer_upload_format_enum
    CHECK (format_key IN ('buzz-agent-snapshot@1','buzz-team-snapshot@1'));
DO $$
DECLARE c record;
BEGIN
    FOR c IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'admission.transfer_upload'::regclass AND contype = 'c'
          AND (pg_get_constraintdef(oid) LIKE '%10485760%' OR pg_get_constraintdef(oid) LIKE '%5242880%')
    LOOP
        EXECUTE format('ALTER TABLE admission.transfer_upload DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;
ALTER TABLE admission.transfer_upload ADD CONSTRAINT transfer_upload_package_size CHECK (
    package_byte_size > 0 AND package_byte_size <=
        CASE WHEN format_key = 'buzz-team-snapshot@1' THEN 52428800 ELSE 10485760 END);
ALTER TABLE admission.transfer_upload ADD CONSTRAINT transfer_upload_json_size CHECK (
    media_type = 'image/png' OR package_byte_size <=
        CASE WHEN format_key = 'buzz-team-snapshot@1' THEN 26214400 ELSE 5242880 END);
-- 团队包的头像逐成员暂存，不用单头像列。
ALTER TABLE admission.transfer_upload ADD CONSTRAINT transfer_upload_team_avatar_per_member
    CHECK (format_key <> 'buzz-team-snapshot@1' OR avatar_url IS NULL);

CREATE TABLE admission.transfer_upload_member_avatar (
    upload_id uuid NOT NULL REFERENCES admission.transfer_upload(id) ON DELETE CASCADE,
    package_digest text NOT NULL CHECK (package_digest ~ '^[0-9a-f]{64}$'),
    member_index integer NOT NULL CHECK (member_index >= 0 AND member_index < 64),
    avatar_url text NOT NULL,
    avatar_media_sha256 text NOT NULL CHECK (avatar_media_sha256 ~ '^[0-9a-f]{64}$'),
    avatar_source_digest text NOT NULL CHECK (avatar_source_digest ~ '^[0-9a-f]{64}$'),
    PRIMARY KEY (upload_id, member_index),
    CHECK (avatar_url ~ ('/media/' || avatar_media_sha256 || '(\.[A-Za-z0-9]+)?$'))
);

-- 2. agent.team.export 的唯一策略：ALL_AFFECTED_OWNERS、可自批、无角色要求，沿用既有明确 owner
--    审批的时限，不另设默认值。
INSERT INTO catalog.approval_policy
 (id,version,action_key,target_type,role_requirements,owner_requirement,self_approval,expires_in_seconds,status)
SELECT gen_random_uuid(),1,'agent.team.export','RESOURCE','[]','ALL_AFFECTED_OWNERS','ALLOW',
 expires_in_seconds,'ACTIVE'
FROM catalog.approval_policy WHERE action_key='resource.grant_read' AND status='ACTIVE';

INSERT INTO catalog.action_definition
 (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,permission,permission_object_type,
 execution_mode,confirmation_mode,approval_policy_id,approval_policy_version,workflow_type,workflow_kind,
 capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,obs_correlation_mode,
 obs_progress_source,obs_terminal_source,obs_usage_source,obs_cost_source,obs_redaction_policy,status)
SELECT 'agent.team.export',1,'core','RESOURCE','SESSION_TENANT','TENANT_ONLY','export','resource',
 'TEMPORAL','APPROVAL',id,version,'ComponentTaskWorkflow','RESOURCE_EXPORT','NONE',NULL,'NONE','{}','EXPORT',
 'FULL_LIFECYCLE','OPERATION_REF','TEMPORAL','TEMPORAL','NONE','NONE','PLATFORM_METADATA_ONLY','ACTIVE'
FROM catalog.approval_policy WHERE action_key='agent.team.export' AND status='ACTIVE';

-- 3. agent.team.import：与 agent.definition.import 同一策略（Tenant create、EXPLICIT 预览后确认）。
INSERT INTO catalog.action_definition
 (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,permission,permission_object_type,
 execution_mode,confirmation_mode,approval_policy_id,approval_policy_version,workflow_type,workflow_kind,
 capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,obs_correlation_mode,
 obs_progress_source,obs_terminal_source,obs_usage_source,obs_cost_source,obs_redaction_policy,status)
VALUES ('agent.team.import',1,'core','RESOURCE','SESSION_TENANT','TENANT_ONLY','create','tenant',
 'TEMPORAL','EXPLICIT',NULL,NULL,'ComponentTaskWorkflow','RESOURCE_IMPORT','NONE',NULL,'NONE','{}','NONE',
 'FULL_LIFECYCLE','OPERATION_REF','TEMPORAL','TEMPORAL','NONE','NONE','PLATFORM_METADATA_ONLY','ACTIVE');

-- 4. 两端动作都已登记后才登记格式（03 §4）。
INSERT INTO catalog.transfer_format
 (format_key,format_version,resource_type_key,export_action_key,import_action_key,digest_rule,package_media_types,status)
SELECT 'buzz-team-snapshot@1',1,'agent.team','agent.team.export','agent.team.import',
 'SHA256_PACKAGE_BYTES',ARRAY['application/json','image/png'],'ACTIVE'
WHERE (SELECT count(*) FROM catalog.action_definition
       WHERE action_key IN ('agent.team.export','agent.team.import') AND status='ACTIVE') = 2;
