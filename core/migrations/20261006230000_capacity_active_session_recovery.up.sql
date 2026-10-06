-- DD-48/65, 03 §8: a born Session is not a dispatched turn. Keep the same lease,
-- native thread and units; the existing holder guard still requires the exact
-- old Activity terminal and new Activity/generation evidence before handover.
CREATE OR REPLACE FUNCTION admission.capacity_invocation_unstarted(invocation uuid) RETURNS boolean AS $$
BEGIN
    -- Both birth and CREATED -> DISPATCHING use these Invocation/Session locks.
    -- The old holder cannot pass its frozen run/activity/attempt check after
    -- handover. UNKNOWN or any durable dispatch evidence is never reopened.
    PERFORM 1 FROM catalog.agent_invocation i
    JOIN catalog.agent_session s ON s.tenant_id=i.tenant_id AND s.workspace_id=i.workspace_id
      AND s.root_event_id=i.root_event_id AND s.installation_resource_id=i.installation_resource_id
      AND s.agent_version_asset_id=i.agent_version_asset_id AND s.projection_generation=i.projection_generation
    JOIN admission.action_execution a ON a.id=i.action_execution_id
      AND a.tenant_id=i.tenant_id AND a.workspace_id=i.workspace_id
    WHERE i.id=invocation AND i.status='CREATED' AND NOT i.cancel_pending
      AND i.runtime_turn_id IS NULL AND i.native_status IS NULL AND i.reply_event_id IS NULL
      AND i.post_message_intent IS NULL AND a.gate_state='ALLOWED'
      AND ((s.status='PENDING' AND s.runtime_thread_id IS NULL)
        OR (s.status='ACTIVE' AND s.runtime_thread_id IS NOT NULL))
      AND NOT EXISTS(SELECT 1 FROM projection.agent_model_trace t WHERE t.invocation_id=i.id)
      AND NOT EXISTS(SELECT 1 FROM outbox.usage_event u WHERE u.invocation_id=i.id OR u.operation_id=a.operation_id)
    FOR UPDATE OF i,s;
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;
