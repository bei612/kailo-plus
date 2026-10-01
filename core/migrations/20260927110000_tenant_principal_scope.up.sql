-- .design/03 §2：TenantMembership 的 HUMAN Principal 必须归属同一 Tenant。
-- 既有脏行会使迁移失败并阻止发布，不把跨 Tenant 引用当作可用身份。
ALTER TABLE identity.principal
    ADD CONSTRAINT principal_id_tenant_unique UNIQUE (id, tenant_id);

ALTER TABLE identity.tenant_membership
    ADD CONSTRAINT tenant_membership_principal_same_tenant
    FOREIGN KEY (tenant_principal_id, tenant_id)
    REFERENCES identity.principal (id, tenant_id);
