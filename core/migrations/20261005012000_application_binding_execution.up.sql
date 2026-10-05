-- DD-48/94/98: original ExternalExecution, not another workflow or native task.
ALTER TABLE projection.application_runtime ADD COLUMN validation_keys jsonb
    CHECK (validation_keys IS NULL OR (jsonb_typeof(validation_keys)='object'
        AND validation_keys ?& ARRAY['handshake','validate_binding']));

CREATE TABLE admission.external_execution (
    id uuid PRIMARY KEY,
    operation_id uuid NOT NULL REFERENCES admission.action_execution(root_operation_id),
    workflow_id text NOT NULL REFERENCES projection.workflow_ref(workflow_id),
    action_execution_id uuid NOT NULL REFERENCES admission.action_execution(id),
    tenant_id uuid NOT NULL,
    workspace_id uuid REFERENCES identity.workspace(id),
    component_binding_id uuid NOT NULL,
    component_binding_version integer NOT NULL CHECK (component_binding_version>0),
    component_release_id uuid NOT NULL REFERENCES catalog.component_release(id),
    component_projection_generation bigint NOT NULL,
    protocol_operation text NOT NULL CHECK (protocol_operation IN
        ('handshake','validate_binding','resolve_native_scope','execute','observe','cancel','reconcile','query_revision','extract_usage','map_native_status_error')),
    native_type text NOT NULL CHECK (native_type<>''),
    native_id text,
    idempotency_key uuid NOT NULL UNIQUE,
    request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
    native_status text,
    platform_status text NOT NULL CHECK (platform_status IN
        ('PENDING_DISPATCH','RUNNING','SUCCEEDED','FAILED','CANCELLED','UNKNOWN')),
    cancel_capability text NOT NULL CHECK (cancel_capability IN ('SUPPORTED','UNSUPPORTED')),
    last_observed_at timestamptz,
    terminal_at timestamptz,
    response_digest text CHECK (response_digest ~ '^[0-9a-f]{64}$'),
    FOREIGN KEY (tenant_id,component_binding_id) REFERENCES catalog.application_binding(tenant_id,id),
    FOREIGN KEY (component_binding_id,component_projection_generation)
        REFERENCES projection.application_runtime(binding_id,generation),
    UNIQUE (action_execution_id,protocol_operation),
    CHECK ((platform_status IN ('SUCCEEDED','FAILED','CANCELLED')) = (terminal_at IS NOT NULL)),
    CHECK (terminal_at IS NULL OR (last_observed_at>=terminal_at AND native_status IS NOT NULL))
);

CREATE FUNCTION admission.guard_application_external_execution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM admission.action_execution a
        JOIN admission.action_execution root
            ON root.id=COALESCE(a.parent_action_execution_id,a.id)
              AND root.operation_id=a.operation_id AND root.parent_action_execution_id IS NULL
              AND root.tenant_id=a.tenant_id AND root.workspace_id IS NOT DISTINCT FROM a.workspace_id
        JOIN projection.workflow_ref w
            ON w.action_execution_id=root.id AND w.workflow_id=NEW.workflow_id
        JOIN catalog.application_binding b ON b.id=NEW.component_binding_id AND b.tenant_id=a.tenant_id
        WHERE a.id=NEW.action_execution_id AND a.operation_id=NEW.operation_id
          AND a.tenant_id=NEW.tenant_id AND a.workspace_id IS NOT DISTINCT FROM NEW.workspace_id
          AND (b.workspace_id IS NULL OR b.workspace_id=NEW.workspace_id)
          AND b.component_release_id=NEW.component_release_id
          AND a.gate_state='ALLOWED' AND a.dispatch_state='DISPATCHED'
    ) THEN
        RAISE EXCEPTION 'external execution requires original governed scope/workflow' USING ERRCODE='23514';
    END IF;
    IF TG_OP='UPDATE' THEN
        IF (to_jsonb(NEW)-ARRAY['native_id','native_status','platform_status','last_observed_at','terminal_at','response_digest'])
          IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['native_id','native_status','platform_status','last_observed_at','terminal_at','response_digest'])
          OR (OLD.native_id IS NOT NULL AND NEW.native_id IS DISTINCT FROM OLD.native_id)
          OR (OLD.terminal_at IS NOT NULL AND NEW IS DISTINCT FROM OLD)
          OR NEW.last_observed_at<OLD.last_observed_at THEN
            RAISE EXCEPTION 'external execution intent/native terminal is immutable' USING ERRCODE='23514';
        END IF;
    ELSIF NEW.platform_status<>'PENDING_DISPATCH' OR NEW.native_id IS NOT NULL
       OR NEW.terminal_at IS NOT NULL OR NEW.response_digest IS NOT NULL THEN
        RAISE EXCEPTION 'external execution must start before dispatch' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER application_external_execution_source BEFORE INSERT OR UPDATE ON admission.external_execution
FOR EACH ROW EXECUTE FUNCTION admission.guard_application_external_execution();

