-- Restore the narrower pre-birth recovery rule. Historical handover audits
-- and native references remain immutable; no lease is released or replayed.
CREATE OR REPLACE FUNCTION admission.capacity_invocation_unstarted(invocation uuid) RETURNS boolean AS $$
BEGIN
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
