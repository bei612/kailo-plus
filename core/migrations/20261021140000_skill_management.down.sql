-- 不删除真实 Skill 事实或历史 ActionExecution 来强行收缩合同。
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM admission.action_execution WHERE action_key LIKE 'skill.%')
        OR EXISTS (SELECT 1 FROM catalog.resource WHERE type_key = 'skill.definition')
        OR EXISTS (SELECT 1 FROM catalog.asset WHERE type_key = 'skill.version')
        OR EXISTS (SELECT 1 FROM admission.skill_artifact_upload) THEN
        RAISE EXCEPTION 'Skill 合同已被真实事实引用，停止收缩' USING ERRCODE = 'restrict_violation';
    END IF;
END $$;

DELETE FROM catalog.action_definition WHERE action_key IN
 ('skill.definition.create','skill.version.create','skill.version.publish','skill.version.retire',
  'skill.definition.disable','skill.definition.share','skill.definition.unshare') AND version = 1;

DROP TABLE admission.skill_artifact_upload;
DROP TRIGGER skill_published_pointer_guard ON catalog.skill_definition;
DROP FUNCTION catalog.guard_skill_published_pointer();
ALTER TABLE catalog.skill_definition DROP CONSTRAINT skill_definition_published_asset;
DROP TABLE catalog.skill_version;
DROP FUNCTION catalog.guard_skill_version();
DROP TABLE catalog.skill_definition;
DROP FUNCTION catalog.guard_skill_definition();

ALTER TABLE catalog.asset DROP CONSTRAINT asset_type_key_check;
ALTER TABLE catalog.asset ADD CONSTRAINT asset_type_key_check
    CHECK (type_key IN ('agent.version','automation.version'));

ALTER TABLE catalog.resource DROP CONSTRAINT resource_type_key_check;
ALTER TABLE catalog.resource DROP CONSTRAINT resource_home_workspace_check;
ALTER TABLE catalog.resource ADD CONSTRAINT resource_type_key_check CHECK
 (application_binding_id IS NOT NULL OR type_key IN
  ('agent.definition','agent.installation','llm_route','automation','tool.definition'));
ALTER TABLE catalog.resource ADD CONSTRAINT resource_home_workspace_check CHECK
 (application_binding_id IS NOT NULL OR
  (type_key IN ('agent.definition','tool.definition') AND home_workspace_id IS NULL) OR
  (type_key IN ('agent.installation','automation') AND home_workspace_id IS NOT NULL) OR type_key='llm_route');

DELETE FROM catalog.resource_type_definition WHERE type_key = 'skill.definition';
