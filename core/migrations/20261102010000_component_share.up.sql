-- DD-164(4) (.design/02, 03 §3/§5, 07 §4.7.4): Kailo is the only authority for who may
-- read or write a component's native object; component native ACLs are its projection.
-- 1. The platform ResourceType component.shared_object (no capability category, never a
--    tool/search/adapter target) on an ACTIVE NATIVE_PAGE binding.
-- 2. The governed action component.share.set (SYNC, EXPLICIT, no approval, FULL_LIFECYCLE).
--    Its real authority is in the module gate: the initiator of the share intent and,
--    for an existing Resource, fresh `share`; the definition only fixes Tenant `discover`.
-- 3. ComponentShareIntent (10 minutes, grants nothing) and ComponentDirectoryReceipt (one
--    row per binding: last served directory version and last component receipt).

INSERT INTO catalog.resource_type_definition
 (type_key,capability_category,capability_contract_version,incremental_contracts,llm_gateway_contract,
  transfer_formats,tenant_delete_action_key,status)
VALUES ('component.shared_object',NULL,NULL,
 '[{"contract_key":"component.shared_object@v1","role":"NATIVE_INTERNAL","engine":"NATIVE","stable_key_rule":"catalog.resource.id; unique ACTIVE (application_binding_id,native_type,native_id)","revision_rule":"catalog.resource.version","delete_semantics":"Tenant frozen inventory -> SpiceDB relationship deletion -> Core DELETED tombstone; the native object stays in the component","reconciliation_trigger":"governance_reconcile resumes the same component.share.set ActionExecution; components converge from the member directory schema 2 and report ComponentDirectoryReceipt","readiness_semantics":"Resource ACTIVE with no pending projection; FullyConsistent SpiceDB tenant/owner/home and reader/editor relationships equal the last applied grant list"}]',
 'NOT_USED','[]','tenant.delete','ACTIVE');

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
    ELSIF NEW.type_key='component.shared_object' THEN
        -- DD-164(4)①: a platform type on an ACTIVE NATIVE_PAGE binding of the same Tenant
        -- (and Workspace) and implementation; the release declares no resource types.
        PERFORM 1 FROM catalog.application_binding b
        JOIN projection.application_runtime p ON p.binding_id=b.id AND p.generation=b.active_projection_generation
        JOIN catalog.component_release r ON r.id=b.component_release_id
        WHERE b.id=NEW.application_binding_id AND b.tenant_id=NEW.tenant_id
          AND (b.workspace_id IS NULL OR b.workspace_id=NEW.home_workspace_id)
          AND b.state='ACTIVE' AND p.state='ACTIVE' AND p.component_release_id=b.component_release_id
          AND b.component_type_key=NEW.component_type_key
          AND r.manifest#>>'{frontendDelivery,mode}'='NATIVE_PAGE';
        IF NOT FOUND THEN
            RAISE EXCEPTION 'shared object binding unavailable or implementation differs' USING ERRCODE='23514';
        END IF;
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
  IF TG_OP='INSERT' AND NEW.application_binding_id IS NOT NULL AND NEW.type_key NOT IN ('tool.definition','component.shared_object') THEN
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

ALTER TABLE catalog.resource ADD CONSTRAINT resource_component_shared_object_shape CHECK (
 type_key<>'component.shared_object' OR (application_binding_id IS NOT NULL
  AND native_type IN ('folder','knowledge_base') AND native_id IS NOT NULL
  AND native_id<>'' AND char_length(native_id)<=255 AND reference_provision IS NULL));

INSERT INTO catalog.action_definition
 (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
 permission,permission_object_type,execution_mode,confirmation_mode,approval_policy_id,approval_policy_version,
 workflow_type,workflow_kind,capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,
 obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,obs_cost_source,obs_redaction_policy,status)
VALUES ('component.share.set',1,'core','RESOURCE','SESSION_TENANT','TENANT_ONLY','discover','tenant','SYNC',
 'EXPLICIT',NULL,NULL,NULL,NULL,'NONE',NULL,'NONE','{}','NONE','FULL_LIFECYCLE',
 'OPERATION_REF','NONE','SYNC_RESULT','NONE','NONE','PLATFORM_METADATA_ONLY','ACTIVE');

CREATE TABLE catalog.component_share_intent (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES identity.tenant(id),
    application_binding_id uuid NOT NULL,
    binding_generation bigint NOT NULL CHECK (binding_generation>0),
    native_type text NOT NULL CHECK (native_type IN ('folder','knowledge_base')),
    native_id text NOT NULL CHECK (native_id<>'' AND char_length(native_id)<=255),
    display_name text NOT NULL CHECK (btrim(display_name)<>'' AND char_length(display_name)<=200),
    workspace_id uuid REFERENCES identity.workspace(id),
    initiator_principal_id uuid NOT NULL REFERENCES identity.principal(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    consumed_by_action_execution_id uuid REFERENCES admission.action_execution(id),
    FOREIGN KEY (tenant_id,application_binding_id) REFERENCES catalog.application_binding(tenant_id,id),
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes'),
    CHECK ((consumed_at IS NULL) = (consumed_by_action_execution_id IS NULL))
);
CREATE INDEX component_share_intent_initiator ON catalog.component_share_intent(tenant_id,initiator_principal_id);
CREATE INDEX component_share_intent_expiry ON catalog.component_share_intent(expires_at);

CREATE TABLE catalog.component_directory_receipt (
    application_binding_id uuid PRIMARY KEY REFERENCES catalog.application_binding(id),
    tenant_id uuid NOT NULL REFERENCES identity.tenant(id),
    served_schema integer CHECK (served_schema IN (1,2)),
    served_version text CHECK (served_version ~ '^[0-9a-f]{64}$'),
    served_version_since timestamptz,
    served_at timestamptz,
    receipt_schema integer CHECK (receipt_schema IN (1,2)),
    receipt_version text CHECK (receipt_version ~ '^[0-9a-f]{64}$'),
    outcome text CHECK (outcome IN ('APPLIED','FAILED')),
    failures jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(failures)='array' AND jsonb_array_length(failures)<=100),
    applied_at timestamptz,
    received_at timestamptz,
    CHECK ((served_version IS NULL) = (served_at IS NULL) AND (served_version IS NULL) = (served_schema IS NULL)
           AND (served_version IS NULL) = (served_version_since IS NULL)),
    CHECK ((receipt_version IS NULL) = (received_at IS NULL) AND (receipt_version IS NULL) = (outcome IS NULL)
           AND (receipt_version IS NULL) = (receipt_schema IS NULL) AND (receipt_version IS NULL) = (applied_at IS NULL))
);
