DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM catalog.resource WHERE application_binding_id IS NOT NULL)
   OR EXISTS(SELECT 1 FROM catalog.tool_definition WHERE source='APPLICATION')
   OR EXISTS(SELECT 1 FROM projection.application_runtime WHERE native_gateway_route_id IS NOT NULL)
   OR EXISTS(SELECT 1 FROM admission.action_execution
      WHERE action_key IN ('application_binding.create','application_binding.disable')) THEN
   RAISE EXCEPTION 'APPLICATION projection history must not be discarded' USING ERRCODE='23514';
 END IF;
END $$;
DELETE FROM catalog.action_definition WHERE action_key IN ('application_binding.create','application_binding.disable');
ALTER TABLE projection.application_runtime DROP CONSTRAINT application_gateway_reference_complete;
ALTER TABLE projection.application_runtime DROP COLUMN native_gateway_route_id;
ALTER TABLE projection.application_runtime DROP COLUMN gateway_config_hash;
ALTER TABLE projection.application_runtime DROP COLUMN gateway_state;
ALTER TABLE catalog.tool_definition DROP CONSTRAINT tool_definition_source_contract;
ALTER TABLE catalog.tool_definition DROP COLUMN application_projection_generation;
ALTER TABLE catalog.tool_definition ADD CONSTRAINT tool_definition_name_check CHECK(name IN ('agent.memory.entry.list','agent.memory.entry.read'));
ALTER TABLE catalog.tool_definition ADD CONSTRAINT tool_definition_source_check CHECK(source='PLATFORM_NATIVE');
ALTER TABLE catalog.tool_definition ADD CONSTRAINT tool_definition_check CHECK(action_key=name);
ALTER TABLE catalog.tool_definition ADD CONSTRAINT tool_definition_capability_contract_key_check CHECK(capability_contract_key IS NULL);
ALTER TABLE catalog.tool_definition ADD CONSTRAINT tool_definition_backend_ref_check CHECK(backend_ref='CORE_STREAMABLE_MCP');
CREATE OR REPLACE FUNCTION catalog.guard_platform_tool_scope() RETURNS trigger AS $$
BEGIN
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN
   RAISE EXCEPTION 'ToolDefinition 的固定原生合同与 Resource 引用不可替换' USING ERRCODE='check_violation';
 END IF;
 IF TG_OP='UPDATE' AND OLD.status='DELETED' AND NEW IS DISTINCT FROM OLD THEN
   RAISE EXCEPTION '已删除的 ToolDefinition 不得重新激活' USING ERRCODE='check_violation';
 END IF;
 PERFORM 1 FROM catalog.resource r JOIN identity.principal owner
   ON owner.id=r.owner_principal_id AND owner.tenant_id=r.tenant_id AND owner.kind='HUMAN'
 WHERE r.id=NEW.resource_id AND r.type_key='tool.definition'
   AND r.component_type_key='core' AND r.home_workspace_id IS NULL
   AND r.application_binding_id IS NULL AND r.native_id=r.id::text
   AND ((NEW.status='PROVISIONING' AND r.state='PROVISIONING')
     OR (NEW.status='ACTIVE' AND r.state='ACTIVE')
     OR (NEW.status='DELETED' AND r.state='DELETED'));
 IF NOT FOUND THEN
   RAISE EXCEPTION 'ToolDefinition 缺同 Tenant/HUMAN owner 的原 Resource' USING ERRCODE='check_violation';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION catalog.guard_platform_tool_binding() RETURNS trigger AS $$
BEGIN
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN
   RAISE EXCEPTION 'ToolBinding immutable Installation/Version/generation cannot change' USING ERRCODE='check_violation';
 END IF;
 IF TG_OP='UPDATE' AND OLD.status='REVOKED' AND NEW IS DISTINCT FROM OLD THEN
   RAISE EXCEPTION 'Revoked ToolBinding cannot reactivate' USING ERRCODE='check_violation';
 END IF;
 PERFORM 1 FROM catalog.agent_installation i
 JOIN catalog.resource r ON r.id=i.resource_id
 JOIN catalog.agent_runtime_projection p ON p.installation_resource_id=i.resource_id
 JOIN catalog.agent_version v ON v.asset_id=p.agent_version_asset_id
 JOIN catalog.resource tool ON tool.id=NEW.tool_resource_id AND tool.tenant_id=r.tenant_id
 JOIN catalog.tool_definition t ON t.resource_id=tool.id
 JOIN admission.action_execution a ON a.id=NEW.action_execution_id
 WHERE i.resource_id=NEW.installation_resource_id AND i.workspace_id=NEW.workspace_id
   AND r.home_workspace_id=NEW.workspace_id AND p.generation=NEW.projection_generation
   AND p.agent_version_asset_id=NEW.agent_version_asset_id
   AND v.content->'declaredToolResourceIds' @> jsonb_build_array(tool.id::text)
   AND tool.type_key='tool.definition' AND t.source='PLATFORM_NATIVE'
   AND a.tenant_id=r.tenant_id AND a.workspace_id=NEW.workspace_id
   AND a.target_id=i.resource_id AND a.action_key='agent.installation.create';
 IF NOT FOUND THEN
   RAISE EXCEPTION 'ToolBinding lacks same scope governed immutable Installation' USING ERRCODE='check_violation';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER TABLE catalog.resource DROP CONSTRAINT resource_application_binding_scope;
ALTER TABLE catalog.resource DROP CONSTRAINT resource_application_native_reference_unique;
ALTER TABLE catalog.resource DROP CONSTRAINT resource_native_identity_check;
ALTER TABLE catalog.resource DROP CONSTRAINT resource_type_key_check;
ALTER TABLE catalog.resource DROP CONSTRAINT resource_home_workspace_check;
ALTER TABLE catalog.resource ADD CONSTRAINT resource_application_binding_id_check CHECK(application_binding_id IS NULL);
ALTER TABLE catalog.resource ADD CONSTRAINT resource_check CHECK(native_id=id::text);
ALTER TABLE catalog.resource ADD CONSTRAINT resource_type_key_check CHECK
 (type_key IN ('agent.definition','agent.installation','llm_route','automation','tool.definition'));
ALTER TABLE catalog.resource ADD CONSTRAINT resource_home_workspace_check CHECK
 ((type_key IN ('agent.definition','tool.definition') AND home_workspace_id IS NULL)
  OR (type_key IN ('agent.installation','automation') AND home_workspace_id IS NOT NULL) OR type_key='llm_route');
ALTER TABLE catalog.action_definition DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE catalog.action_definition ADD CONSTRAINT workflow_kind_enum CHECK (workflow_kind IN
 ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
  'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION','COMPONENT_RELEASE'));
ALTER TABLE projection.workflow_ref DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE projection.workflow_ref ADD CONSTRAINT workflow_kind_enum CHECK (kind IN
 ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
  'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION','COMPONENT_RELEASE'));
