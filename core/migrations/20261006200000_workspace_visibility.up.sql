-- DD-80: product discovery belongs to Core; Relay channels remain private.
-- Existing workspaces remain private. No membership or content is copied.
ALTER TABLE identity.workspace ADD COLUMN visibility text NOT NULL DEFAULT 'private'
  CHECK (visibility IN ('open','private'));

INSERT INTO catalog.action_definition
 (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,permission,permission_object_type,
 execution_mode,confirmation_mode,approval_policy_id,approval_policy_version,workflow_type,workflow_kind,
 capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,obs_correlation_mode,
 obs_progress_source,obs_terminal_source,obs_usage_source,obs_cost_source,obs_redaction_policy,status)
VALUES ('workspace.join',1,'core','WORKSPACE_MEMBERSHIP','SESSION_TENANT','WORKSPACE_REQUIRED','discover','tenant',
 'TEMPORAL','NONE',NULL,NULL,'ComponentTaskWorkflow','MEMBERSHIP_PROJECTION',
 'NONE',NULL,'NONE','{}','NONE','FULL_LIFECYCLE','OPERATION_REF','TEMPORAL','TEMPORAL','NONE','NONE','IDS_ONLY','ACTIVE');
