-- 回退只在 schema 为空时成立。任一 schema 已有对象时 RESTRICT 会使本迁移
-- 安全停止而不是级联删除业务数据——这正是「可安全停止」要验证的行为。
DROP SCHEMA IF EXISTS outbox      RESTRICT;
DROP SCHEMA IF EXISTS audit       RESTRICT;
DROP SCHEMA IF EXISTS reservation RESTRICT;
DROP SCHEMA IF EXISTS projection  RESTRICT;
DROP SCHEMA IF EXISTS admission   RESTRICT;
DROP SCHEMA IF EXISTS catalog     RESTRICT;
