-- 上行迁移只把存量 WorkspaceMembership 朝拒绝的方向推进，并推进了 version；
-- 原状态没有留存，也不应恢复——恢复即让已撤权者的旧投影复活。回滚不改数据。
SELECT 1;
