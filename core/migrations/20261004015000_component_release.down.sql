DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM catalog.component_release)
     OR EXISTS(SELECT 1 FROM catalog.component_definition)
     OR EXISTS(SELECT 1 FROM admission.action_execution WHERE component_conformance_plan IS NOT NULL)
     OR EXISTS(SELECT 1 FROM projection.workflow_ref WHERE kind='COMPONENT_RELEASE')
     OR EXISTS(SELECT 1 FROM admission.action_execution WHERE action_key='component_release.register')
     OR EXISTS(SELECT 1 FROM catalog.action_definition WHERE workflow_kind='COMPONENT_RELEASE'
               AND (action_key<>'component_release.register' OR version<>1)) THEN
    RAISE EXCEPTION 'component release downgrade would discard immutable evidence' USING ERRCODE='23514';
  END IF;
END $$;
DELETE FROM catalog.action_definition WHERE action_key='component_release.register' AND version=1;
DROP TABLE catalog.component_release;
DROP FUNCTION catalog.guard_component_release();
DROP TABLE catalog.component_definition;
DROP TRIGGER component_conformance_evidence ON admission.action_execution;
DROP FUNCTION admission.guard_component_conformance_evidence();
ALTER TABLE admission.action_execution DROP CONSTRAINT component_conformance_scope,
  DROP COLUMN component_conformance_observation, DROP COLUMN component_conformance_plan;
ALTER TABLE catalog.action_definition DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE catalog.action_definition ADD CONSTRAINT workflow_kind_enum CHECK (workflow_kind IN
  ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
   'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION'));
ALTER TABLE projection.workflow_ref DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE projection.workflow_ref ADD CONSTRAINT workflow_kind_enum CHECK (kind IN
  ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
   'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION'));
