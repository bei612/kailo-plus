DROP TABLE admission.tenant_delete_subprocess;
DROP TABLE admission.tenant_lifecycle_snapshot;
DROP FUNCTION admission.protect_tenant_lifecycle_snapshot();
ALTER TABLE identity.platform_session DROP COLUMN access_mode;
