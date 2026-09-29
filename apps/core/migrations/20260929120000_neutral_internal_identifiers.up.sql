-- 内部标识去掉产品名（apps ADR-17）。
--
-- 1. 部署引导 ServicePrincipal 的 audience 改为中性名。principal_id 不变，审计按
--    principal_id 归因，历史不断；Core 按新 audience 查找它，旧值不再有读者。
--    旧审计记录 evidence 中的旧 audience 原文是当时写入的事实，不改写。
-- 2. 角色动作的 target ID 由 `urn:platform:role:…` 派生（UUID v5），与此前的
--    `urn:kailo:role:…` 不同。`action_execution_one_pending_per_target` 只能在同一
--    派生规则下把同一意图排成先后：切换时若仍有在途的角色动作，新请求会得到另一个
--    target ID，同一意图可能被准入两次。因此切换只在没有在途角色动作时进行，
--    否则本迁移失败、部署停在旧版本（apps/AGENTS.md 第 14 条的确定停止条件）；
--    待在途动作终结后重新部署。
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM admission.action_execution
         WHERE action_key IN ('tenant.admin.grant', 'tenant.admin.revoke',
                              'workspace.admin.grant', 'workspace.admin.revoke',
                              'tenant.bootstrap')
           AND (gate_state IN ('EVALUATING', 'WAITING')
                OR (gate_state = 'ALLOWED' AND dispatch_state = 'NOT_DISPATCHED'))
    ) THEN
        RAISE EXCEPTION '仍有在途的角色动作，target ID 派生规则不能切换（ADR-17）；待其终结后重新部署';
    END IF;
END
$$;

UPDATE identity.service_principal
   SET audience = 'platform-deployment-bootstrap'
 WHERE audience = 'kailo-deployment-bootstrap';
