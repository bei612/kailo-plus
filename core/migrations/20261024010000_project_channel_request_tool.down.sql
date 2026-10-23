-- Reverse of DD-140's native tool map and owner policy. Refuses while any
-- project_channel_request ToolDefinition exists: the restored memory-only
-- contract would reject it, and its Resource, bindings and grants are not
-- removable by a schema rollback.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM catalog.tool_definition WHERE name='project_channel_request') THEN
   RAISE EXCEPTION 'project_channel_request ToolDefinitions exist; roll back by stopping the release, not the schema'
     USING ERRCODE='55000';
 END IF;
END $$;
DELETE FROM catalog.approval_policy
 WHERE action_key='workspace.create' AND target_type='RESOURCE' AND owner_requirement='TARGET_OWNER'
   AND tenant_id IS NULL;
ALTER TABLE catalog.tool_definition DROP CONSTRAINT tool_definition_source_contract;
ALTER TABLE catalog.tool_definition ADD CONSTRAINT tool_definition_source_contract CHECK
 ((source='PLATFORM_NATIVE' AND name IN ('agent.memory.entry.list','agent.memory.entry.read')
   AND action_key=name AND capability_contract_key IS NULL AND backend_ref='CORE_STREAMABLE_MCP'
   AND application_projection_generation IS NULL) OR
  (source='APPLICATION' AND name<>'' AND action_key=capability_contract_key
   AND backend_ref<>'' AND application_projection_generation>0));