-- Guard the original Catalog write boundary, including writers other than the
-- BFF path. Source admission is checked before the runtime can become ACTIVE.
CREATE FUNCTION catalog.guard_application_binding_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source admission.action_execution; creating admission.action_execution;
BEGIN
    SELECT * INTO STRICT creating FROM admission.action_execution WHERE id=NEW.created_by_action_execution_id;
    SELECT * INTO STRICT source FROM admission.action_execution WHERE id=NEW.projection_action_execution_id;
    IF creating.action_key<>'application_binding.create'
       OR creating.target_id<>NEW.id OR creating.tenant_id<>NEW.tenant_id
       OR creating.workspace_id IS DISTINCT FROM NEW.workspace_id
       OR source.target_id<>NEW.id OR source.tenant_id<>NEW.tenant_id
       OR source.workspace_id IS DISTINCT FROM NEW.workspace_id
       OR source.action_key NOT IN ('application_binding.create','application_binding.disable')
       OR NOT EXISTS (SELECT 1 FROM identity.principal p
            WHERE p.id=creating.initiator_principal_id AND p.tenant_id=NEW.tenant_id AND p.kind='HUMAN')
       OR NOT EXISTS (SELECT 1 FROM identity.service_principal s JOIN identity.principal p ON p.id=s.principal_id
            WHERE s.principal_id=NEW.service_principal_id AND p.tenant_id=NEW.tenant_id AND p.kind='SERVICE')
       OR (NEW.workspace_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM identity.workspace w
            WHERE w.id=NEW.workspace_id AND w.tenant_id=NEW.tenant_id))
       OR NOT EXISTS (SELECT 1 FROM catalog.component_release r
            WHERE r.id=NEW.component_release_id AND r.component_type_key=NEW.component_type_key)
    THEN
        RAISE EXCEPTION 'binding requires its original governed scope and identity' USING ERRCODE='23514';
    END IF;
    IF TG_OP='INSERT' THEN
        -- Admission persists intent and then ALLOWED in this same transaction.
        IF NEW.state<>'PROVISIONING' OR NEW.version<>1 OR NEW.active_projection_generation IS NOT NULL
           OR NEW.created_by_action_execution_id<>NEW.projection_action_execution_id
           OR creating.gate_state NOT IN ('EVALUATING','WAITING','ALLOWED') THEN
            RAISE EXCEPTION 'binding starts as original provisioning intent' USING ERRCODE='23514';
        END IF;
    ELSE
        IF (to_jsonb(NEW)-ARRAY['state','version','native_scope_ref','active_projection_generation','projection_action_execution_id'])
            IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','version','native_scope_ref','active_projection_generation','projection_action_execution_id'])
           OR (OLD.native_scope_ref IS NOT NULL AND OLD.native_scope_ref IS DISTINCT FROM NEW.native_scope_ref)
           OR (OLD.active_projection_generation IS NOT NULL AND OLD.active_projection_generation IS DISTINCT FROM NEW.active_projection_generation)
           OR (OLD.state='DISABLED' AND NEW IS DISTINCT FROM OLD) THEN
            RAISE EXCEPTION 'binding immutable identity, scope and history changed' USING ERRCODE='23514';
        END IF;
        IF NEW.state IS DISTINCT FROM OLD.state THEN
            IF NEW.version<>OLD.version+1 OR NOT (
                (OLD.state='PROVISIONING' AND NEW.state IN ('ACTIVE','DISABLING','ERROR'))
                OR (OLD.state IN ('ACTIVE','ERROR') AND NEW.state='DISABLING')
                OR (OLD.state='DISABLING' AND NEW.state='DISABLED')) THEN
                RAISE EXCEPTION 'invalid binding lifecycle transition' USING ERRCODE='23514';
            END IF;
        ELSIF NEW.version<>OLD.version THEN
            RAISE EXCEPTION 'binding version changed without lifecycle transition' USING ERRCODE='23514';
        END IF;
    END IF;
    IF NEW.state='ACTIVE' THEN
        IF source.action_key<>'application_binding.create' OR source.gate_state<>'ALLOWED'
           OR source.dispatch_state<>'DISPATCHED' OR NOT EXISTS (
            SELECT 1 FROM projection.application_runtime p WHERE p.binding_id=NEW.id
              AND p.generation=NEW.active_projection_generation AND p.component_release_id=NEW.component_release_id
              AND p.action_execution_id=NEW.projection_action_execution_id AND p.state='ACTIVE'
              AND p.observation->>'bindingId'=NEW.id::text
              AND p.observation->>'nativeScopeRef'=NEW.native_scope_ref
              AND p.observation->>'configDigest'=NEW.config_digest)
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.capability_categories) category
              WHERE NOT EXISTS (SELECT 1 FROM projection.application_category c
                WHERE c.binding_id=NEW.id AND c.generation=NEW.active_projection_generation
                  AND c.tenant_id=NEW.tenant_id AND c.workspace_id IS NOT DISTINCT FROM NEW.workspace_id
                  AND c.category_key=category->>'category' AND c.contract_version::text=category->>'version')) THEN
            RAISE EXCEPTION 'binding active generation is not reconciled' USING ERRCODE='23514';
        END IF;
    END IF;
    IF NEW.state='DISABLED' AND (
        EXISTS (SELECT 1 FROM projection.application_category WHERE binding_id=NEW.id)
        OR EXISTS (SELECT 1 FROM projection.application_runtime WHERE binding_id=NEW.id AND state<>'REVOKED')
        OR EXISTS (SELECT 1 FROM admission.external_execution WHERE component_binding_id=NEW.id
            AND platform_status NOT IN ('SUCCEEDED','FAILED','CANCELLED'))) THEN
        RAISE EXCEPTION 'binding cannot discard an unreconciled reference' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER application_binding_source BEFORE INSERT OR UPDATE ON catalog.application_binding
FOR EACH ROW EXECUTE FUNCTION catalog.guard_application_binding_source();
