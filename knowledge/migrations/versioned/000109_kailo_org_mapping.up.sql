-- Kailo DD-133 organisation mapping: a native space (tenant) or organisation
-- may carry the reference of the Kailo Tenant / Workspace it represents.
-- The reference is set once (by the OIDC membership sync or by the explicit
-- adoption script) and never rewritten, so one Kailo scope always resolves to
-- the same native space. Soft-deleted rows keep their reference.
ALTER TABLE tenants ADD COLUMN kailo_scope_ref VARCHAR(160);
ALTER TABLE tenants ADD CONSTRAINT tenants_kailo_scope_ref_format CHECK (
    kailo_scope_ref IS NULL OR kailo_scope_ref ~ '^(tenant|workspace):[A-Za-z0-9._:-]{1,150}$'
);
CREATE UNIQUE INDEX idx_tenants_kailo_scope_ref ON tenants (kailo_scope_ref);

ALTER TABLE organizations ADD COLUMN kailo_tenant_ref VARCHAR(160);
ALTER TABLE organizations ADD CONSTRAINT organizations_kailo_tenant_ref_format CHECK (
    kailo_tenant_ref IS NULL OR kailo_tenant_ref ~ '^[A-Za-z0-9._:-]{1,150}$'
);
CREATE UNIQUE INDEX idx_organizations_kailo_tenant_ref ON organizations (kailo_tenant_ref);

CREATE FUNCTION guard_kailo_scope_ref() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_TABLE_NAME = 'tenants' THEN
        IF OLD.kailo_scope_ref IS NOT NULL AND NEW.kailo_scope_ref IS DISTINCT FROM OLD.kailo_scope_ref THEN
            RAISE EXCEPTION 'Kailo scope reference of a native space is immutable';
        END IF;
    ELSIF OLD.kailo_tenant_ref IS NOT NULL AND NEW.kailo_tenant_ref IS DISTINCT FROM OLD.kailo_tenant_ref THEN
        RAISE EXCEPTION 'Kailo tenant reference of a native organization is immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tenants_kailo_scope_ref_immutable
    BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION guard_kailo_scope_ref();
CREATE TRIGGER organizations_kailo_tenant_ref_immutable
    BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION guard_kailo_scope_ref();
