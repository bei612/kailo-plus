-- DD-25/48/50/66/99; 03 §5/7, 06 §3/4, 17 §6/7. Management creation
-- does not enable trigger/turn admission or assert a RuntimeProfile ACTIVE.
ALTER TABLE catalog.action_definition DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE catalog.action_definition ADD CONSTRAINT workflow_kind_enum CHECK (workflow_kind IN
    ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
     'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION'));
ALTER TABLE projection.workflow_ref DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE projection.workflow_ref ADD CONSTRAINT workflow_kind_enum CHECK (kind IN
    ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
     'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION'));

UPDATE catalog.resource_type_definition SET status='ACTIVE',
    incremental_contracts=jsonb_set(incremental_contracts,'{0,reconciliation_trigger}',
        '"existing admitted AGENT_INSTALLATION WorkflowRef/run and ActionExecution"'::jsonb)
WHERE type_key='agent.installation' AND status='DRAFT';

INSERT INTO catalog.action_definition
    (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
     permission,permission_object_type,execution_mode,confirmation_mode,
     approval_policy_id,approval_policy_version,workflow_type,workflow_kind,
     capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,
     obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,
     obs_cost_source,obs_redaction_policy,status)
VALUES ('agent.installation.create',1,'core','RESOURCE','SESSION_TENANT','WORKSPACE_REQUIRED',
    'create','workspace','TEMPORAL','NONE',NULL,NULL,'ComponentTaskWorkflow','AGENT_INSTALLATION',
    'NONE',NULL,'NONE','{}','NONE','FULL_LIFECYCLE','OPERATION_REF','TEMPORAL','TEMPORAL',
    'NONE','NONE','PLATFORM_METADATA_ONLY','ACTIVE');
