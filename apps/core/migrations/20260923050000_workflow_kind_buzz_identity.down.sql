-- 已有该 kind 的 WorkflowRef 时拒绝回退：删掉它们等于抹去设备登记与撤销的执行记录。
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM projection.workflow_ref WHERE kind = 'BUZZ_IDENTITY_PROJECTION') THEN
        RAISE EXCEPTION '存在 BUZZ_IDENTITY_PROJECTION 的 WorkflowRef，不能回退';
    END IF;
END $$;
ALTER TABLE projection.workflow_ref DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE projection.workflow_ref ADD CONSTRAINT workflow_kind_enum CHECK (kind IN
    ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION'));
