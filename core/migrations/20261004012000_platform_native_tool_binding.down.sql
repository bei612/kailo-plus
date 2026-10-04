DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM catalog.tool_binding) OR EXISTS(SELECT 1 FROM catalog.agent_tool_gateway_projection) THEN
   RAISE EXCEPTION 'ToolBinding history exists; rollback cannot remove governed facts';
 END IF;
END; $$;
DROP TABLE catalog.agent_tool_gateway_projection;
DROP TABLE catalog.tool_binding;
DROP FUNCTION catalog.guard_platform_tool_binding();
