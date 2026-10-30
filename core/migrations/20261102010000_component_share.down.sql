-- Reverse of DD-164(4) storage. Refuses while any shared object, share action or intent
-- exists: their Resources, SpiceDB grants and audit chains are not removable by a schema
-- rollback; roll back by stopping the release instead.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM catalog.resource WHERE type_key='component.shared_object')
   OR EXISTS (SELECT 1 FROM admission.action_execution WHERE action_key='component.share.set') THEN
   RAISE EXCEPTION 'DD-164 shared object history must not be discarded; stop the release instead'
     USING ERRCODE='55000';
 END IF;
END $$;

DROP TABLE catalog.component_directory_receipt;
DROP TABLE catalog.component_share_intent;
DELETE FROM catalog.action_definition WHERE action_key='component.share.set';
ALTER TABLE catalog.resource DROP CONSTRAINT resource_component_shared_object_shape;

CREATE OR REPLACE FUNCTION catalog.freeze_resource_type_definition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected uuid; release uuid; component text;
BEGIN
    IF TG_OP='UPDATE' THEN
        IF NEW.resource_type_definition_id IS DISTINCT FROM OLD.resource_type_definition_id THEN
            RAISE EXCEPTION 'resource type definition is frozen' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.application_binding_id IS NULL OR NEW.type_key='tool.definition' THEN
        SELECT id INTO expected FROM catalog.resource_type_definition
        WHERE type_key=NEW.type_key AND component_release_id IS NULL AND status='ACTIVE';
    ELSE
        SELECT p.component_release_id,b.component_type_key INTO release,component FROM catalog.application_binding b
        JOIN projection.application_runtime p ON p.binding_id=b.id AND p.generation=b.active_projection_generation
        WHERE b.id=NEW.application_binding_id AND b.tenant_id=NEW.tenant_id
          AND (b.workspace_id IS NULL OR b.workspace_id=NEW.home_workspace_id)
          AND b.state='ACTIVE' AND p.state='ACTIVE' AND p.component_release_id=b.component_release_id;
        IF NOT FOUND OR component IS DISTINCT FROM NEW.component_type_key THEN
            RAISE EXCEPTION 'resource binding unavailable or implementation differs' USING ERRCODE='23514';
        END IF;
        SELECT id INTO expected FROM catalog.resource_type_definition
        WHERE type_key=NEW.type_key AND component_release_id=release AND status='ACTIVE';
    END IF;
    IF expected IS NULL OR (NEW.resource_type_definition_id IS NOT NULL AND NEW.resource_type_definition_id<>expected) THEN
        RAISE EXCEPTION 'resource exact type declaration unavailable' USING ERRCODE='23514';
    END IF;
    NEW.resource_type_definition_id:=expected;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION catalog.guard_resource_reference() RETURNS trigger LANGUAGE plpgsql AS $$
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

DELETE FROM catalog.resource_type_definition WHERE type_key='component.shared_object' AND component_release_id IS NULL;
