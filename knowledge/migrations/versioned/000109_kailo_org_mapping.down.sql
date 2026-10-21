-- Refuse rollback once a native space or organisation represents a Kailo
-- scope: the old binary would let members be edited natively again.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM tenants WHERE kailo_scope_ref IS NOT NULL) OR
       EXISTS (SELECT 1 FROM organizations WHERE kailo_tenant_ref IS NOT NULL) THEN
        RAISE EXCEPTION 'cannot roll back Kailo organisation mapping with mapped spaces';
    END IF;
END $$;
DROP TRIGGER organizations_kailo_tenant_ref_immutable ON organizations;
DROP TRIGGER tenants_kailo_scope_ref_immutable ON tenants;
DROP FUNCTION guard_kailo_scope_ref();
DROP INDEX idx_organizations_kailo_tenant_ref;
ALTER TABLE organizations DROP CONSTRAINT organizations_kailo_tenant_ref_format;
ALTER TABLE organizations DROP COLUMN kailo_tenant_ref;
DROP INDEX idx_tenants_kailo_scope_ref;
ALTER TABLE tenants DROP CONSTRAINT tenants_kailo_scope_ref_format;
ALTER TABLE tenants DROP COLUMN kailo_scope_ref;
