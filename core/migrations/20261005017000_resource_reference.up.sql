-- DD-98: original Resource references, never a second native object registry.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM catalog.resource WHERE application_binding_id IS NOT NULL AND type_key<>'tool.definition') THEN
  RAISE EXCEPTION 'existing business references require original verified provenance before this migration' USING ERRCODE='23001';
 END IF;
END $$;
ALTER TABLE catalog.resource ADD COLUMN reference_provision jsonb,
 ADD COLUMN native_identity_digest text;
ALTER TABLE catalog.resource ADD CONSTRAINT resource_reference_provision_shape CHECK (
 (reference_provision IS NULL AND native_identity_digest IS NULL) OR
 (application_binding_id IS NOT NULL AND type_key<>'tool.definition'
  AND jsonb_typeof(reference_provision)='object'
  AND jsonb_typeof(reference_provision->'frozen')='object'
  AND jsonb_typeof(reference_provision->'cleanupRequired')='boolean'
  AND reference_provision->>'actionExecutionId' IS NOT NULL
  AND native_identity_digest IS NOT NULL AND native_identity_digest ~ '^[0-9a-f]{64}$') IS TRUE);
CREATE UNIQUE INDEX resource_native_identity ON catalog.resource(native_identity_digest)
 WHERE native_identity_digest IS NOT NULL;
ALTER TABLE catalog.resource DROP CONSTRAINT resource_native_identity_check;
ALTER TABLE catalog.resource ADD CONSTRAINT resource_native_identity_check CHECK (
 (application_binding_id IS NULL AND native_id IS NOT NULL AND native_id=id::text) OR
 (application_binding_id IS NOT NULL AND native_type IS NOT NULL AND native_id IS NOT NULL AND native_type<>'' AND native_id<>'') OR
 (reference_provision IS NOT NULL AND state IN ('PROVISIONING','UNKNOWN','FAILED')
  AND native_type IS NULL AND native_id IS NULL));
