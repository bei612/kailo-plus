CREATE TEMP TABLE kailo_org_rollback_guard (value INTEGER);
CREATE TEMP TRIGGER kailo_org_rollback_refusal BEFORE INSERT ON kailo_org_rollback_guard
WHEN EXISTS (SELECT 1 FROM tenants WHERE kailo_scope_ref IS NOT NULL)
  OR EXISTS (SELECT 1 FROM organizations WHERE kailo_tenant_ref IS NOT NULL)
BEGIN
    SELECT RAISE(ABORT, 'cannot roll back Kailo organisation mapping with mapped spaces');
END;
INSERT INTO kailo_org_rollback_guard VALUES (1);
DROP TRIGGER kailo_org_rollback_refusal;
DROP TABLE kailo_org_rollback_guard;
DROP TRIGGER organizations_kailo_tenant_ref_immutable;
DROP TRIGGER tenants_kailo_scope_ref_immutable;
DROP INDEX idx_organizations_kailo_tenant_ref;
ALTER TABLE organizations DROP COLUMN kailo_tenant_ref;
DROP INDEX idx_tenants_kailo_scope_ref;
ALTER TABLE tenants DROP COLUMN kailo_scope_ref;
