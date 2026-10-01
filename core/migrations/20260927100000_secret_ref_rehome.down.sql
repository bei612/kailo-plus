-- 已引用定义或已发生归位时不能倒退 schema：停止发布，保留可核验事实。
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM admission.secret_ref_rehome)
       OR EXISTS (SELECT 1 FROM admission.action_execution
                  WHERE action_key = 'identity.secret_ref.rehome') THEN
        RAISE EXCEPTION '已有 SecretRef 归位事实，不能回滚此迁移';
    END IF;
END $$;
DELETE FROM catalog.action_definition WHERE action_key = 'identity.secret_ref.rehome';
DROP TABLE admission.secret_ref_rehome;
ALTER TABLE catalog.action_definition DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE catalog.action_definition ADD CONSTRAINT workflow_kind_enum CHECK (workflow_kind IN
    ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
     'BUZZ_IDENTITY_PROJECTION'));
ALTER TABLE projection.workflow_ref DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE projection.workflow_ref ADD CONSTRAINT workflow_kind_enum CHECK (kind IN
    ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
     'BUZZ_IDENTITY_PROJECTION'));
