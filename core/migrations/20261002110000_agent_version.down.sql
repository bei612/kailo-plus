-- 当前全新开发库无旧 writer；非空的版本权威不能通过 down 静默丢弃。
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM catalog.asset) THEN
        RAISE EXCEPTION '存在 Asset，停止回退 AgentVersion migration';
    END IF;
END $$;
DROP TRIGGER agent_published_pointer_guard ON catalog.agent_definition;
DROP FUNCTION catalog.guard_agent_published_pointer();
ALTER TABLE catalog.agent_definition DROP CONSTRAINT agent_definition_published_asset;
ALTER TABLE catalog.agent_definition ADD CONSTRAINT agent_definition_current_published_version_asset_id_check
    CHECK (current_published_version_asset_id IS NULL);
DROP TABLE catalog.agent_version;
DROP FUNCTION catalog.guard_agent_version();
DROP TABLE catalog.asset;
