-- DD-85：仅归位遗留业务 Tenant 的 SERVER BuzzIdentityBinding SecretRef。
-- 表只保存 OpenBao locator/version 和执行引用，绝不保存私钥值。
ALTER TABLE catalog.action_definition DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE catalog.action_definition ADD CONSTRAINT workflow_kind_enum CHECK (workflow_kind IN
    ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
     'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME'));
ALTER TABLE projection.workflow_ref DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE projection.workflow_ref ADD CONSTRAINT workflow_kind_enum CHECK (kind IN
    ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
     'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME'));

CREATE TABLE admission.secret_ref_rehome (
    id                           uuid PRIMARY KEY,
    action_execution_id          uuid NOT NULL UNIQUE REFERENCES admission.action_execution (id),
    workflow_id                  text NOT NULL UNIQUE REFERENCES projection.workflow_ref (workflow_id),
    tenant_id                    uuid NOT NULL REFERENCES identity.tenant (id),
    identity_pubkey              text NOT NULL REFERENCES identity.buzz_identity_binding (pubkey),
    expected_binding_version     integer NOT NULL CHECK (expected_binding_version > 0),
    old_locator                  text NOT NULL,
    old_version                  integer NOT NULL CHECK (old_version > 0),
    old_audience                 text NOT NULL,
    target_locator               text NOT NULL UNIQUE,
    new_ref_version              integer CHECK (new_ref_version > 0),
    cutover_at                   timestamptz,
    old_generation_consumer_refs jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(old_generation_consumer_refs) = 'array'),
    old_ref_status               text NOT NULL CHECK (old_ref_status IN ('ACTIVE','SUPERSEDED','REVOKED')),
    new_ref_status               text NOT NULL CHECK (new_ref_status IN ('NONE','PENDING','ACTIVE')),
    state                        text NOT NULL CONSTRAINT secret_ref_rehome_state_enum CHECK (state IN
                                    ('INTENT','COPY_UNKNOWN','COPIED','SWITCHED','RETIRED','FAILED')),
    created_at                   timestamptz NOT NULL DEFAULT now(),
    updated_at                   timestamptz NOT NULL DEFAULT now(),
    CHECK ((state IN ('COPIED','SWITCHED','RETIRED')) = (new_ref_version IS NOT NULL)),
    CHECK ((state IN ('SWITCHED','RETIRED')) = (cutover_at IS NOT NULL)),
    CHECK ((state IN ('INTENT','COPY_UNKNOWN','COPIED','FAILED') AND old_ref_status = 'ACTIVE')
        OR (state = 'SWITCHED' AND old_ref_status = 'SUPERSEDED')
        OR (state = 'RETIRED' AND old_ref_status = 'REVOKED')),
    CHECK ((state IN ('INTENT','COPY_UNKNOWN','FAILED') AND new_ref_status = 'NONE')
        OR (state = 'COPIED' AND new_ref_status = 'PENDING')
        OR (state IN ('SWITCHED','RETIRED') AND new_ref_status = 'ACTIVE'))
);
CREATE UNIQUE INDEX secret_ref_rehome_one_open_pubkey
    ON admission.secret_ref_rehome (tenant_id, identity_pubkey)
    WHERE state NOT IN ('RETIRED','FAILED');
CREATE INDEX secret_ref_rehome_open_age ON admission.secret_ref_rehome (updated_at)
    WHERE state NOT IN ('RETIRED','FAILED');

INSERT INTO catalog.action_definition
    (action_key, version, component_type_key, target_type, tenant_rule, workspace_rule,
     permission, permission_object_type, execution_mode, confirmation_mode,
     workflow_type, workflow_kind, capacity_policy, quota_policy, meters,
     result_exposure, audit_policy, obs_correlation_mode, obs_progress_source,
     obs_terminal_source, obs_usage_source, obs_cost_source, obs_redaction_policy, status)
VALUES
    ('identity.secret_ref.rehome', 1, 'core', 'BUZZ_IDENTITY_BINDING', 'SESSION_TENANT',
     'TENANT_ONLY', 'manage', 'tenant', 'TEMPORAL', 'EXPLICIT',
     'ComponentTaskWorkflow', 'SECRET_REF_REHOME', 'NONE', 'NONE', '{}',
     'NONE', 'FULL_LIFECYCLE', 'OPERATION_REF', 'TEMPORAL', 'TEMPORAL',
     'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE');
