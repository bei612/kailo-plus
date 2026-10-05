-- DD-88/94: the original Catalog owns binding facts, not component content.
-- All references, including PROVISIONING/ERROR, participate in category retirement.
CREATE TABLE catalog.application_binding (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES identity.tenant(id),
    workspace_id uuid REFERENCES identity.workspace(id),
    component_type_key text NOT NULL REFERENCES catalog.component_definition(type_key),
    component_release_id uuid NOT NULL REFERENCES catalog.component_release(id),
    service_principal_id uuid NOT NULL UNIQUE REFERENCES identity.service_principal(principal_id),
    adapter_service_ref text NOT NULL CHECK (adapter_service_ref<>''),
    native_instance_ref text NOT NULL CHECK (native_instance_ref<>''),
    native_scope_ref text,
    isolation_mode text NOT NULL CHECK (isolation_mode IN
        ('DEDICATED_INSTANCE','NATIVE_TENANT','NAMESPACE','RESOURCE_FILTER','RESOURCE_INSTANCE')),
    call_identity_mode text NOT NULL CHECK (call_identity_mode='INSTANCE_SERVICE'),
    capability_categories jsonb NOT NULL CHECK (jsonb_typeof(capability_categories)='array'
        AND jsonb_array_length(capability_categories)>0),
    normalized_config jsonb NOT NULL CHECK (jsonb_typeof(normalized_config)='object'),
    config_digest text NOT NULL CHECK (config_digest ~ '^[0-9a-f]{64}$'),
    secret_refs jsonb NOT NULL CHECK (jsonb_typeof(secret_refs)='array'),
    model_call_mode text NOT NULL CHECK (model_call_mode='NONE'),
    retain_on_tenant_delete boolean NOT NULL,
    active_projection_generation bigint,
    state text NOT NULL CHECK (state IN ('PROVISIONING','ACTIVE','UPGRADING','DISABLING','DISABLED','ERROR')),
    version integer NOT NULL CHECK (version>0),
    created_by_action_execution_id uuid NOT NULL UNIQUE REFERENCES admission.action_execution(id),
    projection_action_execution_id uuid NOT NULL REFERENCES admission.action_execution(id),
    UNIQUE (tenant_id,id),
    CHECK (state<>'ACTIVE' OR (active_projection_generation IS NOT NULL AND native_scope_ref IS NOT NULL)),
    CHECK (native_scope_ref IS NULL OR native_scope_ref<>'')
);

-- The category row is the shared serialization boundary with category.retire.
-- Even disabled bindings retain their immutable references for audit. Becoming
-- non-DISABLED again must recheck ACTIVE under the same locks; missing tables or
-- unknown category/version references never mean zero bindings.
CREATE FUNCTION catalog.guard_application_binding_categories() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entry jsonb; category_state text; category_name text; seen text[] := '{}';
BEGIN
    IF TG_OP='UPDATE' AND NEW.capability_categories IS DISTINCT FROM OLD.capability_categories THEN
        RAISE EXCEPTION 'binding categories are immutable' USING ERRCODE='23514';
    END IF;
    FOR entry IN SELECT value FROM jsonb_array_elements(NEW.capability_categories)
                 ORDER BY value->>'category' LOOP
        IF jsonb_typeof(entry)<>'object' OR entry-ARRAY['category','version']<>'{}'::jsonb
           OR jsonb_typeof(entry->'category') IS DISTINCT FROM 'string'
           OR jsonb_typeof(entry->'version') IS DISTINCT FROM 'number'
           OR (entry->>'version') !~ '^[1-9][0-9]*$' THEN
            RAISE EXCEPTION 'invalid binding category reference' USING ERRCODE='23514';
        END IF;
        category_name := entry->>'category';
        IF category_name=ANY(seen) THEN
            RAISE EXCEPTION 'duplicate binding category' USING ERRCODE='23514';
        END IF;
        seen := array_append(seen,category_name);
        SELECT status INTO category_state FROM catalog.capability_category
            WHERE category_key=category_name FOR UPDATE;
        IF NOT FOUND OR (NEW.state<>'DISABLED' AND category_state<>'ACTIVE') THEN
            RAISE EXCEPTION 'binding requires active category' USING ERRCODE='23514';
        END IF;
        -- The retirement migration permits only a byte-identical category
        -- update. Produce a row version as well as a lock, so REPEATABLE READ
        -- retirement cannot use an old snapshot after a concurrent binding.
        UPDATE catalog.capability_category SET category_key=category_key
            WHERE category_key=category_name;
        IF NOT EXISTS (SELECT 1 FROM catalog.capability_contract c
                       WHERE c.category_key=category_name
                         AND c.contract_version::text=entry->>'version'
                         AND ((TG_OP='UPDATE' AND OLD.state<>'DISABLED')
                              OR NEW.state='DISABLED' OR c.status='ACTIVE')) THEN
            RAISE EXCEPTION 'binding requires exact active contract' USING ERRCODE='23514';
        END IF;
    END LOOP;
    RETURN NEW;
END $$;
CREATE TRIGGER application_binding_categories BEFORE INSERT OR UPDATE ON catalog.application_binding
FOR EACH ROW EXECUTE FUNCTION catalog.guard_application_binding_categories();

CREATE TABLE projection.application_runtime (
    binding_id uuid NOT NULL REFERENCES catalog.application_binding(id),
    generation bigint NOT NULL CHECK (generation>0),
    component_release_id uuid NOT NULL REFERENCES catalog.component_release(id),
    normalized_manifest_digest text NOT NULL CHECK (normalized_manifest_digest ~ '^[0-9a-f]{64}$'),
    adapter_contract_digest text NOT NULL CHECK (adapter_contract_digest ~ '^[0-9a-f]{64}$'),
    state text NOT NULL CHECK (state IN ('PENDING','ACTIVE','ERROR','REVOKED')),
    action_execution_id uuid NOT NULL REFERENCES admission.action_execution(id),
    observation jsonb,
    PRIMARY KEY (binding_id,generation),
    CHECK (observation IS NULL OR jsonb_typeof(observation)='object'),
    CHECK (state<>'ACTIVE' OR observation IS NOT NULL)
);
ALTER TABLE catalog.application_binding ADD CONSTRAINT application_binding_active_generation
    FOREIGN KEY (id,active_projection_generation) REFERENCES projection.application_runtime(binding_id,generation);

CREATE TABLE projection.application_category (
    tenant_id uuid NOT NULL,
    workspace_id uuid REFERENCES identity.workspace(id),
    category_key text NOT NULL,
    contract_version integer NOT NULL,
    binding_id uuid NOT NULL,
    generation bigint NOT NULL,
    FOREIGN KEY (tenant_id,binding_id) REFERENCES catalog.application_binding(tenant_id,id),
    FOREIGN KEY (binding_id,generation) REFERENCES projection.application_runtime(binding_id,generation),
    FOREIGN KEY (category_key,contract_version) REFERENCES catalog.capability_contract(category_key,contract_version),
    UNIQUE NULLS NOT DISTINCT (tenant_id,workspace_id,category_key)
);
