-- Platform-internal 07 §8A release-directory prerequisites only.
-- The owning test first verifies the dedicated database and real authenticated
-- Catalog/tenant memberships. This is not component registration/conformance
-- evidence. No Tenant, identity, binding, runtime, resource, model key, native
-- receipt, usage event or business Workflow is inserted by this file.
DO $$
DECLARE
  input jsonb := current_setting('kailo.receiver_fixture_input')::jsonb;
  catalog_tenant uuid := (input->>'catalogTenantId')::uuid;
  human uuid := (input->>'catalogPrincipalId')::uuid;
  approver uuid := (input->>'approverPrincipalId')::uuid;
  endpoint jsonb; release_id uuid; register_ae uuid; approve_ae uuid;
  register_workflow text; approve_workflow text; approval_workflow text;
BEGIN
  FOR endpoint IN SELECT value FROM jsonb_array_elements(input->'endpoints') LOOP
    release_id:=(endpoint->>'releaseId')::uuid;
    IF EXISTS(SELECT 1 FROM catalog.component_release WHERE id=release_id) THEN
      IF NOT EXISTS(SELECT 1 FROM catalog.component_release r
        JOIN admission.action_execution a ON a.id=r.registered_by_action_execution_id
        WHERE r.id=release_id AND r.catalog_tenant_id=catalog_tenant
          AND r.manifest=endpoint->'manifest' AND r.component_package=endpoint->'package'
          AND r.binding_config_schema=endpoint->'bindingConfigSchema'
          AND r.adapter_build_ref=endpoint->>'artifactDigest' AND r.status='APPROVED'
          AND a.parameter_hash=input->>'inputDigest'
          AND a.parameters->>'fixtureMode'='CONFORMANCE_ONLY') THEN
        RAISE EXCEPTION 'existing release differs from isolated fixture';
      END IF;
      CONTINUE;
    END IF;
    INSERT INTO catalog.component_definition(type_key,catalog_tenant_id,class,platform_port_key,status)
    VALUES(endpoint->'manifest'->>'componentTypeKey',catalog_tenant,'APPLICATION','NONE','ACTIVE')
    ON CONFLICT(type_key) DO NOTHING;
    IF NOT EXISTS(SELECT 1 FROM catalog.component_definition
      WHERE type_key=endpoint->'manifest'->>'componentTypeKey'
        AND catalog_tenant_id=catalog_tenant AND class='APPLICATION'
        AND platform_port_key='NONE' AND status='ACTIVE') THEN
      RAISE EXCEPTION 'existing component definition differs from isolated fixture';
    END IF;
    register_ae:=gen_random_uuid(); approve_ae:=gen_random_uuid();
    register_workflow:='CONFORMANCE_ONLY-register-'||register_ae;
    approve_workflow:='CONFORMANCE_ONLY-approve-'||approve_ae;
    approval_workflow:='CONFORMANCE_ONLY-approval-'||approve_ae;
    INSERT INTO admission.action_execution(id,operation_id,tenant_id,action_key,action_version,
      initiator_principal_id,actor_principal_id,target_id,parameter_hash,parameters,gate_state,dispatch_state,correlation_id,
      component_conformance_plan,component_conformance_observation)
    VALUES(register_ae,register_ae,catalog_tenant,'component_release.register',1,human,human,release_id,input->>'inputDigest',
      '{"fixtureMode":"CONFORMANCE_ONLY"}','ALLOWED','DISPATCHED',register_ae,
      jsonb_build_object('planDigest',input->>'inputDigest','suiteDigest','CONFORMANCE_ONLY','contractDigests','[]'::jsonb),
      jsonb_build_object('actionExecutionId',register_ae,'operationId',register_ae,'workflowId',register_workflow,
        'runId','CONFORMANCE_ONLY','componentReleaseId',release_id,'artifactDigest',endpoint->>'artifactDigest',
        'planDigest',input->>'inputDigest','suiteDigest','CONFORMANCE_ONLY','contractDigests','[]'::jsonb,
        'observations',jsonb_build_array(jsonb_build_object('fixtureMode','CONFORMANCE_ONLY','executed',false))));
    INSERT INTO projection.workflow_ref(workflow_id,run_id,workflow_type,workflow_version,kind,tenant_id,operation_id,action_execution_id,projection_state)
    VALUES(register_workflow,'CONFORMANCE_ONLY','ComponentTaskWorkflow',1,'COMPONENT_RELEASE',catalog_tenant,register_ae,register_ae,'RUNNING');
    INSERT INTO projection.task_projection(workflow_id,run_id,last_event_id,status)
    VALUES(register_workflow,'CONFORMANCE_ONLY',1,'RUNNING');
    INSERT INTO catalog.component_release(id,component_type_key,catalog_tenant_id,version,manifest,component_package,binding_config_schema,
      manifest_digest,component_package_digest,adapter_build_ref,registered_by_action_execution_id,status)
    VALUES(release_id,endpoint->'manifest'->>'componentTypeKey',catalog_tenant,'CONFORMANCE_ONLY',endpoint->'manifest',
      endpoint->'package',endpoint->'bindingConfigSchema',endpoint->>'manifestDigest',endpoint->>'packageDigest',
      endpoint->>'artifactDigest',register_ae,'REGISTERED');
    INSERT INTO admission.action_execution(id,operation_id,tenant_id,action_key,action_version,
      initiator_principal_id,actor_principal_id,target_id,parameter_hash,parameters,gate_state,dispatch_state,correlation_id,
      temporal_workflow_id,approval_workflow_id,component_compatibility_observation)
    VALUES(approve_ae,approve_ae,catalog_tenant,'component_release.approve',1,approver,approver,release_id,input->>'inputDigest',
      '{"fixtureMode":"CONFORMANCE_ONLY"}','ALLOWED','DISPATCHED',approve_ae,approve_workflow,approval_workflow,
      jsonb_build_object('actionExecutionId',approve_ae,'componentReleaseId',release_id,'workflowId',approve_workflow,
        'runId','CONFORMANCE_ONLY','approvalWorkflowId',approval_workflow,'registrationPlanDigest',input->>'inputDigest',
        'builds',jsonb_build_array(jsonb_build_object('fixtureMode','CONFORMANCE_ONLY','executed',false),
          jsonb_build_object('fixtureMode','CONFORMANCE_ONLY','executed',false),
          jsonb_build_object('fixtureMode','CONFORMANCE_ONLY','executed',false))));
    INSERT INTO projection.workflow_ref(workflow_id,run_id,workflow_type,workflow_version,kind,tenant_id,operation_id,action_execution_id,projection_state)
    VALUES(approve_workflow,'CONFORMANCE_ONLY','ComponentTaskWorkflow',1,'COMPONENT_RELEASE',catalog_tenant,approve_ae,approve_ae,'RUNNING'),
      (approval_workflow,'CONFORMANCE_ONLY','ApprovalWorkflow',1,NULL,catalog_tenant,approve_ae,approve_ae,'RUNNING');
    INSERT INTO projection.task_projection(workflow_id,run_id,last_event_id,status) VALUES(approve_workflow,'CONFORMANCE_ONLY',1,'RUNNING');
    INSERT INTO projection.approval_projection(workflow_id,action_execution_id,tenant_id,run_id,last_event_id,status,decisions,expires_at,consume_deadline)
    VALUES(approval_workflow,approve_ae,catalog_tenant,'CONFORMANCE_ONLY',1,'CONSUMED','[]',now(),now());
    UPDATE catalog.component_release SET status='APPROVED',approved_by_action_execution_id=approve_ae WHERE id=release_id;
  END LOOP;
END $$;
