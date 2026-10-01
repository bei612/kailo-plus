-- Tenant 成员撤权连带收敛其 WorkspaceMembership（.design/10 §5，V-SCN-34）。
--
-- 此前的撤权只撤 TenantMembership，WorkspaceMembership 留在原状态；按邀请恢复
-- 沿用同一 Principal 时，旧的 ACTIVE 投影随之复活。代码已改为在 Tenant 成员进入
-- REVOKING 的同一事务里把它们一并置为 REVOKING，并要求它们先收敛再让 Tenant
-- 成员进入 REVOKED。这里修补改动之前留下的存量行，只朝拒绝的方向移动：
--
-- 1. Tenant 成员仍在撤权中（REVOKING/ERROR）：WorkspaceMembership 置 REVOKING，
--    由重跑或重新发起的撤权 Workflow 冻结进 input 并收敛到 REVOKED。
-- 2. Tenant 成员已离开（REVOKED）或只在待准入（INVITED）：原撤权链早已终结，
--    没有 Workflow 会再驱动它们；置 ERROR 使其不再授予 scope，恢复后由 Workspace
--    admin 经 workspace.member.revoke（接受 ERROR）重新收敛。
UPDATE identity.workspace_membership wm
   SET state = 'REVOKING', version = wm.version + 1
  FROM identity.workspace w, identity.tenant_membership tm
 WHERE w.id = wm.workspace_id
   AND tm.tenant_id = w.tenant_id
   AND tm.tenant_principal_id = wm.tenant_principal_id
   AND tm.state IN ('REVOKING', 'ERROR')
   AND wm.state IN ('PROVISIONING', 'ACTIVE');

UPDATE identity.workspace_membership wm
   SET state = 'ERROR', version = wm.version + 1
  FROM identity.workspace w, identity.tenant_membership tm
 WHERE w.id = wm.workspace_id
   AND tm.tenant_id = w.tenant_id
   AND tm.tenant_principal_id = wm.tenant_principal_id
   AND tm.state IN ('REVOKED', 'INVITED')
   AND wm.state IN ('PROVISIONING', 'ACTIVE', 'REVOKING');
