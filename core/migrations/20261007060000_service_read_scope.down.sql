-- Do not withdraw the deployed writer/identity guard while SERVICE batch history
-- exists. Stop rollback; never delete that audit-linked history to make it pass.
DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM admission.action_execution WHERE parameters->>'componentActionKind'='SERVICE_READ') THEN
        RAISE EXCEPTION 'Service read batches exist; keep the matching schema and writer' USING ERRCODE='23514';
    END IF;
END $$;
CREATE OR REPLACE FUNCTION admission.freeze_execution_definition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected uuid;
BEGIN
    IF TG_OP='UPDATE' THEN
        IF ROW(NEW.action_definition_id,NEW.component_binding_kind,NEW.component_binding_id,
               NEW.component_release_id,NEW.component_projection_generation)
          IS DISTINCT FROM ROW(OLD.action_definition_id,OLD.component_binding_kind,OLD.component_binding_id,
               OLD.component_release_id,OLD.component_projection_generation) THEN
            RAISE EXCEPTION 'execution implementation is frozen' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.component_binding_kind IS NULL THEN
        SELECT id INTO expected FROM catalog.action_definition
        WHERE action_key=NEW.action_key AND version=NEW.action_version AND component_release_id IS NULL;
    ELSE
        SELECT d.id INTO expected FROM catalog.application_binding b
        JOIN projection.application_runtime p ON p.binding_id=b.id AND p.generation=NEW.component_projection_generation
        JOIN catalog.action_definition d ON d.component_release_id=p.component_release_id
        WHERE b.id=NEW.component_binding_id AND b.tenant_id=NEW.tenant_id
          AND (b.workspace_id IS NULL OR b.workspace_id=NEW.workspace_id)
          AND b.state='ACTIVE' AND b.active_projection_generation=p.generation AND p.state='ACTIVE'
          AND p.component_release_id=NEW.component_release_id AND b.component_release_id=p.component_release_id
          AND d.action_key=NEW.action_key AND d.version=NEW.action_version AND d.status='ACTIVE';
        IF expected IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM catalog.action_definition d
            JOIN catalog.resource r ON r.application_binding_id=NEW.component_binding_id
              AND r.tenant_id=NEW.tenant_id AND r.state='ACTIVE'
              AND (r.home_workspace_id IS NULL OR r.home_workspace_id=NEW.workspace_id)
            WHERE d.id=expected AND (
                (d.target_type='RESOURCE' AND r.id=NEW.target_id)
                OR (d.target_type='ASSET' AND EXISTS(SELECT 1 FROM catalog.asset a
                    WHERE a.id=NEW.target_id AND a.resource_id=r.id AND a.tenant_id=r.tenant_id AND a.state='ACTIVE')))
        ) THEN RAISE EXCEPTION 'execution target differs from binding scope' USING ERRCODE='23514'; END IF;
        IF expected IS NULL THEN RAISE EXCEPTION 'execution implementation unavailable' USING ERRCODE='23514'; END IF;
    END IF;
    IF NEW.action_definition_id IS NOT NULL AND NEW.action_definition_id IS DISTINCT FROM expected THEN
        RAISE EXCEPTION 'execution definition differs from frozen implementation' USING ERRCODE='23514';
    END IF;
    NEW.action_definition_id:=expected;
    RETURN NEW;
END $$;
