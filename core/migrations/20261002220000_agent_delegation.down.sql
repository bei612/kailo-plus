-- 已有首次dispatch或授予事实时停止回退，不能把授权及审计责任抹掉。
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM admission.delegation_grant)
        OR EXISTS (SELECT 1 FROM catalog.result_exposure_policy)
        OR EXISTS (SELECT 1 FROM admission.delegation_use)
        OR EXISTS (SELECT 1 FROM admission.action_execution
            WHERE action_key IN ('agent.delegation.grant','agent.delegation.revoke')) THEN
        RAISE EXCEPTION '已有Delegation/治理事实，不可回退' USING ERRCODE='restrict_violation';
    END IF;
END $$;
DELETE FROM catalog.action_definition WHERE action_key IN ('agent.delegation.grant','agent.delegation.revoke');
DROP TABLE admission.delegation_use;
DROP FUNCTION admission.guard_delegation_use();
DROP TABLE admission.delegation_scope;
DROP FUNCTION admission.guard_delegation_scope();
DROP TABLE admission.delegation_grant;
DROP FUNCTION admission.guard_delegation_grant();
DROP TABLE catalog.result_exposure_policy;
DROP FUNCTION catalog.guard_result_exposure_policy();
