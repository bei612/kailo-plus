-- Isolated PG fixture: original constraints/triggers stay enabled. No network or secrets.
CREATE TEMP TABLE absence_fixture(label text PRIMARY KEY,id uuid NOT NULL) ON COMMIT DROP;
DO $$
DECLARE
 tenant uuid:=gen_random_uuid(); workspace uuid:=gen_random_uuid();
 human uuid:=gen_random_uuid(); agent uuid:=gen_random_uuid(); control uuid:=gen_random_uuid();
 definition uuid:=gen_random_uuid(); version_asset uuid:=gen_random_uuid();
 installation uuid:=gen_random_uuid(); route uuid:=gen_random_uuid();
 activation uuid:=gen_random_uuid(); operation uuid:=gen_random_uuid();
 action uuid; op uuid; item record; n integer; event text;
 agent_pk text:=replace(gen_random_uuid()::text,'-','')||repeat('a',32);
 control_pk text:=replace(gen_random_uuid()::text,'-','')||repeat('c',32);
BEGIN
 INSERT INTO absence_fixture VALUES ('tenant',tenant),('workspace',workspace),('human',human),
   ('installation',installation),('activation',activation);
 INSERT INTO identity.tenant(id,slug,name,state) VALUES(tenant,'absence-'||tenant,'absence fixture','ACTIVE');
 INSERT INTO identity.workspace(id,tenant_id,slug,name,state) VALUES(workspace,tenant,'absence','absence fixture','ACTIVE');
 INSERT INTO identity.principal(id,tenant_id,kind,status) VALUES
   (human,tenant,'HUMAN','ACTIVE'),(agent,tenant,'AGENT','ACTIVE'),(control,tenant,'SERVICE','ACTIVE');
 INSERT INTO catalog.resource(id,tenant_id,type_key,home_workspace_id,owner_principal_id,component_type_key,native_id,state,version)
 VALUES (definition,tenant,'agent.definition',NULL,human,'core',definition::text,'PROVISIONING',1),
   (route,tenant,'llm_route',workspace,human,'core',route::text,'PROVISIONING',1),
   (installation,tenant,'agent.installation',workspace,human,'core',installation::text,'ACTIVE',1);
 INSERT INTO catalog.agent_definition(resource_id,stable_slug,display_name,status)
 VALUES(definition,'absence','absence fixture','PROVISIONING');
 INSERT INTO catalog.asset(id,tenant_id,resource_id,type_key,owner_principal_id,native_ref,state,version)
 VALUES(version_asset,tenant,definition,'agent.version',human,version_asset::text,'DRAFT',1);
 INSERT INTO catalog.agent_version(asset_id,agent_resource_id,ordinal,content,config_hash,state)
 VALUES(version_asset,definition,1,jsonb_build_object('runtimeProfileKey','absence','modelRouteResourceId',route,
   'personaIdentity',jsonb_build_object('displayName','Agent')),repeat('a',64),'DRAFT');
 INSERT INTO catalog.agent_installation(resource_id,workspace_id,agent_resource_id,pinned_version_asset_id,agent_principal_id,runtime_isolation_ref,state)
 VALUES(installation,workspace,definition,version_asset,agent,'fixture:'||installation,'PROVISIONING');
 INSERT INTO catalog.agent_runtime_projection(installation_resource_id,generation,agent_version_asset_id,runtime_profile_key,
   model_route_resource_id,gateway_resource_ids,effective_fields,config_hash,state)
 VALUES(installation,1,version_asset,'absence',route,'{}','[]',repeat('a',64),'ACTIVE');
 UPDATE catalog.agent_installation SET state='ACTIVE',active_projection_generation=1 WHERE resource_id=installation;
 INSERT INTO identity.buzz_identity_binding(tenant_id,principal_id,pubkey,custody,private_key_secret_ref,
   private_key_secret_version,private_key_secret_audience,private_key_secret_status,kind,state)
 VALUES (tenant,agent,agent_pk,'SERVER','fixture/agent',1,'fixture','ACTIVE','AGENT','ACTIVE'),
   (tenant,control,control_pk,'SERVER','fixture/control',1,'fixture','ACTIVE','CONTROL','ACTIVE');
 INSERT INTO projection.tenant_buzz_binding(tenant_id,community_id,normalized_host,control_service_principal_id,
   require_relay_membership,allow_nip_oa_auth,pubkey_allowlist_enabled,nip11_snapshot_digest,nip11_observed_at,state)
 VALUES(tenant,gen_random_uuid(),tenant||'.test',control,true,false,true,repeat('b',64),now(),'ACTIVE');
 INSERT INTO catalog.agent_memory_binding(installation_resource_id,agent_buzz_identity_binding_id,
   memory_counterparty_buzz_identity_binding_id,listing_state,head_state,state,version)
 VALUES(installation,agent_pk,control_pk,'COMPLETE','CONSISTENT','ACTIVE',1);
 INSERT INTO admission.action_execution(id,operation_id,tenant_id,workspace_id,action_key,action_version,
   initiator_principal_id,actor_principal_id,target_id,parameter_hash,parameters,gate_state,dispatch_state,correlation_id)
 VALUES(activation,operation,tenant,workspace,'agent.installation.create',1,human,human,installation,repeat('a',64),
   jsonb_build_object('params',jsonb_build_object('assetId',version_asset)),'ALLOWED','DISPATCHED',gen_random_uuid());
 FOR n IN 1..3 LOOP
   event:=replace(gen_random_uuid()::text,'-','')||repeat(n::text,32);
   INSERT INTO projection.agent_profile_publication(event_id,tenant_id,installation_resource_id,agent_pubkey,
     agent_version_asset_id,action_execution_id,operation_id,content_sha256,signed_at,state,created_at)
   VALUES(event,tenant,installation,agent_pk,version_asset,activation,operation,repeat('a',64),n,'DISPATCHED',now()+n*interval '1 second');
   UPDATE projection.agent_profile_publication SET state=CASE WHEN n=3 THEN 'ACCEPTED' ELSE 'NOT_DELIVERED' END,
     settled_at=now()-interval '1 day' WHERE event_id=event;
   INSERT INTO audit.audit_event(id,event_key,tenant_id,workspace_id,operation_id,event_type,actor_principal_id,
     action_key,action_version,component_type_key,target_type,target_id,parameter_hash,decision,result_code,result_exposure,evidence_refs,correlation_id)
   VALUES(gen_random_uuid(),activation||':installation:profile:'||event||CASE WHEN n=3 THEN ':outcome' ELSE ':reconciled' END,
     tenant,workspace,operation,CASE WHEN n=3 THEN 'OUTCOME' ELSE 'RECONCILIATION' END,agent,'agent.installation.create',1,'core',
     'RESOURCE',installation,repeat('a',64),'ALLOW',CASE WHEN n=3 THEN 'ACCEPTED' ELSE 'NOT_DELIVERED' END,'NONE','[]',gen_random_uuid());
 END LOOP;
 FOR item IN SELECT * FROM (VALUES
   ('canvas-false','workspace.canvas.set','DEPENDENCY_UNAVAILABLE','UNKNOWN'),
   ('canvas-rejected','workspace.canvas.set','PUBLISH_REJECTED','REJECTED'),
   ('canvas-limit','workspace.canvas.set','RATE_LIMITED','NOT_DELIVERED'),
   ('report-false','moderation.report.submit','DEPENDENCY_UNAVAILABLE','UNKNOWN'),
   ('delete-false','moderation.message.delete','DEPENDENCY_UNAVAILABLE','UNKNOWN'),
   ('report-rejected','moderation.report.submit','PUBLISH_REJECTED','REJECTED'),
   ('report-limit','moderation.report.submit','RATE_LIMITED','NOT_DELIVERED'),
   ('delete-size','moderation.message.delete','PAYLOAD_TOO_LARGE','NOT_DELIVERED')
 ) v(label,action_key,reason,ack) LOOP
   action:=gen_random_uuid(); op:=gen_random_uuid(); event:=replace(gen_random_uuid()::text,'-','')||repeat('e',32);
   INSERT INTO absence_fixture VALUES(item.label,action);
   INSERT INTO admission.action_execution(id,operation_id,tenant_id,workspace_id,action_key,action_version,
     initiator_principal_id,actor_principal_id,target_id,parameter_hash,gate_state,dispatch_state,reason_code,correlation_id)
   VALUES(action,op,tenant,CASE WHEN item.action_key='moderation.report.submit' THEN NULL ELSE workspace END,
     item.action_key,1,human,human,CASE WHEN item.action_key='moderation.report.submit' THEN tenant ELSE workspace END,
     repeat('a',64),'ALLOWED','ABORTED',item.reason,gen_random_uuid());
   IF item.action_key='workspace.canvas.set' THEN
     INSERT INTO admission.workspace_canvas_intent(action_execution_id,tenant_id,workspace_id,channel_id,control_pubkey,
       event_id,event_created_at,content_sha256,content_bytes,relay_ack,outcome,settled_at)
     VALUES(action,tenant,workspace,gen_random_uuid(),control_pk,event,1,repeat('a',64),3,item.ack,'NOT_WRITTEN',now());
   ELSE
     INSERT INTO admission.moderation_publication(action_execution_id,event_kind,event_id,signer_pubkey,event_created_at,outcome,settled_at)
     VALUES(action,CASE WHEN item.action_key='moderation.report.submit' THEN 1984 ELSE 9005 END,event,control_pk,1,
       CASE WHEN item.ack='REJECTED' THEN 'REJECTED' ELSE 'NOT_DELIVERED' END,now());
   END IF;
   INSERT INTO audit.audit_event(id,event_key,tenant_id,workspace_id,operation_id,event_type,actor_principal_id,
     action_key,action_version,component_type_key,target_type,target_id,parameter_hash,decision,result_code,result_exposure,evidence_refs,correlation_id)
   VALUES(gen_random_uuid(),CASE WHEN item.label='canvas-false' THEN 'canvas-set:'||op||':reconcile' ELSE op||':outcome' END,
     tenant,CASE WHEN item.action_key='moderation.report.submit' THEN NULL ELSE workspace END,op,
     CASE WHEN item.label='canvas-false' THEN 'RECONCILIATION' ELSE 'OUTCOME' END,human,item.action_key,1,'core',
     CASE WHEN item.action_key='moderation.report.submit' THEN 'TENANT' ELSE 'WORKSPACE' END,
     CASE WHEN item.action_key='moderation.report.submit' THEN tenant ELSE workspace END,repeat('a',64),'DENY',
     CASE WHEN item.label='canvas-false' THEN 'NOT_DELIVERED' ELSE item.reason END,'NONE','[]',gen_random_uuid());
 END LOOP;
END $$;
