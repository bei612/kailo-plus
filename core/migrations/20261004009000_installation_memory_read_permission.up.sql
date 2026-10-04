-- 05 §2.8、19 §5：reader 只经原受治理关系生产；ToolBinding 不授业务 read。
-- 复用已有明确 owner 审批的时限，不另设审批超时默认值。
INSERT INTO catalog.approval_policy
 (id,version,action_key,target_type,role_requirements,owner_requirement,self_approval,expires_in_seconds,status)
SELECT gen_random_uuid(),1,'resource.grant_read','RESOURCE','[]','TARGET_OWNER','ALLOW',
 expires_in_seconds,'ACTIVE'
FROM catalog.approval_policy WHERE action_key='agent.installation.execute.grant' AND status='ACTIVE';

INSERT INTO catalog.action_definition
 (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
 permission,permission_object_type,execution_mode,confirmation_mode,approval_policy_id,approval_policy_version,
 workflow_type,workflow_kind,capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,
 obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,obs_cost_source,obs_redaction_policy,status)
SELECT k.action_key,1,'core','RESOURCE','SESSION_TENANT','TARGET_HOME_WORKSPACE','share','resource','SYNC',
 CASE WHEN k.action_key='resource.grant_read' THEN 'APPROVAL' ELSE 'EXPLICIT' END,
 p.id,p.version,NULL,NULL,'NONE',NULL,'NONE','{}','NONE','FULL_LIFECYCLE',
 'OPERATION_REF','NONE','SYNC_RESULT','NONE','NONE','PLATFORM_METADATA_ONLY','ACTIVE'
FROM (VALUES ('resource.grant_read'),('resource.revoke_read')) k(action_key)
LEFT JOIN catalog.approval_policy p ON p.action_key=k.action_key AND p.status='ACTIVE';
