-- Reverse of DD-140's native tool map and owner policy. Refuses while any
-- project_channel_request tool row exists (the old constraint would reject it).
DELETE FROM catalog.approval_policy
 WHERE action_key='workspace.create' AND target_type='RESOURCE' AND owner_requirement='TARGET_OWNER'
   AND tenant_id IS NULL;
ALTER TABLE catalog.tool_definition DROP CONSTRAINT tool_definition_native_action_map;
ALTER TABLE catalog.tool_definition ADD CONSTRAINT tool_definition_name_check
 CHECK (name IN ('agent.memory.entry.list','agent.memory.entry.read'));
ALTER TABLE catalog.tool_definition ADD CONSTRAINT tool_definition_action_key_check
 CHECK (action_key = name);
