-- 不删除真实导入事实或历史 ActionExecution 来强行收缩合同。
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM admission.action_execution WHERE action_key = 'agent.definition.import')
        OR EXISTS (SELECT 1 FROM admission.transfer_upload)
        OR EXISTS (SELECT 1 FROM projection.workflow_ref WHERE kind = 'RESOURCE_IMPORT') THEN
        RAISE EXCEPTION 'agent.definition.import 合同已被真实事实引用，停止收缩'
            USING ERRCODE = 'restrict_violation';
    END IF;
END $$;

DELETE FROM catalog.action_definition WHERE action_key = 'agent.definition.import' AND version = 1;
DROP TABLE admission.transfer_upload;

ALTER TABLE projection.workflow_ref DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE projection.workflow_ref ADD CONSTRAINT workflow_kind_enum CHECK (kind IN
 ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
 'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION','COMPONENT_RELEASE',
 'COMPONENT_BINDING','COMPONENT_DISABLE','RESOURCE_PROVISION','PROTOCOL_SESSION_RECONCILE','COMPONENT_ACTION','CONVERSATION_PROJECTION'));
ALTER TABLE catalog.action_definition DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE catalog.action_definition ADD CONSTRAINT workflow_kind_enum CHECK (workflow_kind IN
 ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
 'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION','COMPONENT_RELEASE',
 'COMPONENT_BINDING','COMPONENT_DISABLE','RESOURCE_PROVISION','COMPONENT_ACTION','CONVERSATION_PROJECTION'));
