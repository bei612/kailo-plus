-- Core 的模块 schema 划分（ADR-01）。模块边界靠 schema 与代码可见性表达，
-- 不靠独立数据库表达——Core 保持单一部署单元与单一业务事务边界。
--
-- 本迁移只建 schema，不建表。表随各模块进入实现时按
-- 06-工程基线规范.md §5 的扩展-迁移-收缩三步加入。

CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS admission;
CREATE SCHEMA IF NOT EXISTS projection;
CREATE SCHEMA IF NOT EXISTS reservation;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS outbox;

COMMENT ON SCHEMA catalog     IS 'immutable release/version、binding、Agent/Skill/Tool';
COMMENT ON SCHEMA admission   IS 'preview、admit、recheck、revoke 的准入事实';
COMMENT ON SCHEMA projection  IS 'Buzz/SpiceDB/Gateway/Web/Task 投影与 generation';
COMMENT ON SCHEMA reservation IS 'CapacityLease、QuotaReservation；严格 reservation 的串行化热点';
COMMENT ON SCHEMA audit       IS '追加式审计事实；不授予 UPDATE/DELETE';
COMMENT ON SCHEMA outbox      IS '与业务写同事务插入的待投递消息；relay 按 operation_id 去重';
