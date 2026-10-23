-- 回滚恢复旧函数体。旧版本按 'RESULT' 回读，看不见本版本写下的 OUTCOME 终态：
-- 一旦已有本版本写入的 PROTOCOL_PEER 结果或一致性探测结果，回滚会把已终结的
-- 调用重新当成未决，因此停止回滚（改为前滚修复）。
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM audit.audit_event
      WHERE event_type = 'OUTCOME'
        AND (event_key LIKE '%:protocol-result' OR event_key LIKE '%:mcp-probe:%:result')) THEN
    RAISE EXCEPTION 'protocol peer OUTCOME events exist; roll forward instead of downgrading';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION catalog.guard_protocol_peer_drain() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = 'DISABLED' AND OLD.state IS DISTINCT FROM 'DISABLED' THEN
    IF EXISTS (
      SELECT 1 FROM admission.action_execution a
      JOIN catalog.component_release r ON r.id = a.component_release_id
      WHERE a.component_binding_kind = 'APPLICATION'
        AND a.component_binding_id = NEW.id AND a.dispatch_state = 'DISPATCHED'
        AND r.manifest->'executionConnector'->>'mode' = 'PROTOCOL_PEER'
        AND NOT EXISTS (
          SELECT 1 FROM audit.audit_event result
          WHERE result.event_key = a.operation_id::text||':child:'||a.id::text||':protocol-result'
            AND result.operation_id = a.operation_id AND result.tenant_id = a.tenant_id
            AND result.workspace_id IS NOT DISTINCT FROM a.workspace_id
            AND result.action_key = a.action_key AND result.action_version = a.action_version
            AND result.target_id = a.target_id AND result.parameter_hash = a.parameter_hash
            AND result.event_type = 'RESULT' AND result.result_code IN ('SUCCEEDED','FAILED')
        )
    ) THEN
      RAISE EXCEPTION 'binding has unresolved protocol peer dispatch';
    END IF;
  END IF;
  RETURN NEW;
END $$;
