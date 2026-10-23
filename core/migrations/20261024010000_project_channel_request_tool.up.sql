-- DD-140 / SF-BUZ-61(2): the PLATFORM_NATIVE tool `project_channel_request` is
-- the one native tool bound to another action key (`workspace.create`). The map
-- stays closed: memory tools remain their own action, nothing else is accepted.
-- The PLATFORM_NATIVE branch lives in the explicitly named
-- tool_definition_source_contract (20261005013000); it is rebuilt under the same
-- name with the APPLICATION branch unchanged.
ALTER TABLE catalog.tool_definition DROP CONSTRAINT tool_definition_source_contract;
ALTER TABLE catalog.tool_definition ADD CONSTRAINT tool_definition_source_contract CHECK
 ((source='PLATFORM_NATIVE'
   AND ((name IN ('agent.memory.entry.list','agent.memory.entry.read') AND action_key=name)
     OR (name='project_channel_request' AND action_key='workspace.create'))
   AND capability_contract_key IS NULL AND backend_ref='CORE_STREAMABLE_MCP'
   AND application_projection_generation IS NULL) OR
  (source='APPLICATION' AND name<>'' AND action_key=capability_contract_key
   AND backend_ref<>'' AND application_projection_generation>0));

-- The proposal always waits for the Installation owner (frozen as the affected
-- owner; owner self-approval allowed). It is a system catalog policy like the
-- other platform policies, with the existing member-approval expiry convention.
INSERT INTO catalog.approval_policy
 (id,version,action_key,target_type,role_requirements,owner_requirement,self_approval,expires_in_seconds,status)
SELECT gen_random_uuid(),1,'workspace.create','RESOURCE','[]','TARGET_OWNER','ALLOW',
 expires_in_seconds,'ACTIVE'
FROM catalog.approval_policy WHERE action_key='tenant.member.revoke' AND status='ACTIVE'
  AND tenant_id IS NULL;
