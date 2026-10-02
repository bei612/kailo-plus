-- 当前全新开发库；存在真实 route 时拒绝收缩而不是丢失 credential/native 对账引用。
DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM catalog.resource WHERE type_key='llm_route') THEN
        RAISE EXCEPTION '停止回滚：先完成受治理 llm_route 与 credential 退役';
    END IF;
END $$;
DROP TABLE catalog.agent_model_binding;
DROP FUNCTION catalog.guard_agent_model_binding_scope();
DROP TABLE catalog.model_route;
DROP FUNCTION catalog.guard_model_route_scope();
DELETE FROM catalog.resource_type_definition WHERE type_key='llm_route';
ALTER TABLE catalog.resource DROP CONSTRAINT resource_type_key_check;
ALTER TABLE catalog.resource DROP CONSTRAINT resource_home_workspace_check;
ALTER TABLE catalog.resource ADD CONSTRAINT resource_type_key_check
    CHECK (type_key IN ('agent.definition','agent.installation'));
ALTER TABLE catalog.resource ADD CONSTRAINT resource_home_workspace_check
    CHECK ((type_key='agent.definition')=(home_workspace_id IS NULL));
