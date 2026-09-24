-- 已有角色动作的准入事实或部署引导的发起方时拒绝回退：删掉定义会让那些
-- ActionExecution 无从解释「按什么规则被准入」，删掉 ServicePrincipal 会让引导审计
-- 失去归因对象。角色本身在 SpiceDB，回退不触碰它们。
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM admission.action_execution
               WHERE action_key IN ('tenant.admin.grant','tenant.admin.revoke',
                                    'workspace.admin.grant','workspace.admin.revoke',
                                    'tenant.bootstrap')) THEN
        RAISE EXCEPTION '存在角色动作或部署引导的 ActionExecution，不能回退';
    END IF;
    IF EXISTS (SELECT 1 FROM identity.service_principal) THEN
        RAISE EXCEPTION '存在 ServicePrincipal，不能回退';
    END IF;
END $$;

DROP TABLE identity.service_principal;

ALTER TABLE catalog.action_definition DISABLE TRIGGER action_definition_immutable;
DELETE FROM catalog.action_definition WHERE role_template_key IS NOT NULL;
ALTER TABLE catalog.action_definition ENABLE TRIGGER action_definition_immutable;
ALTER TABLE catalog.approval_policy DISABLE TRIGGER approval_policy_immutable;
DELETE FROM catalog.approval_policy WHERE action_key = 'tenant.admin.revoke';
ALTER TABLE catalog.approval_policy ENABLE TRIGGER approval_policy_immutable;
ALTER TABLE catalog.action_definition
    DROP CONSTRAINT role_action_is_sync,
    DROP CONSTRAINT role_template_pair,
    DROP COLUMN role_template_version,
    DROP COLUMN role_template_key;

DROP TABLE catalog.role_template;
