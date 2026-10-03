-- DD-24/25/45、03 §4/§7、05 §2.8、17 §8/§10：退役仅收缩新安装。
-- 复用原 HUMAN Action/Asset manage；不删除历史，不改变任何 Installation pin。
INSERT INTO catalog.action_definition
    (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
     permission,permission_object_type,execution_mode,confirmation_mode,
     approval_policy_id,approval_policy_version,workflow_type,workflow_kind,
     capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,
     obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,
     obs_cost_source,obs_redaction_policy,status)
VALUES ('agent.version.retire',1,'core','ASSET','SESSION_TENANT','TARGET_HOME_WORKSPACE',
        'manage','asset','SYNC','EXPLICIT',NULL,NULL,NULL,NULL,
        'NONE',NULL,'NONE','{}'::text[],'NONE','FULL_LIFECYCLE',
        'OPERATION_REF','NONE','SYNC_RESULT','NONE','NONE','PLATFORM_METADATA_ONLY','ACTIVE');
