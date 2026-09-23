-- 新增 ComponentTaskWorkflow kind：原生设备公钥投影（DD-79、.design/06）。
-- 约束值与 contracts/enums/workflow_kind.schema.json 逐值相等，由 check.sh 校验。
ALTER TABLE projection.workflow_ref DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE projection.workflow_ref ADD CONSTRAINT workflow_kind_enum CHECK (kind IN
    ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
     'BUZZ_IDENTITY_PROJECTION'));
