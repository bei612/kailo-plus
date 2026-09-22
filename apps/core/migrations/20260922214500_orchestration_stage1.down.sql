-- 按外键依赖的逆序删除。schema 由 init 迁移创建，此处不动它。
DROP TABLE IF EXISTS projection.task_projection;
DROP TABLE IF EXISTS projection.workflow_ref;
DROP TABLE IF EXISTS admission.action_execution;
