-- DD-149 database guard smoke test (run inside a throwaway database after migrations).
-- Valid connector/tool rows are accepted; invalid shapes are refused by the CHECKs and
-- triggers. Prints PASS lines and fails (non-zero exit) on the first violated expectation.
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE ids AS SELECT gen_random_uuid() tenant, gen_random_uuid() human, gen_random_uuid() other,
  gen_random_uuid() ae, gen_random_uuid() conn, gen_random_uuid() tool, gen_random_uuid() ws;
INSERT INTO identity.tenant(id,slug,name,state) SELECT tenant,'dd149-'||tenant,'dd149','ACTIVE' FROM ids;
INSERT INTO identity.principal(id,tenant_id,kind,status) SELECT human,tenant,'HUMAN','ACTIVE' FROM ids;
INSERT INTO identity.principal(id,tenant_id,kind,status) SELECT other,tenant,'HUMAN','ACTIVE' FROM ids;
INSERT INTO identity.human_identity(id,display_name,status) SELECT h,'dd149','ACTIVE' FROM ids, (SELECT human h FROM ids UNION ALL SELECT other FROM ids) x;
INSERT INTO identity.tenant_membership(id,tenant_id,human_identity_id,tenant_principal_id,state)
  SELECT gen_random_uuid(),tenant,h,h,'ACTIVE' FROM ids, (SELECT human h FROM ids UNION ALL SELECT other FROM ids) x;
INSERT INTO admission.action_execution(id,operation_id,tenant_id,action_key,action_version,initiator_principal_id,
  actor_principal_id,target_id,parameter_hash,gate_state,dispatch_state,correlation_id)
  SELECT ae,gen_random_uuid(),tenant,'mcp_connection.create',1,human,human,conn,repeat('0',64),'ALLOWED','NOT_DISPATCHED',gen_random_uuid() FROM ids;
INSERT INTO catalog.resource(id,tenant_id,type_key,home_workspace_id,owner_principal_id,component_type_key,native_type,native_id,state,version,projection_action_execution_id)
  SELECT conn,tenant,'mcp.connection',null,human,'core','mcp.connection',conn::text,'PROVISIONING',1,ae FROM ids;
INSERT INTO catalog.mcp_connection(resource_id,tenant_id,slug,display_name,endpoint_url,endpoint_host,transport,auth_mode,api_key_header,
  visibility,workspace_id,credential_ref,oauth,shared_authorization_consent,active_generation,state,version,created_by_action_execution_id)
  SELECT conn,tenant,'acc','Acceptance','https://mcp.example.com/mcp','mcp.example.com','STREAMABLE_HTTP','API_KEY','x-api-key',
  'TENANT',null,'{"locator":"tenants/t/kv/mcp-connection/x","version":1,"audience":"core"}',null,false,1,'ACTIVE',1,ae FROM ids;
INSERT INTO catalog.mcp_connection_generation(resource_id,generation,server_info,tools_digest,tools,action_execution_id)
  SELECT conn,1,'{}',repeat('a',64),'[]',ae FROM ids;
INSERT INTO catalog.resource(id,tenant_id,type_key,home_workspace_id,owner_principal_id,component_type_key,native_type,native_id,state,version,projection_action_execution_id)
  SELECT tool,tenant,'tool.definition',null,human,'core','tool.definition',tool::text,'PROVISIONING',1,ae FROM ids;
INSERT INTO catalog.tool_definition(resource_id,name,source,action_key,capability_contract_key,input_schema_hash,output_schema_hash,
  backend_ref,status,mcp_connection_id,upstream_name,risk,risk_declared,first_generation,input_schema,annotations)
  SELECT tool,'acc__echo','USER_REGISTERED_EXTERNAL','mcp_connection.tool.invoke',null,repeat('b',64),repeat('c',64),
  'CORE_EXTERNAL_MCP_RELAY','PROVISIONING',conn,'echo','READ_ONLY',false,1,'{"type":"object"}','{}' FROM ids;
UPDATE catalog.resource SET state='ACTIVE',projection_action_execution_id=null WHERE id IN (SELECT conn FROM ids UNION SELECT tool FROM ids);
UPDATE catalog.tool_definition SET status='ACTIVE' WHERE resource_id=(SELECT tool FROM ids);
\echo PASS valid connector, generation and connector tool accepted

