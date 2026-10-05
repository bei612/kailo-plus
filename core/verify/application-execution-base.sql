-- Isolated constraint fixtures only; no native report, authorized Catalog action,
-- binding activation, credentials, model call or business E2E is claimed.
BEGIN;
INSERT INTO identity.tenant(id,slug,name,state) VALUES
 ('00000000-0000-0000-0000-000000000001','category-retire-sjorky','isolated category constraint fixture','ACTIVE');
INSERT INTO identity.human_identity(id,display_name,status) VALUES
 ('00000000-0000-0000-0000-000000000010','isolated registrar','ACTIVE'),
 ('00000000-0000-0000-0000-000000000020','isolated approver','ACTIVE');
INSERT INTO identity.principal(id,tenant_id,kind,status) VALUES
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','HUMAN','ACTIVE'),
 ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000001','HUMAN','ACTIVE'),
 ('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000001','SERVICE','ACTIVE'),
 ('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000001','SERVICE','ACTIVE');
INSERT INTO identity.tenant_membership(id,tenant_id,human_identity_id,tenant_principal_id,state) VALUES
 ('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000011','ACTIVE'),
 ('00000000-0000-0000-0000-000000000023','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000021','ACTIVE');
INSERT INTO identity.service_principal(principal_id,audience) VALUES
 ('00000000-0000-0000-0000-000000000030','isolated-category-binding-one'),
 ('00000000-0000-0000-0000-000000000031','isolated-category-binding-two');
INSERT INTO identity.relay_operator_identity(catalog_tenant_id,pubkey,private_key_secret_ref,audience,relay_operator_api_origin,state) VALUES
 ('00000000-0000-0000-0000-000000000001',repeat('9',64),'unresolved-isolated-fixture','isolated-category-catalog','https://invalid.example','PENDING_SECRET');
DO $$ DECLARE category text; contract uuid; register_ae uuid; approve_ae uuid; retire_ae uuid;
BEGIN
  FOREACH category IN ARRAY ARRAY['retire_plain','retire_with_binding','retire_rr_create','retire_rr_retire'] LOOP
    contract:=gen_random_uuid(); register_ae:=gen_random_uuid(); approve_ae:=gen_random_uuid(); retire_ae:=gen_random_uuid();
    INSERT INTO admission.action_execution(id,operation_id,tenant_id,action_key,action_version,
      initiator_principal_id,actor_principal_id,target_id,parameter_hash,parameters,gate_state,dispatch_state,correlation_id)
    VALUES (register_ae,register_ae,'00000000-0000-0000-0000-000000000001','capability_contract.register',1,
      '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000011',contract,repeat('1',64),
      jsonb_build_object('targetVersion',1,'params',jsonb_build_object('capabilityContractRegistration',jsonb_build_object('categoryKey',category))),
      'ALLOWED','DISPATCHED',register_ae);
    INSERT INTO catalog.capability_category(category_key,catalog_tenant_id,type_key_namespace,origin,registered_by_action_execution_id,status)
    VALUES (category,'00000000-0000-0000-0000-000000000001',category,'CATALOG_REGISTERED',register_ae,'DRAFT');
    INSERT INTO catalog.capability_contract(id,category_key,contract_version,catalog_tenant_id,content,schema_documents,test_vectors,
      schema_set_digest,conformance_suite_digest,origin,registered_by_action_execution_id,status)
    VALUES (contract,category,1,'00000000-0000-0000-0000-000000000001',jsonb_build_object('categoryKey',category,'contractVersion',1),
      '[{"schema":{"type":"object"}}]','{"formatVersion":"V1","cases":[{"caseKey":"isolated","steps":[]}]}',repeat('1',64),repeat('2',64),'CATALOG_REGISTERED',register_ae,'DRAFT');
    INSERT INTO admission.action_execution(id,operation_id,tenant_id,action_key,action_version,
      initiator_principal_id,actor_principal_id,target_id,parameter_hash,parameters,gate_state,dispatch_state,correlation_id)
    VALUES (approve_ae,approve_ae,'00000000-0000-0000-0000-000000000001','capability_contract.approve',1,
      '00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000021',contract,repeat('2',64),
      '{"targetVersion":1}','ALLOWED','DISPATCHED',approve_ae);
    UPDATE catalog.capability_contract SET status='ACTIVE',approved_by_action_execution_id=approve_ae WHERE id=contract;
    UPDATE catalog.capability_category SET status='ACTIVE' WHERE category_key=category;
    INSERT INTO admission.action_execution(id,operation_id,tenant_id,action_key,action_version,
      initiator_principal_id,actor_principal_id,target_id,parameter_hash,parameters,gate_state,dispatch_state,correlation_id)
    SELECT retire_ae,retire_ae,catalog_tenant_id,'capability_category.retire',1,
      '00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000021',target_id,repeat('3',64),
      jsonb_build_object('targetVersion',0,'params',jsonb_build_object('capabilityCategoryKey',category,'explicitConfirmation',true)),
      'ALLOWED','DISPATCHED',retire_ae FROM catalog.capability_category WHERE category_key=category;
  END LOOP;
END $$;
-- Minimum original Release foreign-key facts. REGISTERED, never APPROVED;
-- these isolated wire-shaped fixtures are not a native conformance success.
INSERT INTO admission.action_execution(id,operation_id,tenant_id,action_key,action_version,initiator_principal_id,actor_principal_id,
 target_id,parameter_hash,gate_state,dispatch_state,correlation_id,component_conformance_plan,component_conformance_observation)
VALUES ('00000000-0000-0000-0000-000000000100','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001',
 'component_release.register',1,'00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000011',
 '00000000-0000-0000-0000-000000000103',repeat('4',64),'ALLOWED','DISPATCHED','00000000-0000-0000-0000-000000000102',
 '{"planDigest":"isolated","suiteDigest":"isolated","contractDigests":[]}',
 jsonb_build_object('actionExecutionId','00000000-0000-0000-0000-000000000100','operationId','00000000-0000-0000-0000-000000000101',
   'workflowId','isolated-category-release','runId','isolated-run','componentReleaseId','00000000-0000-0000-0000-000000000103',
   'artifactDigest',repeat('5',64),'planDigest','isolated','suiteDigest','isolated','contractDigests','[]'::jsonb,'observations','[{}]'::jsonb));
INSERT INTO projection.workflow_ref(workflow_id,run_id,workflow_type,workflow_version,kind,tenant_id,operation_id,action_execution_id,projection_state)
VALUES ('isolated-category-release','isolated-run','ComponentTaskWorkflow',1,'COMPONENT_RELEASE','00000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000100','RUNNING');
INSERT INTO projection.task_projection(workflow_id,run_id,last_event_id,status)
VALUES ('isolated-category-release','isolated-run',1,'RUNNING');
INSERT INTO catalog.component_definition(type_key,catalog_tenant_id,class,platform_port_key,status)
VALUES ('retire_fixture_adapter','00000000-0000-0000-0000-000000000001','APPLICATION','NONE','ACTIVE');
INSERT INTO catalog.component_release(id,component_type_key,catalog_tenant_id,version,manifest,component_package,binding_config_schema,
 manifest_digest,component_package_digest,adapter_build_ref,registered_by_action_execution_id,status)
VALUES ('00000000-0000-0000-0000-000000000103','retire_fixture_adapter','00000000-0000-0000-0000-000000000001','isolated-v1',
 '{}','{}','{}',repeat('5',64),repeat('5',64),repeat('5',64),'00000000-0000-0000-0000-000000000100','REGISTERED');
COMMIT;
