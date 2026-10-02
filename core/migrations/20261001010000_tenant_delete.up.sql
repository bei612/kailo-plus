-- DD-43/91/96/99/100/109：删除准入冻结与受限会话。
-- native/provider 正文留在各自权威；本库只存 ID、版本、digest 与推进证据。
ALTER TABLE identity.platform_session ADD COLUMN access_mode text NOT NULL DEFAULT 'FULL'
    CONSTRAINT platform_session_access_mode_enum CHECK (access_mode IN ('FULL','LIFECYCLE_RESTRICTED'));

CREATE TABLE admission.tenant_lifecycle_snapshot (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES identity.tenant(id),
    action_execution_id uuid NOT NULL UNIQUE REFERENCES admission.action_execution(id),
    tenant_version integer NOT NULL,
    resource_owner_versions jsonb NOT NULL,
    asset_owner_versions jsonb NOT NULL,
    component_binding_refs_and_versions jsonb NOT NULL,
    inventory_digest text NOT NULL,
    frozen_inventory jsonb NOT NULL,
    irreversible_dispatch_started boolean NOT NULL DEFAULT false,
    state text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (jsonb_typeof(resource_owner_versions) = 'array'),
    CHECK (jsonb_typeof(asset_owner_versions) = 'array'),
    CHECK (jsonb_typeof(component_binding_refs_and_versions) = 'array'),
    CHECK (jsonb_typeof(frozen_inventory) = 'object')
);

CREATE TABLE admission.tenant_delete_subprocess (
    id uuid PRIMARY KEY,
    tenant_lifecycle_snapshot_id uuid NOT NULL REFERENCES admission.tenant_lifecycle_snapshot(id),
    tenant_id uuid NOT NULL REFERENCES identity.tenant(id),
    subject text NOT NULL CONSTRAINT tenant_delete_subprocess_subject_enum CHECK (subject IN ('PLATFORM_CORE','APPLICATION_BINDING')),
    component_binding_ref jsonb,
    component_binding_version integer,
    mode text NOT NULL CONSTRAINT tenant_delete_subprocess_mode_enum CHECK (mode IN ('PLATFORM_CORE_CHAIN','NATIVE_DELETE','RETAIN_ON_TENANT_DELETE')),
    external_execution_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    provider_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    state text NOT NULL CONSTRAINT tenant_delete_subprocess_state_enum CHECK (state IN ('PENDING','RUNNING','DELETED','RETAINED_DECLARED','UNKNOWN','RETAINED_BY_DECISION')),
    disposition_action_execution_id uuid REFERENCES admission.action_execution(id),
    version integer NOT NULL DEFAULT 1,
    CHECK (jsonb_typeof(external_execution_ids) = 'array'),
    CHECK (jsonb_typeof(provider_evidence) = 'object'),
    CHECK ((subject = 'PLATFORM_CORE') = (component_binding_ref IS NULL AND component_binding_version IS NULL)),
    CHECK (subject <> 'PLATFORM_CORE' OR mode = 'PLATFORM_CORE_CHAIN')
);
CREATE UNIQUE INDEX tenant_delete_one_platform_chain
    ON admission.tenant_delete_subprocess (tenant_lifecycle_snapshot_id) WHERE subject = 'PLATFORM_CORE';

-- 任意写者均不能改写准入时冻结的 ID、版本与清单；只能推进证据和既有状态。
CREATE FUNCTION admission.protect_tenant_lifecycle_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.id, NEW.tenant_id, NEW.action_execution_id, NEW.tenant_version,
        NEW.resource_owner_versions, NEW.asset_owner_versions,
        NEW.component_binding_refs_and_versions, NEW.inventory_digest, NEW.frozen_inventory)
        IS DISTINCT FROM
       (OLD.id, OLD.tenant_id, OLD.action_execution_id, OLD.tenant_version,
        OLD.resource_owner_versions, OLD.asset_owner_versions,
        OLD.component_binding_refs_and_versions, OLD.inventory_digest, OLD.frozen_inventory) THEN
        RAISE EXCEPTION 'TenantLifecycleSnapshot frozen inventory is immutable';
    END IF;
    IF OLD.irreversible_dispatch_started AND NOT NEW.irreversible_dispatch_started THEN
        RAISE EXCEPTION 'irreversible dispatch evidence cannot be cleared';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tenant_lifecycle_snapshot_frozen BEFORE UPDATE ON admission.tenant_lifecycle_snapshot
    FOR EACH ROW EXECUTE FUNCTION admission.protect_tenant_lifecycle_snapshot();
-- ActionDefinition/ApprovalPolicy 不在此登记：四个 provider handler 都成立后由实际注册 gate 开放。
