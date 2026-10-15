-- 05 §2.10：Workspace admin/owner 向单个 HUMAN 成员授予或收回 Agent Installation 使用权
-- （reader/executor/delegator 成组写入）。EXPLICIT、无审批，与原 execute.revoke 同一
-- Resource share 准入、SYNC 投影与 FULL_LIFECYCLE 审计；不改变既有定义或关系。
INSERT INTO catalog.action_definition
 (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
 permission,permission_object_type,execution_mode,confirmation_mode,approval_policy_id,approval_policy_version,
 workflow_type,workflow_kind,capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,
 obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,obs_cost_source,obs_redaction_policy,status)
SELECT k.action_key,1,'core','RESOURCE','SESSION_TENANT','TARGET_HOME_WORKSPACE','share','resource','SYNC',
 'EXPLICIT',NULL,NULL,NULL,NULL,'NONE',NULL,'NONE','{}','NONE','FULL_LIFECYCLE',
 'OPERATION_REF','NONE','SYNC_RESULT','NONE','NONE','PLATFORM_METADATA_ONLY','ACTIVE'
FROM (VALUES ('agent.installation.use.grant'),('agent.installation.use.revoke')) k(action_key);
