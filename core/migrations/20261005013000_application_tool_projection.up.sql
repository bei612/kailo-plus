-- DD-24/88/92: APPLICATION ToolDefinitions are instances of the original
-- Resource extension. No component database, process or native data is owned.
ALTER TABLE catalog.action_definition DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE catalog.action_definition ADD CONSTRAINT workflow_kind_enum CHECK (workflow_kind IN
 ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
  'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION','COMPONENT_RELEASE',
  'COMPONENT_BINDING','COMPONENT_DISABLE'));
ALTER TABLE projection.workflow_ref DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE projection.workflow_ref ADD CONSTRAINT workflow_kind_enum CHECK (kind IN
 ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
  'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION','COMPONENT_RELEASE',
  'COMPONENT_BINDING','COMPONENT_DISABLE'));
ALTER TABLE catalog.resource DROP CONSTRAINT resource_application_binding_id_check;
ALTER TABLE catalog.resource DROP CONSTRAINT resource_check;
ALTER TABLE catalog.resource DROP CONSTRAINT resource_type_key_check;
ALTER TABLE catalog.resource DROP CONSTRAINT resource_home_workspace_check;
ALTER TABLE catalog.resource ADD CONSTRAINT resource_application_binding_scope
 FOREIGN KEY(tenant_id,application_binding_id) REFERENCES catalog.application_binding(tenant_id,id);
ALTER TABLE catalog.resource ADD CONSTRAINT resource_application_native_reference_unique
 UNIQUE(application_binding_id,native_type,native_id);
ALTER TABLE catalog.resource ADD CONSTRAINT resource_native_identity_check CHECK
 ((application_binding_id IS NULL AND native_id=id::text) OR
  (application_binding_id IS NOT NULL AND native_type<>'' AND native_id<>''));
ALTER TABLE catalog.resource ADD CONSTRAINT resource_type_key_check CHECK
 (application_binding_id IS NOT NULL OR type_key IN
  ('agent.definition','agent.installation','llm_route','automation','tool.definition'));
ALTER TABLE catalog.resource ADD CONSTRAINT resource_home_workspace_check CHECK
 (application_binding_id IS NOT NULL OR
  (type_key IN ('agent.definition','tool.definition') AND home_workspace_id IS NULL) OR
  (type_key IN ('agent.installation','automation') AND home_workspace_id IS NOT NULL) OR type_key='llm_route');

ALTER TABLE catalog.tool_definition DROP CONSTRAINT tool_definition_name_check;
ALTER TABLE catalog.tool_definition DROP CONSTRAINT tool_definition_source_check;
ALTER TABLE catalog.tool_definition DROP CONSTRAINT tool_definition_check;
ALTER TABLE catalog.tool_definition DROP CONSTRAINT tool_definition_capability_contract_key_check;
ALTER TABLE catalog.tool_definition DROP CONSTRAINT tool_definition_backend_ref_check;
ALTER TABLE catalog.tool_definition ADD COLUMN application_projection_generation bigint;
ALTER TABLE catalog.tool_definition ADD CONSTRAINT tool_definition_source_contract CHECK
 ((source='PLATFORM_NATIVE' AND name IN ('agent.memory.entry.list','agent.memory.entry.read')
   AND action_key=name AND capability_contract_key IS NULL AND backend_ref='CORE_STREAMABLE_MCP'
   AND application_projection_generation IS NULL) OR
  (source='APPLICATION' AND name<>'' AND action_key=capability_contract_key
   AND backend_ref<>'' AND application_projection_generation>0));

