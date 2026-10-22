-- Mirrors native Postgres migration 000109 (Kailo DD-133 organisation mapping and back-channel logout).
ALTER TABLE tenants ADD COLUMN kailo_scope_ref VARCHAR(160) CHECK (
    kailo_scope_ref IS NULL OR
    ((kailo_scope_ref LIKE 'tenant:%' OR kailo_scope_ref LIKE 'workspace:%')
     AND length(kailo_scope_ref) <= 160)
);
CREATE UNIQUE INDEX idx_tenants_kailo_scope_ref ON tenants (kailo_scope_ref);
ALTER TABLE organizations ADD COLUMN kailo_tenant_ref VARCHAR(160) CHECK (
    kailo_tenant_ref IS NULL OR (length(kailo_tenant_ref) BETWEEN 1 AND 150)
);
CREATE UNIQUE INDEX idx_organizations_kailo_tenant_ref ON organizations (kailo_tenant_ref);
CREATE TRIGGER tenants_kailo_scope_ref_immutable BEFORE UPDATE ON tenants
WHEN OLD.kailo_scope_ref IS NOT NULL AND NEW.kailo_scope_ref IS NOT OLD.kailo_scope_ref
BEGIN
    SELECT RAISE(ABORT, 'Kailo scope reference of a native space is immutable');
END;
CREATE TRIGGER organizations_kailo_tenant_ref_immutable BEFORE UPDATE ON organizations
WHEN OLD.kailo_tenant_ref IS NOT NULL AND NEW.kailo_tenant_ref IS NOT OLD.kailo_tenant_ref
BEGIN
    SELECT RAISE(ABORT, 'Kailo tenant reference of a native organization is immutable');
END;
ALTER TABLE auth_tokens ADD COLUMN oidc_sid TEXT;
ALTER TABLE auth_tokens ADD COLUMN session_expires_at DATETIME;
CREATE INDEX idx_auth_tokens_oidc_sid ON auth_tokens (oidc_sid);
CREATE TABLE oidc_logout_token_ids (
    jti        VARCHAR(255) PRIMARY KEY,
    expires_at DATETIME NOT NULL
);
CREATE INDEX idx_oidc_logout_token_ids_expires_at ON oidc_logout_token_ids (expires_at);
