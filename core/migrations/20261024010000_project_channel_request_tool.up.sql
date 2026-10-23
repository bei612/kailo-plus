-- DD-140 / SF-BUZ-61(2): the PLATFORM_NATIVE tool `project_channel_request` is
-- the one native tool bound to another action key (`workspace.create`). The map
-- stays closed: memory tools remain their own action, nothing else is accepted.
ALTER TABLE catalog.tool_definition DROP CONSTRAINT tool_definition_name_check;
ALTER TABLE catalog.tool_definition DROP CONSTRAINT tool_definition_action_key_check;
ALTER TABLE catalog.tool_definition ADD CONSTRAINT tool_definition_native_action_map CHECK (
 (name IN ('agent.memory.entry.list','agent.memory.entry.read') AND action_key = name)
 OR (name = 'project_channel_request' AND action_key = 'workspace.create'));

-- The proposal always waits for the Installation owner (frozen as the affected
-- owner; owner self-approval allowed). It is a system catalog policy like the
-- other platform policies, with the existing member-approval expiry convention.
INSERT INTO catalog.approval_policy
 (id,version,action_key,target_type,role_requirements,owner_requirement,self_approval,expires_in_seconds,status)
SELECT gen_random_uuid(),1,'workspace.create','RESOURCE','[]','TARGET_OWNER','ALLOW',
 expires_in_seconds,'ACTIVE'
FROM catalog.approval_policy WHERE action_key='tenant.member.revoke' AND status='ACTIVE'
  AND tenant_id IS NULL;
