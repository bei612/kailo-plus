-- DD-24/92/105: controlled Installation child configuration, not permission.
CREATE TABLE catalog.tool_binding (
 installation_resource_id uuid NOT NULL REFERENCES catalog.agent_installation(resource_id),
 projection_generation bigint NOT NULL CHECK(projection_generation>0),
 workspace_id uuid NOT NULL REFERENCES identity.workspace(id),
 agent_version_asset_id uuid NOT NULL REFERENCES catalog.agent_version(asset_id),
 tool_resource_id uuid NOT NULL REFERENCES catalog.tool_definition(resource_id),
 action_execution_id uuid NOT NULL REFERENCES admission.action_execution(id),
 status text NOT NULL CHECK(status IN ('PENDING','ACTIVE','NO_PERMISSION','REVOKED')),
 PRIMARY KEY(installation_resource_id,projection_generation,tool_resource_id)
);
CREATE FUNCTION catalog.guard_platform_tool_binding() RETURNS trigger AS $$
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
CREATE TRIGGER platform_tool_binding_guard BEFORE INSERT OR UPDATE ON catalog.tool_binding
 FOR EACH ROW EXECUTE FUNCTION catalog.guard_platform_tool_binding();

-- Only the derived native delivery reference is durable. Session bearer and
-- private signing material never enter this projection or the runtime Profile.
CREATE TABLE catalog.agent_tool_gateway_projection (
 installation_resource_id uuid NOT NULL,
 projection_generation bigint NOT NULL,
 action_execution_id uuid NOT NULL REFERENCES admission.action_execution(id),
 native_route_id text NOT NULL UNIQUE,
 config_hash text NOT NULL CHECK(config_hash ~ '^[0-9a-f]{64}$'),
 state text NOT NULL CHECK(state IN ('PENDING','ACTIVE','REVOKED')),
 PRIMARY KEY(installation_resource_id,projection_generation),
 FOREIGN KEY(installation_resource_id,projection_generation)
   REFERENCES catalog.agent_runtime_projection(installation_resource_id,generation)
);
