-- 不抹去真实触发/委托使用或历史版本：有任何对象即停止回退。
DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM catalog.automation_definition)
        OR EXISTS(SELECT 1 FROM catalog.automation_version)
        OR EXISTS(SELECT 1 FROM catalog.agent_invocation WHERE automation_resource_id IS NOT NULL)
        OR EXISTS(SELECT 1 FROM catalog.resource WHERE type_key='automation')
        OR EXISTS(SELECT 1 FROM catalog.asset WHERE type_key='automation.version')
        OR EXISTS(SELECT 1 FROM admission.action_execution WHERE action_key='automation.run') THEN
        RAISE EXCEPTION 'Automation 仍有事实，停止收缩' USING ERRCODE='restrict_violation';
    END IF;
END $$;
DROP TRIGGER automation_invocation_guard ON catalog.agent_invocation;
DROP FUNCTION catalog.guard_automation_invocation();
DROP INDEX catalog.invocation_automation_trigger;
DROP INDEX catalog.invocation_agent_trigger;
ALTER TABLE catalog.agent_invocation DROP CONSTRAINT invocation_automation_pair;
ALTER TABLE catalog.agent_invocation DROP COLUMN automation_resource_id;
ALTER TABLE catalog.agent_invocation ADD UNIQUE(tenant_id,source_event_id,installation_resource_id);
ALTER TABLE catalog.automation_definition DROP CONSTRAINT automation_pinned_version;
DROP TABLE catalog.automation_version;
DROP TABLE catalog.automation_definition;
DROP FUNCTION catalog.guard_automation_scope();
DELETE FROM catalog.resource_type_definition WHERE type_key='automation';
ALTER TABLE catalog.asset DROP CONSTRAINT asset_type_key_check;
ALTER TABLE catalog.asset ADD CONSTRAINT asset_type_key_check CHECK(type_key='agent.version');
ALTER TABLE catalog.resource DROP CONSTRAINT resource_type_key_check;
ALTER TABLE catalog.resource DROP CONSTRAINT resource_home_workspace_check;
ALTER TABLE catalog.resource ADD CONSTRAINT resource_type_key_check
    CHECK(type_key IN ('agent.definition','agent.installation','llm_route'));
ALTER TABLE catalog.resource ADD CONSTRAINT resource_home_workspace_check CHECK(
    (type_key='agent.definition' AND home_workspace_id IS NULL)
    OR (type_key='agent.installation' AND home_workspace_id IS NOT NULL) OR type_key='llm_route');
