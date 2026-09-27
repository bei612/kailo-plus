ALTER TABLE identity.tenant_membership
    DROP CONSTRAINT tenant_membership_principal_same_tenant;

ALTER TABLE identity.principal
    DROP CONSTRAINT principal_id_tenant_unique;
