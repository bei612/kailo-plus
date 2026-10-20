-- DD-125(9) 回滚。activated_at 只是新成员提醒的来源，不承载授权、会话或成员状态，
-- 删除不改变任何成员事实，因此无停止条件。回滚后旧 Core 不再写入它；再次前滚时
-- 回滚窗口内加入的成员保持 NULL，不产生提醒（与首轮静默同一语义）。
DROP INDEX IF EXISTS identity.tenant_membership_activated;
ALTER TABLE identity.tenant_membership DROP COLUMN IF EXISTS activated_at;
