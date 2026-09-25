-- 已有邀请或按这三个定义准入的动作时拒绝回退：删掉它们会让已兑换的成员失去
-- invitation fact 的来路，让那些 ActionExecution 无从解释「按什么规则被准入」。
-- 没有这些事实时，回退是删表与删三个从未被引用的定义。
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM identity.tenant_invitation)
       OR EXISTS (SELECT 1 FROM admission.action_execution
                  WHERE action_key IN ('tenant.member.invite','tenant.member.invite.revoke',
                                       'tenant.member.admit')) THEN
        RAISE EXCEPTION '存在 Tenant 邀请或其 ActionExecution，不能回退';
    END IF;
END $$;

DROP TABLE identity.tenant_invitation;

-- 未被引用的版本，guard_version 允许删除
DELETE FROM catalog.action_definition
WHERE action_key IN ('tenant.member.invite','tenant.member.invite.revoke','tenant.member.admit')
  AND version = 1;
ALTER TABLE catalog.approval_policy DISABLE TRIGGER approval_policy_immutable;
DELETE FROM catalog.approval_policy WHERE id = '3c9e7a41-5d2b-4f60-8e17-9a4b6c2d0e03';
ALTER TABLE catalog.approval_policy ENABLE TRIGGER approval_policy_immutable;