CREATE OR REPLACE FUNCTION catalog.guard_platform_tool_scope() RETURNS trigger AS $$
BEGIN
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN
   RAISE EXCEPTION 'ToolDefinition immutable declaration changed' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND OLD.status='DELETED' AND NEW IS DISTINCT FROM OLD THEN
   RAISE EXCEPTION 'Deleted ToolDefinition cannot reactivate' USING ERRCODE='23514';
 END IF;
 PERFORM 1 FROM catalog.resource r JOIN identity.principal owner
   ON owner.id=r.owner_principal_id AND owner.tenant_id=r.tenant_id AND owner.kind='HUMAN'
 WHERE r.id=NEW.resource_id AND r.type_key='tool.definition'
   AND ((NEW.status='PROVISIONING' AND r.state='PROVISIONING')
     OR (NEW.status='ACTIVE' AND r.state='ACTIVE')
     OR (NEW.status='DELETED' AND r.state IN ('RETAINED_READ_ONLY','DELETED')))
   AND ((NEW.source='PLATFORM_NATIVE' AND r.component_type_key='core'
       AND r.home_workspace_id IS NULL AND r.application_binding_id IS NULL AND r.native_id=r.id::text)
     OR (NEW.source='APPLICATION' AND EXISTS (
       SELECT 1 FROM catalog.application_binding b JOIN projection.application_runtime p ON p.binding_id=b.id
       JOIN catalog.component_release release ON release.id=b.component_release_id
       JOIN LATERAL jsonb_array_elements(release.manifest->'toolDefinitions') declaration ON true
       WHERE b.id=r.application_binding_id AND b.tenant_id=r.tenant_id
         AND b.workspace_id IS NOT DISTINCT FROM r.home_workspace_id
         AND b.component_type_key=r.component_type_key AND p.generation=NEW.application_projection_generation
         AND p.component_release_id=release.id AND p.normalized_manifest_digest=release.manifest_digest
         AND declaration->>'name'=NEW.name AND declaration->>'source'=NEW.source
         AND declaration->>'actionKey'=NEW.action_key
         AND declaration->>'capabilityContractKey'=NEW.capability_contract_key
         AND declaration->>'inputSchemaHash'=NEW.input_schema_hash
         AND declaration->>'outputSchemaHash'=NEW.output_schema_hash
         AND declaration->>'backendRef'=NEW.backend_ref
         AND ((NEW.status='PROVISIONING' AND b.state='PROVISIONING' AND p.state='PENDING'
              AND r.projection_action_execution_id=p.action_execution_id)
           OR (NEW.status='ACTIVE' AND b.state IN ('PROVISIONING','ACTIVE') AND p.state='ACTIVE')
           OR (NEW.status='DELETED' AND b.state IN ('DISABLING','DISABLED'))))));
 IF NOT FOUND THEN
   RAISE EXCEPTION 'ToolDefinition lacks its original scoped Resource/declaration' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- A ToolBinding remains the Installation's controlled child configuration.
-- APPLICATION selection is made from the Version's category contract, never
-- by adding a provider-specific Tool Resource to declared_tool_resource_ids.
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
       AND a.action_key='agent.installation.create')
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
         AND ((a.action_key='agent.installation.create' AND a.target_id=i.resource_id AND a.workspace_id=NEW.workspace_id)
           OR (a.action_key='application_binding.create' AND a.target_id=b.id
             AND a.workspace_id IS NOT DISTINCT FROM b.workspace_id)))));
 IF NOT FOUND THEN
   RAISE EXCEPTION 'ToolBinding lacks same scope governed immutable Installation' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- No literal passing flag activates a binding: these are exact native config
-- references consumed by the existing Gateway ConfigResource delivery reader.
ALTER TABLE projection.application_runtime ADD COLUMN native_gateway_route_id text UNIQUE;
ALTER TABLE projection.application_runtime ADD COLUMN gateway_config_hash text
 CHECK(gateway_config_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE projection.application_runtime ADD COLUMN gateway_state text
 CHECK(gateway_state IN ('PENDING','ACTIVE','REVOKED'));
ALTER TABLE projection.application_runtime ADD CONSTRAINT application_gateway_reference_complete CHECK
 ((native_gateway_route_id IS NULL AND gateway_config_hash IS NULL AND gateway_state IS NULL)
   OR (native_gateway_route_id IS NOT NULL AND gateway_config_hash IS NOT NULL AND gateway_state IS NOT NULL));

INSERT INTO catalog.action_definition
 (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
  permission,permission_object_type,execution_mode,confirmation_mode,
  approval_policy_id,approval_policy_version,workflow_type,workflow_kind,
  capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,
  obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,
  obs_cost_source,obs_redaction_policy,status)
SELECT action_key,1,'core','APPLICATION_BINDING','SESSION_TENANT','DECLARED_WORKSPACE',
 'manage','tenant','TEMPORAL','EXPLICIT',NULL,NULL,'ComponentTaskWorkflow',kind,
 'NONE',NULL,'NONE','{}','NONE','FULL_LIFECYCLE','OPERATION_NATIVE_REF','TEMPORAL','NATIVE',
 'NONE','NONE','PLATFORM_METADATA_ONLY','ACTIVE'
FROM (VALUES ('application_binding.create','COMPONENT_BINDING'),
             ('application_binding.disable','COMPONENT_DISABLE')) actions(action_key,kind);
