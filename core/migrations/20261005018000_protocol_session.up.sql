-- 03 §3/§4, DD-90/103: the existing PROTOCOL Action owns this short-lived
-- record. It is not a Resource owner, permission table or native content store.
CREATE TABLE admission.protocol_session (
    id uuid PRIMARY KEY,
    operation_id uuid NOT NULL,
    action_execution_id uuid NOT NULL UNIQUE REFERENCES admission.action_execution(id),
    kind text NOT NULL CHECK (kind='file_storage.edit_session'),
    tenant_id uuid NOT NULL REFERENCES identity.tenant(id),
    workspace_id uuid REFERENCES identity.workspace(id),
    actor_principal_id uuid NOT NULL REFERENCES identity.principal(id),
    initiating_human_principal_id uuid NOT NULL REFERENCES identity.principal(id),
    application_binding_id uuid NOT NULL REFERENCES catalog.application_binding(id),
    target jsonb NOT NULL CHECK (jsonb_typeof(target)='object'),
    requested_mode text NOT NULL CHECK (requested_mode IN ('VIEW','EDIT')),
    admitted_mode text NOT NULL CHECK (admitted_mode IN ('VIEW','EDIT')),
    native_session_ref text,
    token_revocation_key uuid NOT NULL UNIQUE,
    launch_theme text NOT NULL CHECK (launch_theme IN ('LIGHT','DARK')),
    launch_locale text NOT NULL CHECK (launch_locale IN ('EN','ZH_CN')),
    base_revision text NOT NULL CHECK (base_revision<>''),
    state text NOT NULL CHECK (state IN
        ('ADMITTED','OPENING','OPEN','DIRTY','SAVED','READ_ONLY','CONFLICT',
         'REVOKED','CLOSED','EXPIRED','UNKNOWN','FAILED')),
    last_native_correlation_ref text,
    native_write_observation jsonb CHECK (native_write_observation IS NULL
        OR jsonb_typeof(native_write_observation)='object'),
    reconcile_input jsonb CHECK (reconcile_input IS NULL OR jsonb_typeof(reconcile_input)='object'),
    result_revision text,
    expires_at timestamptz NOT NULL,
    version integer NOT NULL CHECK (version>0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (token_revocation_key=id),
    CHECK (admitted_mode='VIEW' OR requested_mode='EDIT'),
    CHECK (state<>'SAVED' OR (result_revision IS NOT NULL AND result_revision<>''))
);

CREATE FUNCTION admission.guard_protocol_session() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a admission.action_execution%ROWTYPE; d catalog.action_definition%ROWTYPE;
    b catalog.application_binding%ROWTYPE;
BEGIN
    -- Metadata is the native writer's closed observation, not arbitrary JSON
    -- or another result authority. The correlation belongs to this exact
    -- Session; a receipt can never rebind the target or accepted revision.
    IF NEW.native_write_observation IS NOT NULL THEN
        IF NEW.native_write_observation - ARRAY['phase','correlationRef','editors',
                'baseModifiedAt','bytesWritten','nativeEtag','resultRevision']::text[]<>'{}'::jsonb
            OR jsonb_typeof(NEW.native_write_observation->'phase') IS DISTINCT FROM 'string'
            OR jsonb_typeof(NEW.native_write_observation->'correlationRef') IS DISTINCT FROM 'string'
            OR NEW.native_write_observation->>'correlationRef'=''
            OR NEW.last_native_correlation_ref IS DISTINCT FROM NEW.native_write_observation->>'correlationRef'
            OR jsonb_typeof(NEW.native_write_observation->'editors') IS DISTINCT FROM 'string'
            OR jsonb_typeof(NEW.native_write_observation->'baseModifiedAt') IS DISTINCT FROM 'string'
            OR jsonb_typeof(NEW.native_write_observation->'bytesWritten') IS DISTINCT FROM 'number'
            OR NEW.native_write_observation->>'bytesWritten' !~ '^[0-9]+$'
            OR (NEW.native_write_observation ? 'nativeEtag' AND
                (jsonb_typeof(NEW.native_write_observation->'nativeEtag') IS DISTINCT FROM 'string'
                 OR NEW.native_write_observation->>'nativeEtag'=''))
            OR (NEW.native_write_observation ? 'resultRevision' AND
                (jsonb_typeof(NEW.native_write_observation->'resultRevision') IS DISTINCT FROM 'string'
                 OR NEW.native_write_observation->>'resultRevision'=''))
            OR NOT (
                (NEW.native_write_observation->>'phase' IN ('STARTED','CONFLICT','FAILED')
                    AND NEW.native_write_observation->>'bytesWritten'='0'
                    AND NOT (NEW.native_write_observation ?| ARRAY['nativeEtag','resultRevision']))
                OR (NEW.native_write_observation->>'phase'='ACCEPTED'
                    AND NEW.native_write_observation ?& ARRAY['nativeEtag','resultRevision'])
                OR (NEW.native_write_observation->>'phase'='UNKNOWN'
                    AND NOT (NEW.native_write_observation ? 'resultRevision'))
            ) THEN
            RAISE EXCEPTION 'ProtocolSession native write observation is not closed evidence' USING ERRCODE='23514';
        END IF;
    ELSIF NEW.last_native_correlation_ref IS NOT NULL THEN
        RAISE EXCEPTION 'ProtocolSession correlation requires original native evidence' USING ERRCODE='23514';
    END IF;
    IF TG_OP='INSERT' THEN
        SELECT * INTO a FROM admission.action_execution WHERE id=NEW.action_execution_id FOR UPDATE;
        SELECT * INTO d FROM catalog.action_definition WHERE id=a.action_definition_id;
        SELECT * INTO b FROM catalog.application_binding WHERE id=NEW.application_binding_id FOR UPDATE;
        IF a.id IS NULL OR d.id IS NULL OR b.id IS NULL OR b.state<>'ACTIVE'
            OR b.tenant_id<>NEW.tenant_id OR (b.workspace_id IS NOT NULL AND b.workspace_id IS DISTINCT FROM NEW.workspace_id)
            OR b.component_release_id IS DISTINCT FROM a.component_release_id
            OR b.active_projection_generation IS DISTINCT FROM a.component_projection_generation
            OR a.gate_state<>'ALLOWED'
            OR a.component_binding_kind IS DISTINCT FROM 'APPLICATION'
            OR d.execution_mode<>'PROTOCOL' OR d.capacity_policy<>'NATIVE'
            OR d.action_key NOT IN ('file_storage.open_view@v1','file_storage.open_edit@v1')
            OR a.parent_action_execution_id IS NOT NULL
            OR ROW(NEW.operation_id,NEW.tenant_id,NEW.workspace_id,NEW.actor_principal_id,
                   NEW.initiating_human_principal_id,NEW.application_binding_id)
                IS DISTINCT FROM ROW(a.operation_id,a.tenant_id,a.workspace_id,a.actor_principal_id,
                   a.initiator_principal_id,a.component_binding_id)
            OR NOT EXISTS (SELECT 1 FROM identity.principal p
                JOIN identity.tenant_membership m ON m.tenant_principal_id=p.id AND m.tenant_id=p.tenant_id
                WHERE p.id=a.actor_principal_id AND p.tenant_id=a.tenant_id AND p.kind='HUMAN'
                    AND p.status='ACTIVE' AND m.state='ACTIVE')
            OR a.actor_principal_id<>a.initiator_principal_id
            OR NEW.target->>'nativeRevision' IS DISTINCT FROM NEW.base_revision
            OR NEW.target->>'resourceId' IS NULL OR NEW.target->>'nativeObjectRef' IS NULL
            OR (d.target_type='RESOURCE' AND NEW.target->>'resourceId'<>a.target_id::text)
            OR (d.target_type='ASSET' AND NEW.target->>'assetId' IS DISTINCT FROM a.target_id::text)
            OR (d.action_key='file_storage.open_view@v1' AND NEW.requested_mode<>'VIEW')
            OR (d.action_key='file_storage.open_edit@v1' AND NEW.requested_mode<>'EDIT')
            OR NEW.state<>'ADMITTED' OR NEW.version<>1 OR NEW.expires_at<=clock_timestamp()
            OR NEW.native_session_ref IS NOT NULL OR NEW.result_revision IS NOT NULL
            OR NEW.last_native_correlation_ref IS NOT NULL OR NEW.native_write_observation IS NOT NULL
            OR NEW.reconcile_input IS NOT NULL THEN
            RAISE EXCEPTION 'ProtocolSession requires its exact admitted HUMAN protocol action' USING ERRCODE='23514';
        END IF;
        -- The original binding guards allow this byte-identical update. Its
        -- physical row version fences old RR snapshots against a new Session;
        -- it does not change a business field, generation or lifecycle version.
        UPDATE catalog.application_binding SET id=id WHERE id=b.id;
        RETURN NEW;
    END IF;
    IF ROW(NEW.id,NEW.operation_id,NEW.action_execution_id,NEW.kind,NEW.tenant_id,NEW.workspace_id,
           NEW.actor_principal_id,NEW.initiating_human_principal_id,NEW.application_binding_id,
           NEW.target,NEW.requested_mode,NEW.token_revocation_key,NEW.launch_theme,NEW.launch_locale,
           NEW.base_revision,NEW.expires_at,NEW.created_at)
        IS DISTINCT FROM ROW(OLD.id,OLD.operation_id,OLD.action_execution_id,OLD.kind,OLD.tenant_id,
           OLD.workspace_id,OLD.actor_principal_id,OLD.initiating_human_principal_id,OLD.application_binding_id,
           OLD.target,OLD.requested_mode,OLD.token_revocation_key,OLD.launch_theme,OLD.launch_locale,
           OLD.base_revision,OLD.expires_at,OLD.created_at)
        OR (OLD.native_session_ref IS NOT NULL AND NEW.native_session_ref IS DISTINCT FROM OLD.native_session_ref)
        OR (OLD.admitted_mode='VIEW' AND NEW.admitted_mode<>'VIEW')
        OR (OLD.reconcile_input IS NOT NULL AND NEW.reconcile_input IS DISTINCT FROM OLD.reconcile_input)
        OR NEW.version<>OLD.version+1 THEN
        RAISE EXCEPTION 'ProtocolSession identity, revision and expiry are frozen' USING ERRCODE='23514';
    END IF;
    IF OLD.reconcile_input IS NULL AND NEW.reconcile_input IS NOT NULL THEN
        SELECT * INTO a FROM admission.action_execution WHERE id=NEW.action_execution_id;
        IF OLD.state<>'UNKNOWN' OR NEW.state<>'UNKNOWN'
            OR NEW.reconcile_input - ARRAY['actionExecutionId','protocolSessionId','sessionVersion',
                'workflowId','bindingId','releaseId','projectionGeneration','actionDefinitionId',
                'baseRevision','nativeObjectRef','correlationRef']::text[]<>'{}'::jsonb
            OR NEW.reconcile_input->>'actionExecutionId' IS DISTINCT FROM NEW.action_execution_id::text
            OR NEW.reconcile_input->>'protocolSessionId' IS DISTINCT FROM NEW.id::text
            OR NEW.reconcile_input->>'sessionVersion' IS DISTINCT FROM NEW.version::text
            OR NEW.reconcile_input->>'workflowId' IS DISTINCT FROM
                format('platform:protocol_session_reconcile:%s:%s:%s',NEW.tenant_id,NEW.id,NEW.version)
            OR NEW.reconcile_input->>'bindingId' IS DISTINCT FROM NEW.application_binding_id::text
            OR NEW.reconcile_input->>'releaseId' IS DISTINCT FROM a.component_release_id::text
            OR NEW.reconcile_input->>'projectionGeneration' IS DISTINCT FROM a.component_projection_generation::text
            OR NEW.reconcile_input->>'actionDefinitionId' IS DISTINCT FROM a.action_definition_id::text
            OR NEW.reconcile_input->>'baseRevision' IS DISTINCT FROM NEW.base_revision
            OR NEW.reconcile_input->>'nativeObjectRef' IS DISTINCT FROM NEW.target->>'nativeObjectRef'
            OR NEW.reconcile_input->>'correlationRef' IS DISTINCT FROM NEW.last_native_correlation_ref THEN
            RAISE EXCEPTION 'ProtocolSession reconcile input must freeze its first UNKNOWN facts' USING ERRCODE='23514';
        END IF;
    END IF;
    IF NOT (
        (OLD.state='ADMITTED' AND NEW.state='OPENING')
        OR (OLD.state='OPENING' AND NEW.state='OPEN' AND NEW.native_session_ref IS NOT NULL)
        OR (OLD.state IN ('OPEN','SAVED') AND NEW.state='DIRTY'
            AND NEW.native_write_observation->>'phase'='STARTED')
        OR (OLD.state='DIRTY' AND NEW.state IN ('SAVED','CONFLICT','UNKNOWN')
            AND NEW.last_native_correlation_ref=OLD.last_native_correlation_ref)
        OR (OLD.state IN ('OPEN','DIRTY','SAVED') AND NEW.state='READ_ONLY' AND NEW.admitted_mode='VIEW')
        OR (OLD.state IN ('OPEN','SAVED','READ_ONLY') AND NEW.state='CLOSED'
            AND (OLD.native_write_observation IS NULL OR OLD.native_write_observation->>'phase'='ACCEPTED'))
        OR (OLD.state='UNKNOWN' AND NEW.state IN ('SAVED','CONFLICT','FAILED')
            AND NEW.last_native_correlation_ref=OLD.last_native_correlation_ref)
        OR (OLD.state='UNKNOWN' AND NEW.state='UNKNOWN'
            AND NEW.last_native_correlation_ref IS NOT DISTINCT FROM OLD.last_native_correlation_ref
            AND NEW.native_write_observation->>'correlationRef'=OLD.native_write_observation->>'correlationRef')
        OR (OLD.state NOT IN ('CLOSED','EXPIRED','REVOKED','FAILED') AND NEW.state IN ('REVOKED','FAILED'))
        OR (OLD.state IN ('ADMITTED','OPENING','OPEN','READ_ONLY','SAVED') AND NEW.state='EXPIRED'
            AND (OLD.native_write_observation IS NULL OR OLD.native_write_observation->>'phase'='ACCEPTED')
            AND clock_timestamp()>=OLD.expires_at)
        OR (OLD.state IN ('ADMITTED','OPENING','OPEN','DIRTY','SAVED','READ_ONLY') AND NEW.state='UNKNOWN'
            AND (OLD.state='DIRTY' OR OLD.native_write_observation->>'phase' IN ('STARTED','UNKNOWN'))
            AND clock_timestamp()>=OLD.expires_at)
    ) THEN RAISE EXCEPTION 'ProtocolSession transition is not defined' USING ERRCODE='23514'; END IF;
    IF NEW.state='SAVED' AND (NEW.native_write_observation->>'phase' IS DISTINCT FROM 'ACCEPTED'
        OR NEW.result_revision IS DISTINCT FROM NEW.native_write_observation->>'resultRevision') THEN
        RAISE EXCEPTION 'ProtocolSession SAVED requires original accepted revision evidence' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER protocol_session_guard BEFORE INSERT OR UPDATE ON admission.protocol_session
FOR EACH ROW EXECUTE FUNCTION admission.guard_protocol_session();

CREATE INDEX protocol_session_unresolved ON admission.protocol_session(expires_at)
WHERE state NOT IN ('CLOSED','EXPIRED','REVOKED','FAILED');

CREATE FUNCTION catalog.guard_application_binding_protocol_drain() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.state='DISABLED' AND EXISTS (
        SELECT 1 FROM admission.protocol_session s JOIN admission.action_execution a
          ON a.id=s.action_execution_id AND a.operation_id=s.operation_id
        WHERE s.application_binding_id=NEW.id AND (
          s.state NOT IN ('CLOSED','EXPIRED','REVOKED','FAILED')
          OR s.native_write_observation->>'phase' IN ('STARTED','UNKNOWN')
          OR (a.dispatch_state IN ('UNKNOWN','DISPATCHED') AND NOT EXISTS (
            SELECT 1 FROM audit.audit_event e
            WHERE e.event_key=a.operation_id::text||':protocol-pat-revoked' AND e.operation_id=a.operation_id
              AND e.tenant_id=a.tenant_id AND e.workspace_id IS NOT DISTINCT FROM a.workspace_id
              AND e.action_key=a.action_key AND e.action_version=a.action_version AND e.target_id=a.target_id
              AND e.parameter_hash=a.parameter_hash AND e.actor_principal_id=a.actor_principal_id
              AND e.initiator_principal_id=a.initiator_principal_id AND e.event_type='REVOCATION'
              AND e.decision='ALLOW' AND e.result_code='NATIVE_ABSENCE_CONFIRMED'))
        )) THEN
        RAISE EXCEPTION 'binding cannot stop a protocol writer or retain an unrevoked PAT' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER application_binding_protocol_drain BEFORE UPDATE ON catalog.application_binding
FOR EACH ROW EXECUTE FUNCTION catalog.guard_application_binding_protocol_drain();

-- System reconciliation is not a new business ActionDefinition Workflow kind.
-- The original one_per_type index remains unchanged: all save rounds share it.
ALTER TABLE projection.workflow_ref DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE projection.workflow_ref ADD CONSTRAINT workflow_kind_enum CHECK (kind IN
 ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
 'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION','COMPONENT_RELEASE',
 'COMPONENT_BINDING','COMPONENT_DISABLE','RESOURCE_PROVISION','PROTOCOL_SESSION_RECONCILE'));
