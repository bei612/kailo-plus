-- 已有停用/启用 ActionExecution 时，它们是 Installation 投影、Tool 撤销与 roster 变化的
-- 准入证据：停止回滚，不删除定义也不恢复旧谓词。
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM admission.action_execution
             WHERE action_key IN ('agent.installation.disable','agent.installation.enable')) THEN
    RAISE EXCEPTION 'agent installation lifecycle actions exist; retain their schema';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION catalog.guard_platform_tool_binding() RETURNS trigger AS $$
BEGIN
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN
   RAISE EXCEPTION 'ToolBinding immutable Installation/Version/generation cannot change' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND OLD.status='REVOKED' AND NEW IS DISTINCT FROM OLD THEN
   RAISE EXCEPTION 'Revoked ToolBinding cannot reactivate' USING ERRCODE='23514';
 END IF;
 PERFORM 1 FROM catalog.agent_installation i JOIN catalog.resource r ON r.id=i.resource_id
 JOIN catalog.agent_runtime_projection p ON p.installation_resource_id=i.resource_id
 JOIN catalog.agent_version v ON v.asset_id=p.agent_version_asset_id
 JOIN catalog.resource tool ON tool.id=NEW.tool_resource_id AND tool.tenant_id=r.tenant_id
 JOIN catalog.tool_definition t ON t.resource_id=tool.id
 JOIN admission.action_execution a ON a.id=NEW.action_execution_id
 WHERE i.resource_id=NEW.installation_resource_id AND i.workspace_id=NEW.workspace_id
   AND r.home_workspace_id=NEW.workspace_id AND p.generation=NEW.projection_generation
   AND p.agent_version_asset_id=NEW.agent_version_asset_id AND tool.type_key='tool.definition'
   AND a.tenant_id=r.tenant_id
   AND ((t.source='PLATFORM_NATIVE'
       AND v.content->'declaredToolResourceIds' @> jsonb_build_array(tool.id::text)
       AND a.workspace_id=NEW.workspace_id AND a.target_id=i.resource_id
       AND a.action_key IN ('agent.installation.create','agent.installation.upgrade'))
     OR (t.source='APPLICATION' AND EXISTS (
       SELECT 1 FROM catalog.application_binding b JOIN projection.application_runtime runtime ON runtime.binding_id=b.id
       JOIN LATERAL jsonb_array_elements(v.content->'capabilityRequirements') requirement ON true
       JOIN LATERAL jsonb_array_elements(b.capability_categories) category ON true
       WHERE b.id=tool.application_binding_id AND b.tenant_id=r.tenant_id
         AND (b.workspace_id IS NULL OR b.workspace_id=NEW.workspace_id)
         AND runtime.generation=t.application_projection_generation
         AND requirement #>> '{}' = t.capability_contract_key
         AND EXISTS(SELECT 1 FROM catalog.capability_contract c
           JOIN LATERAL jsonb_array_elements(c.content->'operationContracts') operation ON true
           WHERE c.category_key=category->>'category' AND c.contract_version::text=category->>'version'
             AND operation->>'contractKey'=t.capability_contract_key AND operation->>'surface'='TOOL')
         AND ((NEW.status='REVOKED' AND b.state IN ('DISABLING','DISABLED'))
           OR (b.state='ACTIVE' AND runtime.state='ACTIVE'))
         AND ((a.action_key IN ('agent.installation.create','agent.installation.upgrade') AND a.target_id=i.resource_id AND a.workspace_id=NEW.workspace_id)
           OR (a.action_key='application_binding.create' AND a.target_id=b.id
             AND a.workspace_id IS NOT DISTINCT FROM b.workspace_id)))));
 IF NOT FOUND THEN
   RAISE EXCEPTION 'ToolBinding lacks same scope governed immutable Installation' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION catalog.agent_generation_admitted(installation uuid, version_id uuid, generation_id bigint)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM catalog.agent_installation i
 JOIN catalog.resource r ON r.id=i.resource_id AND r.state='ACTIVE'
 JOIN catalog.agent_runtime_projection p ON p.installation_resource_id=i.resource_id
   AND p.generation=i.active_projection_generation AND p.agent_version_asset_id=i.pinned_version_asset_id
   AND p.state='ACTIVE'
 WHERE i.resource_id=installation AND p.generation=generation_id AND p.agent_version_asset_id=version_id
   AND ((i.state='ACTIVE' AND r.projection_action_execution_id IS NULL)
     OR (i.state='DRAINING' AND EXISTS(SELECT 1 FROM admission.action_execution a
       WHERE a.id=r.projection_action_execution_id AND a.action_key='agent.installation.upgrade'
         AND a.target_id=i.resource_id AND a.tenant_id=r.tenant_id AND a.workspace_id=i.workspace_id
         AND a.gate_state='ALLOWED' AND a.dispatch_state IN ('NOT_DISPATCHED','DISPATCHED','UNKNOWN')))))
$$;

DELETE FROM catalog.action_definition
WHERE action_key IN ('agent.installation.disable','agent.installation.enable') AND version = 1;
