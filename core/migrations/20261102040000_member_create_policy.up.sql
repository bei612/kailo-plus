-- DD-164(3)(4)⑧ (design 1c803580, 03 Tenant.member_create_policy, 07 §4.7.4):
-- 1. Tenant member create policy: MEMBERS_CREATE (default) gives ACTIVE members tenant#creator
--    through the membership chain and the release alignment; ADMINS_ONLY removes it.
-- 2. The governed action tenant.member_create_policy.set (SYNC, EXPLICIT, no approval,
--    FULL_LIFECYCLE, Tenant manage, Tenant version CAS); its dispatch converges tenant#creator.
-- 3. ComponentShareAdoption: the frozen grants of an existing native share being adopted as a
--    component.shared_object Resource (PROVISIONING until SpiceDB is written and read back).
ALTER TABLE identity.tenant ADD COLUMN member_create_policy text NOT NULL DEFAULT 'MEMBERS_CREATE'
    CONSTRAINT tenant_member_create_policy_enum CHECK (member_create_policy IN ('MEMBERS_CREATE','ADMINS_ONLY'));

INSERT INTO catalog.action_definition
    (action_key, version, component_type_key, target_type, tenant_rule, workspace_rule,
     permission, permission_object_type, execution_mode, confirmation_mode,
     approval_policy_id, approval_policy_version, workflow_type, workflow_kind,
     capacity_policy, capacity_pool_key, quota_policy, meters, result_exposure, audit_policy,
     obs_correlation_mode, obs_progress_source, obs_terminal_source, obs_usage_source,
     obs_cost_source, obs_redaction_policy, status)
VALUES
    ('tenant.member_create_policy.set', 1, 'core', 'TENANT', 'SESSION_TENANT', 'TENANT_ONLY',
     'manage', 'tenant', 'SYNC', 'EXPLICIT', NULL, NULL, NULL, NULL,
     'NONE', NULL, 'NONE', '{}'::text[], 'NONE', 'FULL_LIFECYCLE',
     'OPERATION_REF', 'NONE', 'SYNC_RESULT', 'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE');

CREATE TABLE catalog.component_share_adoption (
    resource_id uuid PRIMARY KEY REFERENCES catalog.resource(id),
    tenant_id uuid NOT NULL REFERENCES identity.tenant(id),
    application_binding_id uuid NOT NULL,
    owner_principal_id uuid NOT NULL REFERENCES identity.principal(id),
    grants jsonb NOT NULL CHECK (jsonb_typeof(grants)='array' AND jsonb_array_length(grants)<=100),
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    FOREIGN KEY (tenant_id,application_binding_id) REFERENCES catalog.application_binding(tenant_id,id)
);
