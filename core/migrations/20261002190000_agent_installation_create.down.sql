-- A real intent or Workflow history requires its deployed consumer. Do not
-- silently drop that authority or delete Installation business state on rollback.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM admission.action_execution WHERE action_key='agent.installation.create')
        OR EXISTS (SELECT 1 FROM projection.workflow_ref WHERE kind='AGENT_INSTALLATION')
        OR EXISTS (SELECT 1 FROM catalog.agent_installation) THEN
        RAISE EXCEPTION 'Installation creation facts exist: stop rollback and retain lifecycle consumer';
    END IF;
END $$;
DELETE FROM catalog.action_definition WHERE action_key='agent.installation.create';
UPDATE catalog.resource_type_definition SET status='DRAFT',
    incremental_contracts=jsonb_set(incremental_contracts,'{0,reconciliation_trigger}',
        '"existing ActionExecution and AgentTaskWorkflow observation"'::jsonb)
WHERE type_key='agent.installation';
ALTER TABLE catalog.action_definition DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE catalog.action_definition ADD CONSTRAINT workflow_kind_enum CHECK (workflow_kind IN
    ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
     'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME'));
ALTER TABLE projection.workflow_ref DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE projection.workflow_ref ADD CONSTRAINT workflow_kind_enum CHECK (kind IN
    ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
     'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME'));
