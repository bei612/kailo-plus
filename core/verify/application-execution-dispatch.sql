-- Seed only the existing isolated schema; Rust owns the outer rollback.
CREATE TEMP TABLE application_dispatch_fixture(child uuid,binding uuid,release uuid,workflow text,ee uuid) ON COMMIT DROP;
DO $$
DECLARE provider text; release uuid; register_ae uuid; approve_ae uuid; register_op uuid;
        approve_op uuid; register_workflow text; approve_workflow text; approval_workflow text;
        action jsonb; resource_type jsonb; manifest jsonb; definition uuid; technical_id uuid;
        count_rows integer;
BEGIN
  FOREACH provider IN ARRAY ARRAY['catalog_fixture_one','catalog_fixture_two'] LOOP
    release:=gen_random_uuid(); register_ae:=gen_random_uuid(); approve_ae:=gen_random_uuid();
    register_op:=gen_random_uuid(); approve_op:=gen_random_uuid();
    register_workflow:='isolated-directory-register-'||register_ae;
    approve_workflow:='isolated-directory-approve-'||approve_ae;
    approval_workflow:='isolated-directory-approval-'||approve_ae;
    action:=jsonb_build_object('actionKey','isolated.lookup@v1','version',1,'capabilityContractKey','isolated.lookup@v1',
      'componentTypeKey',provider,'targetType','RESOURCE','tenantRule','SESSION_TENANT','workspaceRule','TARGET_HOME_WORKSPACE',
      'permission','read','executionMode','PROTOCOL','confirmationMode','NONE','approvalPolicyId','NONE','workflowType','NONE',
      'capacityPolicy','NATIVE','capacityPoolKey','NONE','quotaPolicy','NONE','meters','[]'::jsonb,
      'resultExposurePolicy',jsonb_build_object('mode','CONSUME_ONLY','outputSchemaHash',repeat('a',64),'redactionPolicy','PLATFORM_METADATA_ONLY'),
      'auditPolicy','FULL_LIFECYCLE','businessObservabilityPolicy',jsonb_build_object('correlationMode','OPERATION_NATIVE_REF',
        'progressSource','NATIVE','terminalSource','NATIVE','usageSource','NONE','costSource','NONE','redactionPolicy','PLATFORM_METADATA_ONLY'),
      'status','ACTIVE','inputSchemaDigest',repeat('b',64),'outputSchemaDigest',repeat('a',64));
    IF provider='catalog_fixture_two' THEN
      action:=action||'{"quotaPolicy":"CHECK","meters":["native_read_count"]}'::jsonb;
      action:=jsonb_set(action,'{businessObservabilityPolicy,usageSource}','"DRIVER"');
    END IF;
    resource_type:=jsonb_build_object('typeKey','retire_plain.collection','capabilityCategory','retire_plain',
      'capabilityContractVersion',1,'incrementalContracts','[{"contractKey":"isolated"}]'::jsonb,
      'llmGatewayContract','NOT_USED','transferFormats','[]'::jsonb,'tenantDeleteActionKey','NONE','status','ACTIVE');
    manifest:=jsonb_build_object('componentTypeKey',provider,'actionDefinitions',jsonb_build_array(action),
      'resourceTypeDefinitions',jsonb_build_array(resource_type));
    INSERT INTO admission.action_execution(id,operation_id,tenant_id,action_key,action_version,
      initiator_principal_id,actor_principal_id,target_id,parameter_hash,gate_state,dispatch_state,correlation_id,
      component_conformance_plan,component_conformance_observation)
    VALUES(register_ae,register_op,'00000000-0000-0000-0000-000000000001','component_release.register',1,
      '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000011',release,repeat('c',64),
      'ALLOWED','DISPATCHED',register_op,'{"planDigest":"isolated","suiteDigest":"isolated","contractDigests":[]}',
      jsonb_build_object('actionExecutionId',register_ae,'operationId',register_op,'workflowId',register_workflow,
        'runId','isolated-run','componentReleaseId',release,'artifactDigest',repeat('d',64),
        'planDigest','isolated','suiteDigest','isolated','contractDigests','[]'::jsonb,'observations','[{}]'::jsonb));
    INSERT INTO projection.workflow_ref(workflow_id,run_id,workflow_type,workflow_version,kind,tenant_id,operation_id,action_execution_id,projection_state)
    VALUES(register_workflow,'isolated-run','ComponentTaskWorkflow',1,'COMPONENT_RELEASE','00000000-0000-0000-0000-000000000001',register_op,register_ae,'RUNNING');
    INSERT INTO projection.task_projection(workflow_id,run_id,last_event_id,status) VALUES(register_workflow,'isolated-run',1,'RUNNING');
    INSERT INTO catalog.component_definition(type_key,catalog_tenant_id,class,platform_port_key,status)
    VALUES(provider,'00000000-0000-0000-0000-000000000001','APPLICATION','NONE','ACTIVE');
    INSERT INTO catalog.component_release(id,component_type_key,catalog_tenant_id,version,manifest,component_package,binding_config_schema,
      manifest_digest,component_package_digest,adapter_build_ref,registered_by_action_execution_id,status)
    VALUES(release,provider,'00000000-0000-0000-0000-000000000001','isolated-v1',manifest,'{}','{}',
      repeat('d',64),repeat('d',64),repeat('d',64),register_ae,'REGISTERED');
    INSERT INTO admission.action_execution(id,operation_id,tenant_id,action_key,action_version,
      initiator_principal_id,actor_principal_id,target_id,parameter_hash,gate_state,dispatch_state,correlation_id,
      temporal_workflow_id,approval_workflow_id,component_compatibility_observation)
    VALUES(approve_ae,approve_op,'00000000-0000-0000-0000-000000000001','component_release.approve',1,
      '00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000021',release,repeat('e',64),
      'ALLOWED','DISPATCHED',approve_op,approve_workflow,approval_workflow,
      jsonb_build_object('actionExecutionId',approve_ae,'componentReleaseId',release,'workflowId',approve_workflow,
        'runId','isolated-run','approvalWorkflowId',approval_workflow,'registrationPlanDigest','isolated','builds','[{},{},{}]'::jsonb));
    INSERT INTO projection.workflow_ref(workflow_id,run_id,workflow_type,workflow_version,kind,tenant_id,operation_id,action_execution_id,projection_state)
    VALUES(approve_workflow,'isolated-run','ComponentTaskWorkflow',1,'COMPONENT_RELEASE','00000000-0000-0000-0000-000000000001',approve_op,approve_ae,'RUNNING'),
      (approval_workflow,'isolated-run','ApprovalWorkflow',1,NULL,'00000000-0000-0000-0000-000000000001',approve_op,approve_ae,'RUNNING');
    INSERT INTO projection.task_projection(workflow_id,run_id,last_event_id,status) VALUES(approve_workflow,'isolated-run',1,'RUNNING');
    INSERT INTO projection.approval_projection(workflow_id,action_execution_id,tenant_id,run_id,last_event_id,status,decisions,expires_at,consume_deadline)
    VALUES(approval_workflow,approve_ae,'00000000-0000-0000-0000-000000000001','isolated-run',1,'APPROVED','[]',now()+interval '1 hour',now()+interval '1 hour');
    UPDATE catalog.component_release SET status='APPROVED',approved_by_action_execution_id=approve_ae WHERE id=release;
    INSERT INTO catalog.action_definition(action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
      permission,permission_object_type,execution_mode,confirmation_mode,approval_policy_id,approval_policy_version,
      workflow_type,workflow_kind,capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,
      obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,obs_cost_source,obs_redaction_policy,
      status,component_release_id,implementation_declaration)
    VALUES('isolated.lookup@v1',1,provider,'RESOURCE','SESSION_TENANT','TARGET_HOME_WORKSPACE','read','resource','PROTOCOL','NONE',NULL,NULL,
      NULL,NULL,'NATIVE',NULL,action->>'quotaPolicy',ARRAY(SELECT jsonb_array_elements_text(action->'meters')),
      'CONSUME_ONLY','FULL_LIFECYCLE','OPERATION_NATIVE_REF','NATIVE','NATIVE',action#>>'{businessObservabilityPolicy,usageSource}','NONE',
      'PLATFORM_METADATA_ONLY','ACTIVE',release,action) RETURNING id INTO definition;
    INSERT INTO catalog.resource_type_definition(type_key,capability_category,capability_contract_version,incremental_contracts,
      llm_gateway_contract,transfer_formats,tenant_delete_action_key,status,component_release_id,implementation_declaration)
    VALUES('retire_plain.collection','retire_plain',1,'[{"contractKey":"isolated"}]','NOT_USED','[]',NULL,'ACTIVE',release,resource_type);
    BEGIN
      INSERT INTO catalog.action_definition(action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
        permission,permission_object_type,execution_mode,confirmation_mode,approval_policy_id,approval_policy_version,
        workflow_type,workflow_kind,capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,
        obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,obs_cost_source,obs_redaction_policy,
        status,component_release_id,implementation_declaration)
      SELECT action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
        'export',permission_object_type,execution_mode,confirmation_mode,approval_policy_id,approval_policy_version,
        workflow_type,workflow_kind,capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,
        obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,obs_cost_source,obs_redaction_policy,
        status,component_release_id,implementation_declaration
      FROM catalog.action_definition WHERE id=definition;
      RAISE EXCEPTION 'MUTATED DECLARATION WAS ACCEPTED';
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE 'exact declaration mutation rejected 23514 for %',provider;
    END;
    SELECT action_definition_id INTO technical_id FROM admission.action_execution WHERE id=register_ae;
    IF technical_id IS NULL THEN RAISE EXCEPTION 'new platform execution did not freeze its original definition'; END IF;
    BEGIN
      UPDATE admission.action_execution SET action_definition_id=definition WHERE id=register_ae;
      RAISE EXCEPTION 'EXECUTION REF MUTATION WAS ACCEPTED';
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE 'execution definition mutation rejected 23514 for %',provider;
    END;
  END LOOP;
  SELECT count(*) INTO count_rows FROM catalog.action_definition WHERE action_key='isolated.lookup@v1' AND version=1;
  IF count_rows<>2 THEN RAISE EXCEPTION 'two providers did not retain separate exact definitions'; END IF;
  SELECT count(*) INTO count_rows FROM catalog.resource_type_definition WHERE type_key='retire_plain.collection';
  IF count_rows<>2 THEN RAISE EXCEPTION 'two providers did not retain separate exact resource types'; END IF;
  RAISE NOTICE 'same logical action@version and resource type coexist for two exact releases';
  INSERT INTO identity.principal(id,tenant_id,kind,status)
  VALUES('00000000-0000-0000-0000-000000009999','00000000-0000-0000-0000-000000000001','SERVICE','ACTIVE');
  INSERT INTO identity.service_principal(principal_id,audience)
  VALUES('00000000-0000-0000-0000-000000009999','isolated-category-binding-one');
  SELECT count(*) INTO count_rows FROM identity.service_principal WHERE audience='isolated-category-binding-one';
  IF count_rows<>2 THEN RAISE EXCEPTION 'independent principals cannot address the same receiver audience'; END IF;
  RAISE NOTICE 'same audience allowed for two independent principals; no identity or azp is merged';
  technical_id:=gen_random_uuid();
  INSERT INTO catalog.approval_policy(id,version,action_key,target_type,role_requirements,owner_requirement,
    self_approval,expires_in_seconds,status)
  VALUES(technical_id,1,'isolated.unused.policy','RESOURCE','[{"selector":"TENANT_ADMIN","minDistinct":1}]',
    'NONE','DENY',60,'ACTIVE');
  DELETE FROM catalog.approval_policy WHERE id=technical_id;
  RAISE NOTICE 'shared version trigger preserves unused ApprovalPolicy delete with its original record type';
