-- 真实 Route/意图必须先沿 Tenant 删除收缩；不能删除正在消费的创建目录或凭据引用。
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM catalog.model_route_projection)
        OR EXISTS (SELECT 1 FROM admission.action_execution WHERE action_key='llm_route.create') THEN
        RAISE EXCEPTION 'Route 创建已被消费，必须先完成受治理销毁' USING ERRCODE='restrict_violation';
    END IF;
END $$;
DELETE FROM catalog.action_definition WHERE action_key='llm_route.create' AND version=1;
UPDATE catalog.resource_type_definition SET status='DRAFT' WHERE type_key='llm_route';
DROP TABLE catalog.model_route_projection;
DROP FUNCTION catalog.guard_model_route_projection();
ALTER TABLE catalog.action_definition DROP CONSTRAINT action_workspace_rule_enum;
ALTER TABLE catalog.action_definition ADD CONSTRAINT action_workspace_rule_enum
    CHECK (workspace_rule IN ('TENANT_ONLY','WORKSPACE_REQUIRED','TARGET_HOME_WORKSPACE','INHERIT_PARENT'));
