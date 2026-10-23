-- 设计 14 §4、03 §9：同步 PROTOCOL_PEER 调用与 MCP 一致性探测的结果属于
-- DISPATCH 之后的 OUTCOME 事件；审计事件类型集合不新增 RESULT
-- （audit_event_type_enum 与 contracts/enums/audit_event_type.schema.json 不变）。
-- 旧守卫按不存在的 'RESULT' 回读，任何 PROTOCOL_PEER 已派发子动作都无法被认定
-- 已终结。这里只替换函数体，触发器与其余条件保持原样。
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
            AND result.event_type = 'OUTCOME' AND result.result_code IN ('SUCCEEDED','FAILED')
        )
    ) THEN
      RAISE EXCEPTION 'binding has unresolved protocol peer dispatch';
    END IF;
  END IF;
  RETURN NEW;
END $$;
