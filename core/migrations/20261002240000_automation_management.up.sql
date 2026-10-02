-- REQ-23、DD-99/107、05 §2.9：只登记已有Relay管理consumer；不开放Schedule/Webhook/运行入口。
-- Automation库存冻结/Version退役/Resource墓碑与管理producer同构建交付。
UPDATE catalog.resource_type_definition SET status='ACTIVE'
WHERE type_key='automation' AND status='DRAFT' AND tenant_delete_action_key='tenant.delete';

INSERT INTO catalog.action_definition
    (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
     permission,permission_object_type,execution_mode,confirmation_mode,
     approval_policy_id,approval_policy_version,workflow_type,workflow_kind,
     capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,
     obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,
     obs_cost_source,obs_redaction_policy,status)
SELECT key,1,'core','RESOURCE','SESSION_TENANT',
       CASE WHEN key='automation.create' THEN 'WORKSPACE_REQUIRED' ELSE 'TARGET_HOME_WORKSPACE' END,
       CASE WHEN key='automation.create' THEN 'create' ELSE 'manage' END,
       CASE WHEN key='automation.create' THEN 'workspace' ELSE 'resource' END,
       'SYNC','EXPLICIT',NULL,NULL,NULL,NULL,'NONE',NULL,'NONE','{}','NONE','FULL_LIFECYCLE',
       'OPERATION_REF','NONE','SYNC_RESULT','NONE','NONE','PLATFORM_METADATA_ONLY','ACTIVE'
FROM (VALUES ('automation.create'),('automation.publish_version'),('automation.enable'),
             ('automation.pause'),('automation.disable')) AS actions(key);
