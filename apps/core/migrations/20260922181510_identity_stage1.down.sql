-- 按外键依赖的逆序删除。这些表在 Stage 1 之前不存在，回退即回到空 identity schema。
DROP TABLE IF EXISTS identity.relay_operator_identity;
DROP TABLE IF EXISTS identity.buzz_identity_binding;
DROP TABLE IF EXISTS identity.platform_session;
DROP TABLE IF EXISTS identity.workspace_membership;
DROP TABLE IF EXISTS identity.tenant_membership;
DROP TABLE IF EXISTS identity.principal;
DROP TABLE IF EXISTS identity.workspace;
DROP TABLE IF EXISTS identity.tenant;
DROP TABLE IF EXISTS identity.external_identity;
DROP TABLE IF EXISTS identity.human_identity;
DROP TABLE IF EXISTS identity.identity_provider;

-- schema 由本迁移创建，回退时一并删除；RESTRICT 保证有残留对象时安全停止。
DROP SCHEMA IF EXISTS identity RESTRICT;