END $$;
DO $$
DECLARE provider text; release uuid; binding uuid; create_ae uuid; business_ae uuid; disable_ae uuid; resource_ae uuid; reference jsonb; frozen jsonb;
 service uuid; resource uuid; ee uuid; event_id uuid; declaration uuid; usage jsonb; dims jsonb; event jsonb;
 workflow text; metered boolean; happened timestamptz:=clock_timestamp();
 tenant constant uuid:='00000000-0000-0000-0000-000000000001';
 human constant uuid:='00000000-0000-0000-0000-000000000011';
BEGIN
 INSERT INTO projection.openmeter_binding(tenant_id,namespace,customer_id,subject_key_prefix,status)
 VALUES(tenant,'isolated','00000000000000000000000001','isolated:','ACTIVE');
 FOREACH provider IN ARRAY ARRAY['catalog_fixture_two'] LOOP
   metered:=provider='catalog_fixture_two';
   service:=CASE WHEN metered THEN '00000000-0000-0000-0000-000000000031'::uuid
     ELSE '00000000-0000-0000-0000-000000000030'::uuid END;
   SELECT id INTO release FROM catalog.component_release WHERE component_type_key=provider;
   binding:=gen_random_uuid(); create_ae:=gen_random_uuid(); business_ae:=gen_random_uuid(); disable_ae:=gen_random_uuid();
   resource:=gen_random_uuid(); ee:=gen_random_uuid(); event_id:=gen_random_uuid(); workflow:='isolated-ee-'||business_ae;
   INSERT INTO admission.action_execution(id,operation_id,tenant_id,action_key,action_version,
     initiator_principal_id,actor_principal_id,target_id,parameter_hash,gate_state,dispatch_state,correlation_id)
   VALUES(create_ae,create_ae,tenant,'application_binding.create',1,human,human,binding,repeat('a',64),'ALLOWED','DISPATCHED',create_ae);
   INSERT INTO catalog.application_binding(id,tenant_id,component_type_key,component_release_id,service_principal_id,
     adapter_service_ref,native_instance_ref,isolation_mode,call_identity_mode,capability_categories,normalized_config,
     config_digest,secret_refs,model_call_mode,retain_on_tenant_delete,state,version,created_by_action_execution_id,projection_action_execution_id)
   VALUES(binding,tenant,provider,release,service,'isolated-adapter','isolated-instance','DEDICATED_INSTANCE','INSTANCE_SERVICE',
     '[{"category":"retire_plain","version":1}]','{}',repeat('6',64),'[]','NONE',false,'PROVISIONING',1,create_ae,create_ae);
   INSERT INTO projection.application_runtime(binding_id,generation,component_release_id,normalized_manifest_digest,
     adapter_contract_digest,state,action_execution_id)
   VALUES(binding,1,release,repeat('d',64),repeat('b',64),'PENDING',create_ae);
   BEGIN
     UPDATE catalog.application_binding SET state='ACTIVE',version=2,active_projection_generation=1,native_scope_ref='isolated-scope' WHERE id=binding;
     RAISE EXCEPTION 'ACTIVE WITHOUT OBSERVATION ACCEPTED';
   EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ACTIVE missing exact projection rejected'; END;
   UPDATE projection.application_runtime SET state='ACTIVE',observation=jsonb_build_object('bindingId',binding,
     'nativeScopeRef','isolated-scope','configDigest',repeat('6',64)) WHERE binding_id=binding;
   INSERT INTO projection.application_category(tenant_id,category_key,contract_version,binding_id,generation)
   VALUES(tenant,'retire_plain',1,binding,1);
   UPDATE catalog.application_binding SET state='ACTIVE',version=2,active_projection_generation=1,native_scope_ref='isolated-scope' WHERE id=binding;
   resource_ae:=gen_random_uuid();
   reference:=jsonb_build_object('typeKey','retire_plain.collection','nativeType','collection','nativeRef','original-object',
     'evidenceRef','isolated-reference-delivery','evidenceDigest',repeat('a',64));
   frozen:=jsonb_build_object('bindingId',binding,'bindingVersion',2,'releaseId',release,'generation',1,
     'adapterServiceRef','isolated-adapter','nativeInstanceRef','isolated-instance','nativeScopeRef','isolated-scope',
     'configDigest',repeat('6',64),'reference',reference);
   INSERT INTO admission.action_execution(id,operation_id,tenant_id,action_key,action_version,
     initiator_principal_id,actor_principal_id,target_id,parameter_hash,parameters,gate_state,dispatch_state,correlation_id)
   VALUES(resource_ae,resource_ae,tenant,'resource.create',1,human,human,resource,repeat('a',64),
     jsonb_build_object('targetVersion',0,'params',jsonb_build_object('resourceCreate',reference)),
     'ALLOWED','DISPATCHED',resource_ae);
   INSERT INTO catalog.resource(id,tenant_id,type_key,owner_principal_id,component_type_key,application_binding_id,
     state,version,projection_action_execution_id,reference_provision,native_identity_digest)
   VALUES(resource,tenant,'retire_plain.collection',human,provider,binding,'PROVISIONING',1,resource_ae,
     jsonb_build_object('actionExecutionId',resource_ae,'frozen',frozen,'cleanupRequired',false),repeat('f',64));
   UPDATE catalog.resource SET state='ACTIVE',native_type='collection',native_id='original-object',
     projection_action_execution_id=NULL,version=2 WHERE projection_action_execution_id=resource_ae;
   INSERT INTO admission.action_execution(id,operation_id,tenant_id,action_key,action_version,
     initiator_principal_id,actor_principal_id,target_id,parameter_hash,gate_state,dispatch_state,correlation_id,
     component_binding_kind,component_binding_id,component_release_id,component_projection_generation,idempotency_key)
   VALUES(business_ae,business_ae,tenant,'isolated.lookup@v1',1,human,human,resource,repeat('b',64),'ALLOWED','NOT_DISPATCHED',business_ae,
     'APPLICATION',binding,release,1,business_ae);
   INSERT INTO projection.workflow_ref(workflow_id,run_id,workflow_type,workflow_version,kind,tenant_id,operation_id,action_execution_id,projection_state)
   VALUES(workflow,'isolated-run','ComponentTaskWorkflow',1,'COMPONENT_BINDING',tenant,business_ae,business_ae,'RUNNING');
   INSERT INTO application_dispatch_fixture VALUES(business_ae,binding,release,workflow,ee);
 END LOOP;
END $$;
