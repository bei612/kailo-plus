DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM catalog.resource WHERE reference_provision IS NOT NULL)
 OR EXISTS(SELECT 1 FROM admission.action_execution WHERE action_key='resource.create') THEN
  RAISE EXCEPTION 'resource reference facts must remain readable' USING ERRCODE='23001';
 END IF;
END $$;
DELETE FROM catalog.action_definition WHERE action_key='resource.create' AND component_release_id IS NULL;
DROP TRIGGER resource_reference_guard ON catalog.resource;
DROP FUNCTION catalog.guard_resource_reference();
DROP INDEX catalog.resource_native_identity;
ALTER TABLE catalog.resource DROP CONSTRAINT resource_reference_provision_shape;
ALTER TABLE catalog.resource DROP CONSTRAINT resource_native_identity_check;
ALTER TABLE catalog.resource DROP COLUMN reference_provision, DROP COLUMN native_identity_digest;
ALTER TABLE catalog.resource ADD CONSTRAINT resource_native_identity_check CHECK
 ((application_binding_id IS NULL AND native_id=id::text) OR
  (application_binding_id IS NOT NULL AND native_type<>'' AND native_id<>''));
ALTER TABLE catalog.action_definition DROP CONSTRAINT capacity_not_yet_enforced;
ALTER TABLE catalog.action_definition ADD CONSTRAINT capacity_not_yet_enforced CHECK (
 capacity_policy IN ('NONE','PLATFORM_SLOT') OR (capacity_policy='NATIVE' AND component_release_id IS NOT NULL));
ALTER TABLE catalog.action_definition DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE catalog.action_definition ADD CONSTRAINT workflow_kind_enum CHECK (workflow_kind IN
 ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
 'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION','COMPONENT_RELEASE',
 'COMPONENT_BINDING','COMPONENT_DISABLE'));
ALTER TABLE projection.workflow_ref DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE projection.workflow_ref ADD CONSTRAINT workflow_kind_enum CHECK (kind IN
 ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
 'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION','COMPONENT_RELEASE',
 'COMPONENT_BINDING','COMPONENT_DISABLE'));