CREATE FUNCTION catalog.guard_resource_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE frozen jsonb; original admission.action_execution%ROWTYPE; binding catalog.application_binding%ROWTYPE;
BEGIN
 IF NEW.reference_provision IS NULL THEN
  IF TG_OP='INSERT' AND NEW.application_binding_id IS NOT NULL AND NEW.type_key<>'tool.definition' THEN
   RAISE EXCEPTION 'business resource requires original resource.create evidence' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND OLD.reference_provision IS NOT NULL THEN
   RAISE EXCEPTION 'resource reference cannot lose evidence' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 frozen:=NEW.reference_provision->'frozen';
 IF TG_OP='UPDATE' AND (NEW.reference_provision->'frozen' IS DISTINCT FROM OLD.reference_provision->'frozen'
   OR NEW.native_identity_digest IS DISTINCT FROM OLD.native_identity_digest
   OR NEW.application_binding_id IS DISTINCT FROM OLD.application_binding_id
   OR NEW.reference_provision->>'actionExecutionId' IS DISTINCT FROM OLD.reference_provision->>'actionExecutionId'
   OR NEW.home_workspace_id IS DISTINCT FROM OLD.home_workspace_id
   OR (OLD.reference_provision->'cleanupRequired'='true'::jsonb AND NEW.reference_provision->'cleanupRequired'<>'true'::jsonb)) THEN
  RAISE EXCEPTION 'resource reference identity and fence immutable' USING ERRCODE='23514';
 END IF;
 SELECT * INTO original FROM admission.action_execution WHERE id=(NEW.reference_provision->>'actionExecutionId')::uuid;
 IF NOT FOUND OR original.action_key<>'resource.create' OR original.target_id<>NEW.id
   OR original.tenant_id<>NEW.tenant_id OR original.workspace_id IS DISTINCT FROM NEW.home_workspace_id
   OR (TG_OP='INSERT' AND original.initiator_principal_id<>NEW.owner_principal_id)
   OR original.parameters#>'{params,resourceCreate}' IS DISTINCT FROM frozen->'reference'
   OR (NEW.state IN ('PROVISIONING','UNKNOWN','FAILED') AND NEW.projection_action_execution_id IS DISTINCT FROM original.id)
   OR (TG_OP='INSERT' AND NEW.state<>'PROVISIONING') THEN
  RAISE EXCEPTION 'resource reference requires original admission' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND ((OLD.state='FAILED' AND NEW IS DISTINCT FROM OLD)
   OR (OLD.state IN ('PROVISIONING','UNKNOWN') AND NEW.state NOT IN ('PROVISIONING','UNKNOWN','ACTIVE','FAILED'))
   OR (NEW.state='PROVISIONING' AND OLD.state<>'PROVISIONING')) THEN
  RAISE EXCEPTION 'resource reference transition is not reconciled' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' OR (NEW.state='ACTIVE' AND OLD.state<>'ACTIVE') THEN
  SELECT * INTO binding FROM catalog.application_binding WHERE id=NEW.application_binding_id FOR SHARE;
  IF NOT FOUND OR binding.state<>'ACTIVE' OR binding.tenant_id<>NEW.tenant_id
    OR binding.id::text IS DISTINCT FROM frozen->>'bindingId'
    OR binding.version::text IS DISTINCT FROM frozen->>'bindingVersion'
    OR binding.component_release_id::text IS DISTINCT FROM frozen->>'releaseId'
    OR binding.active_projection_generation::text IS DISTINCT FROM frozen->>'generation'
    OR binding.native_instance_ref IS DISTINCT FROM frozen->>'nativeInstanceRef'
    OR binding.native_scope_ref IS DISTINCT FROM frozen->>'nativeScopeRef'
    OR binding.config_digest IS DISTINCT FROM frozen->>'configDigest' THEN
   RAISE EXCEPTION 'resource reference binding changed' USING ERRCODE='23514';
  END IF;
 END IF;
 IF NEW.state='ACTIVE' AND (NEW.native_type IS DISTINCT FROM frozen#>>'{reference,nativeType}'
   OR NEW.native_id IS DISTINCT FROM frozen#>>'{reference,nativeRef}'
   OR NEW.reference_provision->'cleanupRequired'<>'false'::jsonb
   OR original.gate_state<>'ALLOWED' OR original.dispatch_state<>'DISPATCHED') THEN
  RAISE EXCEPTION 'active resource reference differs from evidence' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER resource_reference_guard BEFORE INSERT OR UPDATE ON catalog.resource
 FOR EACH ROW EXECUTE FUNCTION catalog.guard_resource_reference();
ALTER TABLE catalog.action_definition DROP CONSTRAINT capacity_not_yet_enforced;
ALTER TABLE catalog.action_definition ADD CONSTRAINT capacity_not_yet_enforced CHECK (
 capacity_policy IN ('NONE','PLATFORM_SLOT') OR (capacity_policy='NATIVE'
 AND (component_release_id IS NOT NULL OR action_key='resource.create')));
ALTER TABLE catalog.action_definition DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE catalog.action_definition ADD CONSTRAINT workflow_kind_enum CHECK (workflow_kind IN
 ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
 'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION','COMPONENT_RELEASE',
 'COMPONENT_BINDING','COMPONENT_DISABLE','RESOURCE_PROVISION'));
ALTER TABLE projection.workflow_ref DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE projection.workflow_ref ADD CONSTRAINT workflow_kind_enum CHECK (kind IN
 ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
 'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION','COMPONENT_RELEASE',
 'COMPONENT_BINDING','COMPONENT_DISABLE','RESOURCE_PROVISION'));
INSERT INTO catalog.action_definition
 (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,permission,permission_object_type,
 execution_mode,confirmation_mode,approval_policy_id,approval_policy_version,workflow_type,workflow_kind,
 capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,
 obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,obs_cost_source,obs_redaction_policy,status)
 VALUES ('resource.create',1,'core','RESOURCE','SESSION_TENANT','DECLARED_WORKSPACE','create','tenant',
 'TEMPORAL','NONE',NULL,NULL,'ComponentTaskWorkflow','RESOURCE_PROVISION','NATIVE',NULL,'NONE','{}','NONE',
 'FULL_LIFECYCLE','OPERATION_REF','TEMPORAL','TEMPORAL','NONE','NONE','PLATFORM_METADATA_ONLY','ACTIVE');
