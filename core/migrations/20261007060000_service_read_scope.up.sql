-- DD-89: SERVICE read batches are original AE roots, never HUMAN/AGENT children.
-- Their execution Workspace comes from the receiver binding. A Tenant receiver
-- may read a granted Workspace resource; existing user/Agent scope is unchanged.
CREATE OR REPLACE FUNCTION admission.freeze_execution_definition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected uuid; service_read boolean := false;
BEGIN
    IF TG_OP='UPDATE' THEN
        IF OLD.parameters->>'componentActionKind'='SERVICE_READ' AND
          ROW(NEW.tenant_id,NEW.workspace_id,NEW.initiator_principal_id,NEW.actor_principal_id,
              NEW.target_id,NEW.parameter_hash,NEW.action_key,NEW.action_version,NEW.parameters-'readToken')
          IS DISTINCT FROM
          ROW(OLD.tenant_id,OLD.workspace_id,OLD.initiator_principal_id,OLD.actor_principal_id,
              OLD.target_id,OLD.parameter_hash,OLD.action_key,OLD.action_version,OLD.parameters-'readToken') THEN
            RAISE EXCEPTION 'Service read batch provenance is frozen' USING ERRCODE='23514';
        END IF;
        IF ROW(NEW.action_definition_id,NEW.component_binding_kind,NEW.component_binding_id,
               NEW.component_release_id,NEW.component_projection_generation)
          IS DISTINCT FROM ROW(OLD.action_definition_id,OLD.component_binding_kind,OLD.component_binding_id,
               OLD.component_release_id,OLD.component_projection_generation) THEN
            RAISE EXCEPTION 'execution implementation is frozen' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.parameters->>'componentActionKind'='SERVICE_READ' THEN
        SELECT EXISTS(SELECT 1 FROM catalog.application_binding receiver
            JOIN identity.service_principal service ON service.principal_id=receiver.service_principal_id
                AND service.component_binding_kind='APPLICATION' AND service.component_binding_id=receiver.id
            JOIN identity.principal principal ON principal.id=service.principal_id
                AND principal.tenant_id=receiver.tenant_id AND principal.kind='SERVICE' AND principal.status='ACTIVE'
            JOIN identity.tenant tenant ON tenant.id=receiver.tenant_id AND tenant.state='ACTIVE'
            LEFT JOIN identity.workspace workspace ON workspace.id=receiver.workspace_id AND workspace.tenant_id=receiver.tenant_id
            WHERE receiver.id=(NEW.parameters->>'receiverBindingId')::uuid
              AND receiver.tenant_id=NEW.tenant_id AND receiver.state='ACTIVE'
              AND receiver.workspace_id IS NOT DISTINCT FROM NEW.workspace_id
              AND (receiver.workspace_id IS NULL OR workspace.state='ACTIVE')
              AND receiver.active_projection_generation=(NEW.parameters->>'receiverGeneration')::bigint
              AND principal.id=NEW.actor_principal_id AND NEW.initiator_principal_id=NEW.actor_principal_id
              AND NEW.parent_action_execution_id IS NULL AND NEW.component_binding_kind='APPLICATION') INTO service_read;
        IF NOT service_read THEN
            RAISE EXCEPTION 'Service read requires the exact receiver ServicePrincipal and scope' USING ERRCODE='23514';
        END IF;
    END IF;
    IF NEW.component_binding_kind IS NULL THEN
        SELECT id INTO expected FROM catalog.action_definition
        WHERE action_key=NEW.action_key AND version=NEW.action_version AND component_release_id IS NULL;
    ELSE
        SELECT d.id INTO expected FROM catalog.application_binding b
        JOIN projection.application_runtime p ON p.binding_id=b.id AND p.generation=NEW.component_projection_generation
        JOIN catalog.action_definition d ON d.component_release_id=p.component_release_id
        WHERE b.id=NEW.component_binding_id AND b.tenant_id=NEW.tenant_id
          AND (b.workspace_id IS NULL OR b.workspace_id=NEW.workspace_id OR (service_read AND NEW.workspace_id IS NULL))
          AND b.state='ACTIVE' AND b.active_projection_generation=p.generation AND p.state='ACTIVE'
          AND p.component_release_id=NEW.component_release_id AND b.component_release_id=p.component_release_id
          AND d.action_key=NEW.action_key AND d.version=NEW.action_version AND d.status='ACTIVE'
          AND (NOT service_read OR (d.target_type='RESOURCE' AND d.permission_object_type='resource'
              AND d.permission IN ('read','discover') AND d.execution_mode='SYNC'
              AND d.confirmation_mode='NONE' AND d.approval_policy_id IS NULL));
        IF expected IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM catalog.action_definition d
            JOIN catalog.resource r ON r.application_binding_id=NEW.component_binding_id
              AND r.tenant_id=NEW.tenant_id AND r.state='ACTIVE'
              AND (r.home_workspace_id IS NULL OR r.home_workspace_id=NEW.workspace_id OR (service_read AND NEW.workspace_id IS NULL))
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
