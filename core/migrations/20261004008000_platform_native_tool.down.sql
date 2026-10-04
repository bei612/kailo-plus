DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM catalog.resource WHERE type_key='tool.definition') THEN
   RAISE EXCEPTION 'Tool Resource 历史存在，不允许回退其合同';
 END IF;
END; $$;
DROP TABLE catalog.tool_definition;
DROP FUNCTION catalog.guard_platform_tool_scope();
DELETE FROM catalog.resource_type_definition WHERE type_key='tool.definition';
ALTER TABLE catalog.resource DROP CONSTRAINT resource_type_key_check;
ALTER TABLE catalog.resource DROP CONSTRAINT resource_home_workspace_check;
ALTER TABLE catalog.resource ADD CONSTRAINT resource_type_key_check CHECK
 (type_key IN ('agent.definition','agent.installation','llm_route','automation'));
ALTER TABLE catalog.resource ADD CONSTRAINT resource_home_workspace_check CHECK
 ((type_key='agent.definition' AND home_workspace_id IS NULL)
  OR (type_key IN ('agent.installation','automation') AND home_workspace_id IS NOT NULL)
  OR type_key='llm_route');
