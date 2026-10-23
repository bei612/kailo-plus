-- 不删除真实导出事实或历史 ActionExecution 来强行收缩合同。
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM admission.action_execution WHERE action_key = 'agent.definition.export')
        OR EXISTS (SELECT 1 FROM catalog.export_package)
        OR EXISTS (SELECT 1 FROM catalog.asset WHERE type_key = 'export.package')
        OR EXISTS (SELECT 1 FROM projection.workflow_ref WHERE kind = 'RESOURCE_EXPORT') THEN
        RAISE EXCEPTION 'agent.definition.export 合同已被真实事实引用，停止收缩'
            USING ERRCODE = 'restrict_violation';
    END IF;
END $$;

DROP TABLE catalog.export_package;
DROP TABLE catalog.transfer_format;
DELETE FROM catalog.action_definition WHERE action_key = 'agent.definition.export' AND version = 1;
DELETE FROM catalog.approval_policy WHERE action_key = 'agent.definition.export';

ALTER TABLE catalog.asset DROP CONSTRAINT asset_type_key_check;
ALTER TABLE catalog.asset ADD CONSTRAINT asset_type_key_check
    CHECK (type_key IN ('agent.version','automation.version','skill.version'));
ALTER TABLE catalog.action_definition DROP CONSTRAINT result_exposure_scope;
ALTER TABLE catalog.action_definition DROP CONSTRAINT result_exposure_enum;
ALTER TABLE catalog.action_definition ADD CONSTRAINT result_exposure_enum CHECK (
    result_exposure IN ('NONE','READ')
    OR (component_release_id IS NOT NULL AND result_exposure IN ('CONSUME_ONLY','EXPORT')));

ALTER TABLE projection.workflow_ref DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE projection.workflow_ref ADD CONSTRAINT workflow_kind_enum CHECK (kind IN
 ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
 'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION','COMPONENT_RELEASE',
 'COMPONENT_BINDING','COMPONENT_DISABLE','RESOURCE_PROVISION','PROTOCOL_SESSION_RECONCILE','COMPONENT_ACTION',
 'CONVERSATION_PROJECTION','RESOURCE_IMPORT'));
ALTER TABLE catalog.action_definition DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE catalog.action_definition ADD CONSTRAINT workflow_kind_enum CHECK (workflow_kind IN
 ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
 'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION','COMPONENT_RELEASE',
 'COMPONENT_BINDING','COMPONENT_DISABLE','RESOURCE_PROVISION','COMPONENT_ACTION','CONVERSATION_PROJECTION',
 'RESOURCE_IMPORT'));
