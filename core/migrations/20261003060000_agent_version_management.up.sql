-- DD-24/25/65、03 §4/§7、17 §6/§7：复用已有 Version Semantic 与统一 /actions。
-- 只登记 HUMAN 管理目录；不创建 Route/Profile、业务 Asset 或运行身份。
INSERT INTO catalog.action_definition
    (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
     permission,permission_object_type,execution_mode,confirmation_mode,
     approval_policy_id,approval_policy_version,workflow_type,workflow_kind,
     capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,
     obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,
     obs_cost_source,obs_redaction_policy,status)
SELECT action_key,1,'core',target_type,'SESSION_TENANT','TARGET_HOME_WORKSPACE',
       permission,permission_object_type,'SYNC',confirmation_mode,
       NULL,NULL,NULL,NULL,'NONE',NULL,'NONE','{}'::text[],'NONE','FULL_LIFECYCLE',
       'OPERATION_REF','NONE','SYNC_RESULT','NONE','NONE','PLATFORM_METADATA_ONLY','ACTIVE'
FROM (VALUES
    ('agent.version.create','RESOURCE','create','resource','NONE'),
    ('agent.version.update','ASSET','update','asset','NONE'),
    ('agent.version.publish','ASSET','manage','asset','EXPLICIT')
) AS actions(action_key,target_type,permission,permission_object_type,confirmation_mode);
