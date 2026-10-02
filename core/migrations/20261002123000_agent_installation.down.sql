-- 未发布的全新开发环境；有真实 Installation/Session 时停止回退，不删除业务事实。
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM catalog.agent_installation) THEN
        RAISE EXCEPTION 'Installation 非空：停止回退，须先按治理停用并处置运行引用';
    END IF;
END $$;
DROP TABLE catalog.agent_memory_binding;
DROP TABLE catalog.channel_agent_binding;
DROP FUNCTION catalog.guard_agent_binding_scope();
ALTER TABLE catalog.agent_installation DROP CONSTRAINT agent_installation_active_generation;
DROP TABLE catalog.agent_runtime_projection;
DROP FUNCTION catalog.guard_agent_runtime_projection();
DROP TABLE catalog.agent_installation;
DROP FUNCTION catalog.guard_agent_installation_scope();
DELETE FROM catalog.resource_type_definition WHERE type_key='agent.installation';
ALTER TABLE catalog.resource DROP CONSTRAINT resource_type_key_check;
ALTER TABLE catalog.resource DROP CONSTRAINT resource_home_workspace_check;
ALTER TABLE catalog.resource ADD CONSTRAINT resource_type_key_check CHECK (type_key='agent.definition');
ALTER TABLE catalog.resource ADD CONSTRAINT resource_home_workspace_id_check CHECK (home_workspace_id IS NULL);