CREATE TEMP TABLE expectations(label text, sql text);
INSERT INTO expectations VALUES
 ('auto policy on a write tool', $$UPDATE catalog.tool_definition SET risk='WRITE' WHERE resource_id=(SELECT tool FROM ids)$$),
 ('tool declaration rewrite', $$UPDATE catalog.tool_definition SET input_schema='{"type":"object","properties":{}}' WHERE resource_id=(SELECT tool FROM ids)$$),
 ('connector endpoint rewrite', $$UPDATE catalog.mcp_connection SET endpoint_url='https://evil.example.com/mcp',version=version+1 WHERE resource_id=(SELECT conn FROM ids)$$),
 ('connector update without version step', $$UPDATE catalog.mcp_connection SET display_name='x' WHERE resource_id=(SELECT conn FROM ids)$$),
 ('generation rewrite', $$UPDATE catalog.mcp_connection_generation SET tools_digest=repeat('d',64) WHERE resource_id=(SELECT conn FROM ids)$$),
 ('workspace visibility without workspace', $$UPDATE catalog.mcp_connection SET visibility='WORKSPACE',version=version+1 WHERE resource_id=(SELECT conn FROM ids)$$),
 ('tool owned by another principal', $$INSERT INTO catalog.resource(id,tenant_id,type_key,home_workspace_id,owner_principal_id,component_type_key,native_type,native_id,state,version)
    SELECT t,tenant,'tool.definition',null,other,'core','tool.definition',t::text,'ACTIVE',1 FROM ids, gen_random_uuid() t;
    INSERT INTO catalog.tool_definition(resource_id,name,source,action_key,input_schema_hash,output_schema_hash,backend_ref,status,mcp_connection_id,upstream_name,risk,risk_declared,first_generation,input_schema)
    SELECT r.id,'acc__other','USER_REGISTERED_EXTERNAL','mcp_connection.tool.invoke_confirmed',repeat('b',64),repeat('c',64),'CORE_EXTERNAL_MCP_RELAY','ACTIVE',(SELECT conn FROM ids),'other','WRITE',false,1,'{"type":"object"}'
    FROM catalog.resource r WHERE r.owner_principal_id=(SELECT other FROM ids) AND r.type_key='tool.definition'$$),
 ('bad connector tool name', $$INSERT INTO catalog.resource(id,tenant_id,type_key,owner_principal_id,component_type_key,native_type,native_id,state,version)
    SELECT t,tenant,'tool.definition',human,'core','tool.definition',t::text,'ACTIVE',1 FROM ids, gen_random_uuid() t;
    INSERT INTO catalog.tool_definition(resource_id,name,source,action_key,input_schema_hash,output_schema_hash,backend_ref,status,mcp_connection_id,upstream_name,risk,risk_declared,first_generation,input_schema)
    SELECT r.id,'no separator','USER_REGISTERED_EXTERNAL','mcp_connection.tool.invoke',repeat('b',64),repeat('c',64),'CORE_EXTERNAL_MCP_RELAY','ACTIVE',(SELECT conn FROM ids),'x','READ_ONLY',false,1,'{"type":"object"}'
    FROM catalog.resource r WHERE r.state='ACTIVE' AND r.type_key='tool.definition' AND NOT EXISTS (SELECT 1 FROM catalog.tool_definition d WHERE d.resource_id=r.id) LIMIT 1$$),
 ('native tool with connector fields', $$INSERT INTO catalog.tool_definition(resource_id,name,source,action_key,input_schema_hash,output_schema_hash,backend_ref,status,upstream_name)
    SELECT gen_random_uuid(),'agent.memory.entry.list','PLATFORM_NATIVE','agent.memory.entry.list',repeat('b',64),repeat('c',64),'CORE_STREAMABLE_MCP','ACTIVE','x'$$);
DO $$
DECLARE e record; refused boolean;
BEGIN
  FOR e IN SELECT * FROM expectations LOOP
    refused := false;
    BEGIN
      EXECUTE e.sql;
    EXCEPTION WHEN others THEN refused := true;
    END;
    IF NOT refused THEN
      RAISE EXCEPTION 'FAIL % was accepted', e.label;
    END IF;
    RAISE NOTICE 'PASS refused: %', e.label;
  END LOOP;
END $$;

-- OAuth with a shared visibility needs explicit consent (CHECK on the row).
DO $$
DECLARE refused boolean := false; c uuid := gen_random_uuid(); a uuid := gen_random_uuid();
BEGIN
  INSERT INTO admission.action_execution(id,operation_id,tenant_id,action_key,action_version,initiator_principal_id,
    actor_principal_id,target_id,parameter_hash,gate_state,dispatch_state,correlation_id)
    SELECT a,gen_random_uuid(),tenant,'mcp_connection.create',1,human,human,c,repeat('0',64),'ALLOWED','NOT_DISPATCHED',gen_random_uuid() FROM ids;
  INSERT INTO catalog.resource(id,tenant_id,type_key,owner_principal_id,component_type_key,native_type,native_id,state,version)
    SELECT c,tenant,'mcp.connection',human,'core','mcp.connection',c::text,'ACTIVE',1 FROM ids;
  BEGIN
    INSERT INTO catalog.mcp_connection(resource_id,tenant_id,slug,display_name,endpoint_url,endpoint_host,transport,auth_mode,
      visibility,credential_ref,oauth,shared_authorization_consent,active_generation,state,created_by_action_execution_id)
      SELECT c,tenant,'oauthed','O','https://o.example.com/mcp','o.example.com','STREAMABLE_HTTP','OAUTH','TENANT',
      '{"locator":"l","version":1,"audience":"a"}','{}',false,1,'ACTIVE',a FROM ids;
  EXCEPTION WHEN others THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'FAIL oauth TENANT connector without consent accepted'; END IF;
  RAISE NOTICE 'PASS refused: oauth shared without consent';
END $$;

-- Tombstone: tool and connector move to DELETED and stay there.
UPDATE catalog.resource SET state='DELETED' WHERE id=(SELECT tool FROM ids);
UPDATE catalog.tool_definition SET status='DELETED' WHERE resource_id=(SELECT tool FROM ids);
UPDATE catalog.mcp_connection SET state='DELETED',version=version+1 WHERE resource_id=(SELECT conn FROM ids);
DO $$
BEGIN
  BEGIN
    UPDATE catalog.mcp_connection SET state='ACTIVE',version=version+1 WHERE resource_id=(SELECT conn FROM ids);
  EXCEPTION WHEN others THEN RAISE NOTICE 'PASS refused: deleted connector reactivation'; RETURN;
  END;
  RAISE EXCEPTION 'FAIL deleted connector reactivated';
END $$;
\echo PASS tombstones are final
ROLLBACK;
