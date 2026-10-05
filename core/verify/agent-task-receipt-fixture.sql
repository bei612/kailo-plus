DO $$
DECLARE
  tenant uuid:='__TENANT__'; workspace uuid:=gen_random_uuid();
  human uuid:=gen_random_uuid(); human_identity uuid:=gen_random_uuid();
  agent_a uuid:=gen_random_uuid(); agent_b uuid:=gen_random_uuid();
  definition uuid:=gen_random_uuid(); version_asset uuid:=gen_random_uuid();
  installation_a uuid:=gen_random_uuid(); installation_b uuid:=gen_random_uuid();
  route uuid:=gen_random_uuid(); installation uuid; invocation uuid; action uuid;
  n integer; gateway uuid:=gen_random_uuid(); route_action uuid:=gen_random_uuid();
BEGIN
  INSERT INTO identity.tenant(id,slug,name,state)
    VALUES(tenant,'session-dispatch-'||tenant,'Session dispatch fixture','ACTIVE');
  INSERT INTO identity.workspace(id,tenant_id,slug,name,state)
    VALUES(workspace,tenant,'session-dispatch','Session dispatch fixture','ACTIVE');
  INSERT INTO identity.human_identity(id,display_name,status)
    VALUES(human_identity,'Session dispatch fixture','ACTIVE');
  INSERT INTO identity.principal(id,tenant_id,kind,status) VALUES
    (human,tenant,'HUMAN','ACTIVE'),(agent_a,tenant,'AGENT','ACTIVE'),(agent_b,tenant,'AGENT','ACTIVE');
  INSERT INTO identity.tenant_membership(id,tenant_id,human_identity_id,tenant_principal_id,state)
    VALUES(gen_random_uuid(),tenant,human_identity,human,'ACTIVE');
  INSERT INTO catalog.resource(id,tenant_id,type_key,home_workspace_id,owner_principal_id,
    component_type_key,native_id,state,version) VALUES
    (definition,tenant,'agent.definition',NULL,human,'core',definition::text,'PROVISIONING',1),
    (route,tenant,'llm_route',workspace,human,'core',route::text,'PROVISIONING',1),
    (installation_a,tenant,'agent.installation',workspace,human,'core',installation_a::text,'PROVISIONING',1),
    (installation_b,tenant,'agent.installation',workspace,human,'core',installation_b::text,'PROVISIONING',1);
  INSERT INTO catalog.agent_definition(resource_id,stable_slug,display_name,status)
    VALUES(definition,'session-dispatch','Session dispatch fixture','PROVISIONING');
  INSERT INTO catalog.asset(id,tenant_id,resource_id,type_key,owner_principal_id,native_ref,state,version)
    VALUES(version_asset,tenant,definition,'agent.version',human,version_asset::text,'DRAFT',1);
  INSERT INTO catalog.agent_version(asset_id,agent_resource_id,ordinal,content,config_hash,state)
    VALUES(version_asset,definition,1,
      jsonb_build_object('runtimeProfileKey','session-dispatch-fixture','modelRouteResourceId',route),
      repeat('a',64),'DRAFT');
  INSERT INTO catalog.agent_installation(resource_id,workspace_id,agent_resource_id,pinned_version_asset_id,
    agent_principal_id,runtime_isolation_ref,state) VALUES
    (installation_a,workspace,definition,version_asset,agent_a,'fixture:'||installation_a,'PROVISIONING'),
    (installation_b,workspace,definition,version_asset,agent_b,'fixture:'||installation_b,'PROVISIONING');
  INSERT INTO catalog.agent_runtime_projection(installation_resource_id,generation,agent_version_asset_id,
    runtime_profile_key,model_route_resource_id,gateway_resource_ids,effective_fields,config_hash,state) VALUES
    (installation_a,1,version_asset,'session-dispatch-fixture',route,'{}','[]',repeat('a',64),'PENDING'),
    (installation_b,1,version_asset,'session-dispatch-fixture',route,'{}','[]',repeat('a',64),'PENDING');
  INSERT INTO catalog.agent_session(tenant_id,workspace_id,root_event_id,installation_resource_id,
    agent_version_asset_id,projection_generation,runtime_thread_id,core_memory_state,status) VALUES
    (tenant,workspace,repeat('a',64),installation_a,version_asset,1,gen_random_uuid()::text,'ABSENT','ACTIVE'),
    (tenant,workspace,repeat('a',64),installation_b,version_asset,1,gen_random_uuid()::text,'ABSENT','ACTIVE'),
    (tenant,workspace,repeat('b',64),installation_a,version_asset,1,gen_random_uuid()::text,'ABSENT','ACTIVE'),
    (tenant,workspace,repeat('c',64),installation_a,version_asset,1,NULL,'ABSENT','PENDING');
  FOR n IN 1..4 LOOP
    installation:=CASE WHEN n=3 THEN installation_b ELSE installation_a END;
    invocation:=gen_random_uuid(); action:=gen_random_uuid();
    INSERT INTO admission.action_execution(id,operation_id,tenant_id,workspace_id,action_key,action_version,
      initiator_principal_id,actor_principal_id,target_id,parameter_hash,gate_state,dispatch_state,correlation_id)
      VALUES(action,gen_random_uuid(),tenant,workspace,'agent.invoke',1,
        human,CASE WHEN n=3 THEN agent_b ELSE agent_a END,installation,repeat('a',64),'ALLOWED','DISPATCHED',gen_random_uuid());
    INSERT INTO catalog.agent_invocation(id,tenant_id,workspace_id,root_event_id,source_event_id,
      installation_resource_id,agent_version_asset_id,projection_generation,action_execution_id,workflow_id,status)
      VALUES(invocation,tenant,workspace,CASE WHEN n=4 THEN repeat('b',64) ELSE repeat('a',64) END,
        repeat(n::text,64),installation,version_asset,1,action,'session-dispatch:'||invocation,'CREATED');
  END LOOP;
  INSERT INTO identity.principal(id,tenant_id,kind,status) VALUES(gateway,tenant,'SERVICE','ACTIVE');
  INSERT INTO identity.service_principal(principal_id,audience) VALUES(gateway,'receipt-fixture:'||gateway);
  INSERT INTO admission.action_execution(id,operation_id,tenant_id,workspace_id,action_key,action_version,
    initiator_principal_id,actor_principal_id,target_id,parameter_hash,gate_state,dispatch_state,correlation_id)
    VALUES(route_action,gen_random_uuid(),tenant,workspace,'agent.installation.create',1,
      human,human,route,repeat('a',64),'ALLOWED','DISPATCHED',gen_random_uuid());
  INSERT INTO catalog.model_route(resource_id,action_execution_id,native_revision,native_config_hash)
    VALUES(route,route_action,1,repeat('a',64));
  INSERT INTO catalog.agent_model_binding(installation_resource_id,projection_generation,model_route_resource_id,
    action_execution_id,gateway_principal_id,secret_locator,secret_audience,secret_status)
    SELECT installation_a,1,route,i.action_execution_id,gateway,'receipt-fixture/'||gateway,'fixture','PENDING'
    FROM catalog.agent_invocation i WHERE i.tenant_id=tenant AND i.source_event_id=repeat('1',64);
  INSERT INTO projection.openmeter_binding(tenant_id,namespace,customer_id,subject_key_prefix,status)
    VALUES(tenant,'receipt-fixture',tenant::text,tenant||':','ACTIVE');
END $$;
