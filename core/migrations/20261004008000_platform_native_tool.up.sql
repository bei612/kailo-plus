-- DD-24/49/99/105: the existing Resource extension consumed by native Tool reads.
-- No Tool Resource or creation Action is seeded; creation policy is not frozen.
ALTER TABLE catalog.resource DROP CONSTRAINT resource_type_key_check;
ALTER TABLE catalog.resource DROP CONSTRAINT resource_home_workspace_check;
ALTER TABLE catalog.resource ADD CONSTRAINT resource_type_key_check CHECK
 (type_key IN ('agent.definition','agent.installation','llm_route','automation','tool.definition'));
ALTER TABLE catalog.resource ADD CONSTRAINT resource_home_workspace_check CHECK
 ((type_key IN ('agent.definition','tool.definition') AND home_workspace_id IS NULL)
  OR (type_key IN ('agent.installation','automation') AND home_workspace_id IS NOT NULL)
  OR type_key='llm_route');

INSERT INTO catalog.resource_type_definition VALUES
 ('tool.definition',NULL,NULL,
  '[{"contract_key":"tool.definition@v1","role":"NATIVE_INTERNAL","engine":"NATIVE","stable_key_rule":"catalog.resource.id","revision_rule":"catalog.resource.version and immutable Core native tool schema hashes","delete_semantics":"Tenant frozen ToolDefinition inventory and exact SpiceDB deletion before Core DELETED tombstone","reconciliation_trigger":"existing Resource lifecycle reconciliation","readiness_semantics":"same Tenant HUMAN owner and exact native Resource projection; metadata alone does not grant execution or activate Gateway projection"}]',
  'NOT_USED','[]','tenant.delete','ACTIVE');

CREATE TABLE catalog.tool_definition (
 resource_id uuid PRIMARY KEY REFERENCES catalog.resource(id),
 name text NOT NULL CHECK(name IN ('agent.memory.entry.list','agent.memory.entry.read')),
 source text NOT NULL CHECK(source='PLATFORM_NATIVE'),
 action_key text NOT NULL CHECK(action_key=name),
 capability_contract_key text CHECK(capability_contract_key IS NULL),
 input_schema_hash text NOT NULL CHECK(input_schema_hash ~ '^[0-9a-f]{64}$'),
 output_schema_hash text NOT NULL CHECK(output_schema_hash ~ '^[0-9a-f]{64}$'),
 backend_ref text NOT NULL CHECK(backend_ref='CORE_STREAMABLE_MCP'),
 status text NOT NULL CHECK(status IN ('PROVISIONING','ACTIVE','DELETED'))
);
CREATE FUNCTION catalog.guard_platform_tool_scope() RETURNS trigger AS $$
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
CREATE TRIGGER platform_tool_scope_guard BEFORE INSERT OR UPDATE ON catalog.tool_definition
 FOR EACH ROW EXECUTE FUNCTION catalog.guard_platform_tool_scope();
