-- DD-47, 03 §8: exact terminal holder + fenced no-dispatch recovery; units never released.
CREATE FUNCTION admission.capacity_invocation_unstarted(invocation uuid) RETURNS boolean AS $$
BEGIN
    -- This row lock is also held by Session birth before STARTING is committed.
    PERFORM 1 FROM catalog.agent_invocation i
    JOIN catalog.agent_session s ON s.tenant_id=i.tenant_id AND s.workspace_id=i.workspace_id
      AND s.root_event_id=i.root_event_id AND s.installation_resource_id=i.installation_resource_id
      AND s.agent_version_asset_id=i.agent_version_asset_id AND s.projection_generation=i.projection_generation
    JOIN admission.action_execution a ON a.id=i.action_execution_id
      AND a.tenant_id=i.tenant_id AND a.workspace_id=i.workspace_id
    WHERE i.id=invocation AND i.status='CREATED' AND NOT i.cancel_pending
      AND i.runtime_turn_id IS NULL AND i.native_status IS NULL AND i.reply_event_id IS NULL
      AND s.status='PENDING' AND s.runtime_thread_id IS NULL AND a.gate_state='ALLOWED'
      AND NOT EXISTS(SELECT 1 FROM projection.agent_model_trace t WHERE t.invocation_id=i.id)
      AND NOT EXISTS(SELECT 1 FROM outbox.usage_event u WHERE u.invocation_id=i.id OR u.operation_id=a.operation_id)
    FOR UPDATE OF i,s;
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION admission.guard_capacity_lease() RETURNS trigger AS $$
DECLARE handover boolean := false;
BEGIN
    IF TG_OP='UPDATE' THEN
        handover := (NEW.run_id,NEW.activity_id,NEW.scheduled_event_id)
            IS DISTINCT FROM (OLD.run_id,OLD.activity_id,OLD.scheduled_event_id);
        IF handover AND (
            OLD.state NOT IN ('HELD','UNKNOWN','EXPIRED') OR OLD.native_release_confirmed_at IS NOT NULL OR
            OLD.terminal_event_id IS NULL OR OLD.terminal_event_at IS NULL OR
            NEW.state<>'HELD' OR NEW.native_release_confirmed_at IS NOT NULL OR
            NEW.terminal_event_id IS NOT NULL OR NEW.terminal_event_at IS NOT NULL OR
            NEW.renewed_at IS NULL OR NEW.renewed_at<OLD.terminal_event_at OR
            NEW.expires_at<=clock_timestamp() OR
            (NEW.run_id=OLD.run_id AND NEW.scheduled_event_id<=OLD.terminal_event_id) OR
            NOT admission.capacity_invocation_unstarted(OLD.invocation_id)) THEN
            RAISE EXCEPTION 'Capacity holder 移交缺少原终态或存在 native 派发意图'
                USING ERRCODE='check_violation';
        END IF;
    END IF;
    IF TG_OP='UPDATE' AND (
        NEW.id IS DISTINCT FROM OLD.id OR NEW.invocation_id IS DISTINCT FROM OLD.invocation_id OR
        NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
        NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.pool_key IS DISTINCT FROM OLD.pool_key OR
        NEW.workflow_id IS DISTINCT FROM OLD.workflow_id OR
        NEW.units IS DISTINCT FROM OLD.units OR NEW.acquired_at IS DISTINCT FROM OLD.acquired_at OR
        (NOT handover AND NEW.attempt < OLD.attempt) OR
        (OLD.state='RELEASED' AND NEW IS DISTINCT FROM OLD) OR
        (OLD.native_release_confirmed_at IS NOT NULL AND
            NEW.native_release_confirmed_at IS DISTINCT FROM OLD.native_release_confirmed_at) OR
        (NOT handover AND OLD.terminal_event_id IS NOT NULL AND
            (NEW.terminal_event_id IS DISTINCT FROM OLD.terminal_event_id OR
             NEW.terminal_event_at IS DISTINCT FROM OLD.terminal_event_at))) THEN
        RAISE EXCEPTION 'CapacityLease scope、holder 或终态证据不可替换'
            USING ERRCODE='check_violation';
    END IF;
    PERFORM 1 FROM catalog.agent_invocation i
    JOIN admission.action_execution a ON a.id=i.action_execution_id
    JOIN projection.workflow_ref w ON w.workflow_id=i.workflow_id
    JOIN catalog.action_definition d ON d.action_key=a.action_key AND d.version=a.action_version
    WHERE i.id=NEW.invocation_id AND i.tenant_id=NEW.tenant_id AND i.workspace_id=NEW.workspace_id
      AND a.operation_id=NEW.operation_id AND a.tenant_id=NEW.tenant_id AND a.workspace_id=NEW.workspace_id
      AND w.operation_id=NEW.operation_id AND w.action_execution_id=a.id
      AND w.tenant_id=NEW.tenant_id AND w.workspace_id=NEW.workspace_id
      AND w.workflow_id=NEW.workflow_id AND w.workflow_type='AgentTaskWorkflow' AND w.kind IS NULL
      AND d.capacity_policy='PLATFORM_SLOT' AND d.capacity_pool_key=NEW.pool_key;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'CapacityLease 必须关联同 scope 的 Invocation/Operation/Workflow 与平台池'
            USING ERRCODE='check_violation';
    END IF;
    IF handover THEN
        -- Original append-only audit, not a second lease or execution ledger.
        INSERT INTO audit.audit_event(id,event_key,tenant_id,workspace_id,operation_id,action_execution_id,
          event_type,initiator_principal_id,actor_principal_id,action_key,action_version,component_type_key,
          target_id,parameter_hash,decision,result_code,result_exposure,evidence_refs,correlation_id)
        SELECT gen_random_uuid(),'capacity-handover:'||OLD.id||':'||OLD.run_id||':'||OLD.scheduled_event_id,
          a.tenant_id,a.workspace_id,a.operation_id,a.id,'RECONCILIATION',a.initiator_principal_id,
          a.actor_principal_id,a.action_key,a.action_version,'core',a.target_id,a.parameter_hash,
          'ALLOWED','CAPACITY_HOLDER_RECOVERED','NONE',
          jsonb_build_array(
            jsonb_build_object('kind','TEMPORAL_WORKFLOW_ID','value',OLD.workflow_id),
            jsonb_build_object('kind','TEMPORAL_RUN_ID','value',OLD.run_id::text,'version',OLD.terminal_event_id),
            jsonb_build_object('kind','TEMPORAL_RUN_ID','value',NEW.run_id::text,'version',NEW.scheduled_event_id)),
          a.correlation_id
        FROM catalog.agent_invocation i JOIN admission.action_execution a ON a.id=i.action_execution_id
        WHERE i.id=OLD.invocation_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
