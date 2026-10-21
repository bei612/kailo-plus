-- 回退只在没有任何 DD-131 事实时成立：已有团队、导出包、暂存或已消费的动作记录
-- 不得随回退丢弃（停止发布的确定条件）。
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM catalog.resource WHERE type_key='agent.team')
   OR EXISTS(SELECT 1 FROM catalog.asset WHERE type_key='export.package')
   OR EXISTS(SELECT 1 FROM admission.agent_snapshot_upload)
   OR EXISTS(SELECT 1 FROM projection.workflow_ref WHERE kind IN ('RESOURCE_EXPORT','RESOURCE_IMPORT'))
   OR EXISTS(SELECT 1 FROM admission.action_execution WHERE action_key IN
      ('agent.team.create','agent.team.update','agent.team.delete','agent.team.share','agent.team.unshare',
       'agent.definition.share','agent.definition.unshare','agent.definition.export','agent.team.export',
       'agent.definition.import','agent.team.import')) THEN
   RAISE EXCEPTION 'DD-131 team/snapshot history must not be discarded' USING ERRCODE='23514';
 END IF;
END $$;
DELETE FROM catalog.action_definition WHERE action_key IN
 ('agent.team.create','agent.team.update','agent.team.delete','agent.team.share','agent.team.unshare',
  'agent.definition.share','agent.definition.unshare','agent.definition.export','agent.team.export',
  'agent.definition.import','agent.team.import');
DELETE FROM catalog.approval_policy WHERE action_key IN ('agent.definition.export','agent.team.export');

ALTER TABLE catalog.action_definition DROP CONSTRAINT result_exposure_enum;
ALTER TABLE catalog.action_definition ADD CONSTRAINT result_exposure_enum CHECK (
    result_exposure IN ('NONE','READ')
    OR (component_release_id IS NOT NULL AND result_exposure IN ('CONSUME_ONLY','EXPORT')));

ALTER TABLE catalog.action_definition DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE catalog.action_definition ADD CONSTRAINT workflow_kind_enum CHECK (workflow_kind IN
 ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
 'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION','COMPONENT_RELEASE',
 'COMPONENT_BINDING','COMPONENT_DISABLE','RESOURCE_PROVISION','COMPONENT_ACTION','CONVERSATION_PROJECTION'));
ALTER TABLE projection.workflow_ref DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE projection.workflow_ref ADD CONSTRAINT workflow_kind_enum CHECK (kind IN
 ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
 'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION','COMPONENT_RELEASE',
 'COMPONENT_BINDING','COMPONENT_DISABLE','RESOURCE_PROVISION','PROTOCOL_SESSION_RECONCILE','COMPONENT_ACTION','CONVERSATION_PROJECTION'));

DROP TABLE admission.agent_snapshot_upload;
DROP TABLE catalog.export_package;
ALTER TABLE catalog.asset DROP CONSTRAINT asset_type_key_check;
ALTER TABLE catalog.asset ADD CONSTRAINT asset_type_key_check
    CHECK (type_key IN ('agent.version','automation.version'));

DROP TRIGGER agent_team_guard ON catalog.agent_team;
DROP FUNCTION catalog.guard_agent_team();
DROP TABLE catalog.agent_team;

ALTER TABLE catalog.resource DROP CONSTRAINT resource_type_key_check;
ALTER TABLE catalog.resource DROP CONSTRAINT resource_home_workspace_check;
ALTER TABLE catalog.resource ADD CONSTRAINT resource_type_key_check CHECK
 (application_binding_id IS NOT NULL OR type_key IN
  ('agent.definition','agent.installation','llm_route','automation','tool.definition'));
ALTER TABLE catalog.resource ADD CONSTRAINT resource_home_workspace_check CHECK
 (application_binding_id IS NOT NULL OR
  (type_key IN ('agent.definition','tool.definition') AND home_workspace_id IS NULL) OR
  (type_key IN ('agent.installation','automation') AND home_workspace_id IS NOT NULL) OR type_key='llm_route');

UPDATE catalog.resource_type_definition SET transfer_formats='[]'
WHERE type_key='agent.definition' AND component_release_id IS NULL;
DELETE FROM catalog.resource_type_definition WHERE type_key='agent.team' AND component_release_id IS NULL;
