-- ComponentRelease registration evidence belongs to its original admission.
-- No per-step claim ledger: attempts and reconciliation remain Temporal history.
ALTER TABLE catalog.action_definition DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE catalog.action_definition ADD CONSTRAINT workflow_kind_enum CHECK (workflow_kind IN
  ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
   'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION','COMPONENT_RELEASE'));
ALTER TABLE projection.workflow_ref DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE projection.workflow_ref ADD CONSTRAINT workflow_kind_enum CHECK (kind IN
  ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
   'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION','COMPONENT_RELEASE'));
ALTER TABLE admission.action_execution
  ADD COLUMN component_conformance_plan jsonb,
  ADD COLUMN component_conformance_observation jsonb,
  ADD CONSTRAINT component_conformance_scope CHECK (
    (component_conformance_plan IS NULL AND component_conformance_observation IS NULL)
    OR (component_conformance_plan IS NOT NULL
        AND action_key='component_release.register' AND workspace_id IS NULL
        AND jsonb_typeof(component_conformance_plan)='object'
        AND (component_conformance_observation IS NULL
             OR jsonb_typeof(component_conformance_observation)='object'))
  );

-- The original admission is the only plan/report authority. Once written,
-- neither can be revised while keeping a previously registered release valid.
CREATE FUNCTION admission.guard_component_conformance_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.component_conformance_plan IS NOT NULL
      AND NEW.component_conformance_plan IS DISTINCT FROM OLD.component_conformance_plan)
    OR (OLD.component_conformance_observation IS NOT NULL
      AND NEW.component_conformance_observation IS DISTINCT FROM OLD.component_conformance_observation) THEN
    RAISE EXCEPTION 'component conformance evidence is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER component_conformance_evidence BEFORE UPDATE ON admission.action_execution
FOR EACH ROW EXECUTE FUNCTION admission.guard_component_conformance_evidence();

CREATE TABLE catalog.component_definition (
  type_key text PRIMARY KEY,
  catalog_tenant_id uuid NOT NULL REFERENCES identity.tenant(id),
  class text NOT NULL CHECK (class IN ('PLATFORM','APPLICATION')),
  platform_port_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','RETIRED')),
  CHECK (type_key ~ '^[a-z][a-z0-9_]*$'),
  CHECK ((class='APPLICATION' AND platform_port_key='NONE') OR
    (class='PLATFORM' AND platform_port_key IN (
      'CORE_INTERNAL','IDENTITY_EDGE','AUTHORIZATION','APPROVAL_WORKFLOW',
      'METERING_BILLING','AI_GATEWAY','SECRET_STORE','COLLABORATION_RELAY'))),
  UNIQUE(type_key,catalog_tenant_id)
);

CREATE TABLE catalog.component_release (
  id uuid PRIMARY KEY,
  component_type_key text NOT NULL,
  catalog_tenant_id uuid NOT NULL,
  version text NOT NULL,
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest)='object'),
  component_package jsonb NOT NULL CHECK (jsonb_typeof(component_package)='object'),
  binding_config_schema jsonb NOT NULL CHECK (jsonb_typeof(binding_config_schema) IN ('object','boolean')),
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^[0-9a-f]{64}$'),
  component_package_digest text NOT NULL CHECK (component_package_digest ~ '^[0-9a-f]{64}$'),
  adapter_build_ref text NOT NULL CHECK (adapter_build_ref ~ '^[0-9a-f]{64}$'),
  registered_by_action_execution_id uuid NOT NULL UNIQUE REFERENCES admission.action_execution(id),
  status text NOT NULL CHECK (status IN ('REGISTERED','APPROVED','REJECTED','REVOKED')),
  FOREIGN KEY(component_type_key,catalog_tenant_id)
    REFERENCES catalog.component_definition(type_key,catalog_tenant_id),
  UNIQUE(component_type_key,version)
);

CREATE FUNCTION catalog.guard_component_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    RAISE EXCEPTION 'component release registration is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.status<>'REGISTERED' OR NOT EXISTS (
    SELECT 1 FROM admission.action_execution ae
    JOIN identity.principal p ON p.id=ae.initiator_principal_id
    JOIN projection.workflow_ref wf ON wf.action_execution_id=ae.id
    JOIN projection.task_projection task ON task.workflow_id=wf.workflow_id
    WHERE ae.id=NEW.registered_by_action_execution_id AND ae.action_key='component_release.register'
      AND ae.tenant_id=NEW.catalog_tenant_id AND ae.workspace_id IS NULL AND ae.target_id=NEW.id
      AND ae.gate_state='ALLOWED' AND ae.dispatch_state='DISPATCHED'
      AND p.tenant_id=ae.tenant_id AND p.kind='HUMAN'
      AND wf.workflow_type='ComponentTaskWorkflow' AND wf.kind='COMPONENT_RELEASE'
      AND wf.operation_id=ae.operation_id AND wf.tenant_id=ae.tenant_id AND wf.run_id IS NOT NULL
      AND ae.component_conformance_observation->>'actionExecutionId'=ae.id::text
      AND ae.component_conformance_observation->>'operationId'=ae.operation_id::text
      AND ae.component_conformance_observation->>'workflowId'=wf.workflow_id
      -- WorkflowRef retains the first run for the original execution chain;
      -- TaskProjection records the current run after ContinueAsNew.
      AND task.status='RUNNING'
      AND ae.component_conformance_observation->>'runId'=task.run_id
      AND ae.component_conformance_observation->>'componentReleaseId'=NEW.id::text
      AND ae.component_conformance_observation->>'artifactDigest'=NEW.adapter_build_ref
      AND ae.component_conformance_observation->>'planDigest'=ae.component_conformance_plan->>'planDigest'
      AND ae.component_conformance_observation->>'suiteDigest'=ae.component_conformance_plan->>'suiteDigest'
      AND ae.component_conformance_observation->'contractDigests'=ae.component_conformance_plan->'contractDigests'
      AND jsonb_typeof(ae.component_conformance_observation->'observations')='array'
      AND jsonb_array_length(ae.component_conformance_observation->'observations')>0
      AND EXISTS (SELECT 1 FROM identity.relay_operator_identity o WHERE o.catalog_tenant_id=ae.tenant_id)
  ) THEN
    RAISE EXCEPTION 'release requires original Catalog action and actual workflow evidence' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER component_release_source BEFORE INSERT OR UPDATE ON catalog.component_release
FOR EACH ROW EXECUTE FUNCTION catalog.guard_component_release();

-- DD-100 / .design/05 §2.8. Registration goes through the original governed
-- action and ComponentTaskWorkflow; approval and binding activation are absent.
INSERT INTO catalog.action_definition
 (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
 permission,permission_object_type,execution_mode,confirmation_mode,approval_policy_id,approval_policy_version,
 workflow_type,workflow_kind,capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,
 obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,obs_cost_source,obs_redaction_policy,status)
VALUES ('component_release.register',1,'core','COMPONENT_RELEASE','SESSION_TENANT','TENANT_ONLY',
 'manage','tenant','TEMPORAL','EXPLICIT',NULL,NULL,
 'ComponentTaskWorkflow','COMPONENT_RELEASE','NONE',NULL,'NONE','{}'::text[],'NONE','FULL_LIFECYCLE',
 'OPERATION_REF','TEMPORAL','TEMPORAL','NONE','NONE','PLATFORM_METADATA_ONLY','ACTIVE');
