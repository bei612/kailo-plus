-- DD-125(9)、03 §2（TenantMembership.activated_at）、05 §2.11、V-SCN-166/167：新成员加入提醒的来源。
--
-- 1. activated_at 只由成员状态跃迁在转入 ACTIVE 的同一 UPDATE 写入（重新加入覆盖），
--    以 HUMAN Principal 的 TenantMembership 为单位；BuzzIdentityBinding（DD-77 的新设备
--    公钥）不改它。它不是授权或会话依据。
-- 2. 存量不回填：客户端首轮只建账不提醒，NULL 行不进入游标读取，等价于首轮静默。
-- 3. 索引服务 GET /api/v1/tenant-member-joins 的（进入时刻，membership）升序游标读取。
ALTER TABLE identity.tenant_membership ADD COLUMN activated_at timestamptz;

CREATE INDEX tenant_membership_activated
    ON identity.tenant_membership (tenant_id, activated_at, id)
    WHERE state = 'ACTIVE' AND activated_at IS NOT NULL;
