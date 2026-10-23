-- DD-149、05 §2.15、03 §7：用户自助连接器（外部 MCP 服务器）。
-- 平台核心 ResourceType mcp.connection 与不可变 generation；工具仍是 ToolDefinition Resource，
-- 第三档来源 USER_REGISTERED_EXTERNAL 经 declaredToolResourceIds、ToolBinding、Delegation 进入
-- Agent。不新增 Workflow kind、授权权威或 meter；凭据只以 SecretRef（OpenBao）出现。

-- 1. mcp.connection：Tenant 内平台核心 ResourceType，经 tenant.delete 销毁链删除（DD-99）。
INSERT INTO catalog.resource_type_definition
 (type_key,capability_category,capability_contract_version,incremental_contracts,llm_gateway_contract,
  transfer_formats,tenant_delete_action_key,status)
VALUES ('mcp.connection',NULL,NULL,
 '[{"contract_key":"mcp.connection@v1","role":"NATIVE_INTERNAL","engine":"NATIVE","stable_key_rule":"catalog.resource.id","revision_rule":"catalog.resource.version plus immutable McpConnectionGeneration rows","delete_semantics":"mcp_connection.delete is an irreversible DELETED tombstone with credentials destroyed; Tenant frozen inventory -> SpiceDB relationship deletion -> Core DELETED tombstone","reconciliation_trigger":"governance_reconcile resumes the same ActionExecution projection intent","readiness_semantics":"Resource ACTIVE with no pending projection; FullyConsistent SpiceDB relationships match Tenant, HUMAN owner, home Workspace and visibility grants"}]',
 'NOT_USED','[]','tenant.delete','ACTIVE');

ALTER TABLE catalog.resource DROP CONSTRAINT resource_type_key_check;
ALTER TABLE catalog.resource DROP CONSTRAINT resource_home_workspace_check;
ALTER TABLE catalog.resource ADD CONSTRAINT resource_type_key_check CHECK
 (application_binding_id IS NOT NULL OR type_key IN
  ('agent.definition','agent.installation','llm_route','automation','tool.definition','skill.definition',
   'mcp.connection'));
-- 连接器与其工具的 home Workspace 只在可见范围为 WORKSPACE 时存在；原生工具仍由
-- guard_platform_tool_scope 固定为 Tenant 级。
ALTER TABLE catalog.resource ADD CONSTRAINT resource_home_workspace_check CHECK
 (application_binding_id IS NOT NULL OR
  (type_key IN ('agent.definition','skill.definition') AND home_workspace_id IS NULL) OR
  (type_key IN ('agent.installation','automation') AND home_workspace_id IS NOT NULL) OR
  type_key IN ('llm_route','tool.definition','mcp.connection'));

-- 2. McpConnection：一对一 Resource 扩展。凭据只存 SecretRef（locator/version/audience），
--    OAuth 只存授权服务器元数据与 client 标识，密钥另以 SecretRef 引用。
CREATE TABLE catalog.mcp_connection (
    resource_id uuid PRIMARY KEY REFERENCES catalog.resource(id),
    tenant_id uuid NOT NULL,
    slug text NOT NULL CHECK (slug ~ '^[a-z][a-z0-9]{0,15}(_[a-z0-9]{1,8})?$'),
    display_name text NOT NULL CHECK (btrim(display_name) <> '' AND display_name = btrim(display_name)
        AND char_length(display_name) <= 80),
    endpoint_url text NOT NULL CHECK (endpoint_url ~ '^https?://' AND char_length(endpoint_url) <= 2048),
    endpoint_host text NOT NULL CHECK (endpoint_host <> '' AND endpoint_host = lower(endpoint_host)),
    transport text NOT NULL CONSTRAINT mcp_connection_transport_enum
        CHECK (transport IN ('STREAMABLE_HTTP','SSE')),
    auth_mode text NOT NULL CONSTRAINT mcp_connection_auth_mode_enum
        CHECK (auth_mode IN ('NONE','API_KEY','BEARER','OAUTH')),
    api_key_header text CHECK (api_key_header IS NULL OR api_key_header ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
    visibility text NOT NULL CONSTRAINT mcp_connection_visibility_enum
        CHECK (visibility IN ('PERSONAL','WORKSPACE','TENANT')),
    workspace_id uuid REFERENCES identity.workspace(id),
    credential_ref jsonb CHECK (credential_ref IS NULL OR (jsonb_typeof(credential_ref) = 'object'
        AND credential_ref ?& ARRAY['locator','version','audience'])),
    credential_updated_at timestamptz,
    oauth jsonb CHECK (oauth IS NULL OR jsonb_typeof(oauth) = 'object'),
    shared_authorization_consent boolean NOT NULL DEFAULT false,
    active_generation integer NOT NULL CHECK (active_generation > 0),
    state text NOT NULL CONSTRAINT mcp_connection_state_enum
        CHECK (state IN ('ACTIVE','DISABLED','DELETED')),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_by_action_execution_id uuid NOT NULL UNIQUE REFERENCES admission.action_execution(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, resource_id) REFERENCES catalog.resource(tenant_id, id),
    CHECK ((visibility = 'WORKSPACE') = (workspace_id IS NOT NULL)),
    CHECK ((auth_mode = 'API_KEY') = (api_key_header IS NOT NULL)),
    CHECK ((auth_mode = 'OAUTH') = (oauth IS NOT NULL)),
    CHECK (auth_mode = 'NONE' OR credential_ref IS NOT NULL OR state = 'DELETED'),
    CHECK (auth_mode <> 'NONE' OR credential_ref IS NULL),
    CHECK (NOT shared_authorization_consent OR auth_mode = 'OAUTH'),
    CHECK (auth_mode <> 'OAUTH' OR visibility = 'PERSONAL' OR shared_authorization_consent)
);
CREATE UNIQUE INDEX mcp_connection_slug ON catalog.mcp_connection(tenant_id, slug) WHERE state <> 'DELETED';
CREATE FUNCTION catalog.guard_mcp_connection() RETURNS trigger AS $$
BEGIN
    PERFORM 1 FROM catalog.resource r
    JOIN identity.principal owner ON owner.id = r.owner_principal_id AND owner.tenant_id = r.tenant_id
        AND owner.kind = 'HUMAN'
    WHERE r.id = NEW.resource_id AND r.tenant_id = NEW.tenant_id AND r.type_key = 'mcp.connection'
      AND r.component_type_key = 'core' AND r.application_binding_id IS NULL
      AND r.native_type = 'mcp.connection' AND r.native_id = r.id::text
      AND r.home_workspace_id IS NOT DISTINCT FROM NEW.workspace_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'McpConnection 必须扩展同 Tenant、HUMAN owner、home Workspace 与可见范围一致的 mcp.connection Resource'
            USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.resource_id IS DISTINCT FROM OLD.resource_id
        OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.slug IS DISTINCT FROM OLD.slug
        OR NEW.endpoint_url IS DISTINCT FROM OLD.endpoint_url OR NEW.endpoint_host IS DISTINCT FROM OLD.endpoint_host
        OR NEW.transport IS DISTINCT FROM OLD.transport OR NEW.auth_mode IS DISTINCT FROM OLD.auth_mode
        OR NEW.api_key_header IS DISTINCT FROM OLD.api_key_header
        OR NEW.created_by_action_execution_id IS DISTINCT FROM OLD.created_by_action_execution_id
        OR NEW.active_generation < OLD.active_generation
        OR (OLD.state = 'DELETED' AND NEW IS DISTINCT FROM OLD)
        OR NEW.version <> OLD.version + 1) THEN
        RAISE EXCEPTION 'McpConnection 的端点、认证方式与标识不可改写，generation 只前进，DELETED 不可逆'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER mcp_connection_guard BEFORE INSERT OR UPDATE ON catalog.mcp_connection
    FOR EACH ROW EXECUTE FUNCTION catalog.guard_mcp_connection();

-- 3. McpConnectionGeneration：每次确认清单的不可变快照。
CREATE TABLE catalog.mcp_connection_generation (
    resource_id uuid NOT NULL REFERENCES catalog.mcp_connection(resource_id),
    generation integer NOT NULL CHECK (generation > 0),
    server_info jsonb NOT NULL CHECK (jsonb_typeof(server_info) = 'object'),
    tools_digest text NOT NULL CHECK (tools_digest ~ '^[0-9a-f]{64}$'),
    tools jsonb NOT NULL CHECK (jsonb_typeof(tools) = 'array' AND jsonb_array_length(tools) <= 64),
    action_execution_id uuid NOT NULL UNIQUE REFERENCES admission.action_execution(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (resource_id, generation)
);
CREATE FUNCTION catalog.guard_mcp_connection_generation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'McpConnectionGeneration 不可变' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER mcp_connection_generation_immutable BEFORE UPDATE ON catalog.mcp_connection_generation
    FOR EACH ROW EXECUTE FUNCTION catalog.guard_mcp_connection_generation();
ALTER TABLE catalog.mcp_connection ADD CONSTRAINT mcp_connection_active_generation
    FOREIGN KEY (resource_id, active_generation) REFERENCES catalog.mcp_connection_generation(resource_id, generation)
    DEFERRABLE INITIALLY DEFERRED;

-- 4. Tenant 连接器策略；缺行即 DISABLED 与空白名单（只受部署上限约束）。
CREATE TABLE catalog.mcp_connection_policy (
    tenant_id uuid PRIMARY KEY REFERENCES identity.tenant(id),
    member_registration text NOT NULL CONSTRAINT mcp_member_registration_enum
        CHECK (member_registration IN ('DISABLED','PERSONAL_ONLY')),
    egress_host_suffixes text[] NOT NULL CHECK (array_position(egress_host_suffixes, NULL) IS NULL
        AND cardinality(egress_host_suffixes) <= 64),
    version integer NOT NULL CHECK (version > 0),
    action_execution_id uuid NOT NULL REFERENCES admission.action_execution(id),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- 5. 健康是探测观测，不是授权或状态权威（DD-149(10)）。
CREATE TABLE projection.mcp_connection_health (
    resource_id uuid PRIMARY KEY REFERENCES catalog.mcp_connection(resource_id),
    health text NOT NULL CONSTRAINT mcp_connection_health_enum
        CHECK (health IN ('UNCHECKED','OK','UNREACHABLE','AUTH_FAILED','REAUTHORIZATION_REQUIRED',
                          'PROTOCOL_ERROR','EGRESS_DENIED')),
    checked_at timestamptz NOT NULL,
    observed_tools_digest text CHECK (observed_tools_digest IS NULL OR observed_tools_digest ~ '^[0-9a-f]{64}$'),
    server_name text,
    server_version text
);

-- 6. OAuth 授权尝试：state 只存摘要；PKCE verifier 只在完成或过期前存在；令牌只在 OpenBao。
CREATE TABLE admission.mcp_oauth_attempt (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES identity.tenant(id),
    session_id uuid NOT NULL REFERENCES identity.platform_session(id),
    principal_id uuid NOT NULL REFERENCES identity.principal(id),
    endpoint_url text NOT NULL,
    transport text NOT NULL CONSTRAINT mcp_connection_transport_enum
        CHECK (transport IN ('STREAMABLE_HTTP','SSE')),
    for_connection_id uuid REFERENCES catalog.mcp_connection(resource_id),
    server jsonb NOT NULL CHECK (jsonb_typeof(server) = 'object'),
    client jsonb NOT NULL CHECK (jsonb_typeof(client) = 'object'),
    state_digest text NOT NULL UNIQUE CHECK (state_digest ~ '^[0-9a-f]{64}$'),
    pkce_verifier text,
    redirect_uri text NOT NULL,
    state text NOT NULL CONSTRAINT mcp_oauth_attempt_state_enum
        CHECK (state IN ('PENDING','COMPLETED','FAILED','EXPIRED','CONSUMED')),
    credential_ref jsonb CHECK (credential_ref IS NULL OR (jsonb_typeof(credential_ref) = 'object'
        AND credential_ref ?& ARRAY['locator','version','audience'])),
    failure text,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    consumed_by_action_execution_id uuid UNIQUE REFERENCES admission.action_execution(id),
    CHECK ((state = 'PENDING') = (pkce_verifier IS NOT NULL)),
    CHECK (state NOT IN ('COMPLETED','CONSUMED') OR credential_ref IS NOT NULL),
    CHECK ((state = 'CONSUMED') = (consumed_by_action_execution_id IS NOT NULL))
);
CREATE INDEX mcp_oauth_attempt_open ON admission.mcp_oauth_attempt(expires_at) WHERE state = 'PENDING';

-- 7. 中继调用记录：子 ActionExecution 的派发与结果摘要；PEP 以摘要核对披露的结果。
CREATE TABLE admission.mcp_tool_call (
    action_execution_id uuid PRIMARY KEY REFERENCES admission.action_execution(id),
    tenant_id uuid NOT NULL REFERENCES identity.tenant(id),
    connection_id uuid NOT NULL REFERENCES catalog.mcp_connection(resource_id),
    generation integer NOT NULL,
    tool_resource_id uuid NOT NULL,
    upstream_name text NOT NULL,
    state text NOT NULL CHECK (state IN ('DISPATCHED','SUCCEEDED','FAILED','UNKNOWN')),
    result_digest text CHECK (result_digest IS NULL OR result_digest ~ '^[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    FOREIGN KEY (connection_id, generation) REFERENCES catalog.mcp_connection_generation(resource_id, generation),
    CHECK ((state = 'SUCCEEDED' OR state = 'FAILED') = (result_digest IS NOT NULL))
);

-- 8. ToolDefinition 第三档来源：冻结所属连接器、上游名、风险、首次启用的 generation 与 schema。
ALTER TABLE catalog.tool_definition
    ADD COLUMN mcp_connection_id uuid REFERENCES catalog.mcp_connection(resource_id),
    ADD COLUMN upstream_name text,
    ADD COLUMN risk text CONSTRAINT mcp_tool_risk_enum CHECK (risk IS NULL OR risk IN ('READ_ONLY','WRITE','DESTRUCTIVE')),
    ADD COLUMN risk_declared boolean,
    ADD COLUMN first_generation integer,
    ADD COLUMN title text,
    ADD COLUMN description text,
    ADD COLUMN input_schema jsonb,
    ADD COLUMN output_schema jsonb,
    ADD COLUMN annotations jsonb;
ALTER TABLE catalog.tool_definition DROP CONSTRAINT tool_definition_source_contract;
ALTER TABLE catalog.tool_definition ADD CONSTRAINT tool_definition_source_contract CHECK
 ((source='PLATFORM_NATIVE'
   AND ((name IN ('agent.memory.entry.list','agent.memory.entry.read') AND action_key=name)
     OR (name='project_channel_request' AND action_key='workspace.create'))
   AND capability_contract_key IS NULL AND backend_ref='CORE_STREAMABLE_MCP'
   AND application_projection_generation IS NULL) OR
  (source='APPLICATION' AND name<>'' AND action_key=capability_contract_key
   AND backend_ref<>'' AND application_projection_generation>0) OR
  (source='USER_REGISTERED_EXTERNAL'
   AND name ~ '^[a-z][a-z0-9]{0,15}(_[a-z0-9]{1,8})?__[A-Za-z0-9_.-]{1,128}$'
   AND action_key IN ('mcp_connection.tool.invoke','mcp_connection.tool.invoke_confirmed',
                      'mcp_connection.tool.invoke_approved')
   AND (action_key<>'mcp_connection.tool.invoke' OR risk='READ_ONLY')
   AND capability_contract_key IS NULL AND backend_ref='CORE_EXTERNAL_MCP_RELAY'
   AND application_projection_generation IS NULL AND mcp_connection_id IS NOT NULL
   AND upstream_name IS NOT NULL AND risk IS NOT NULL AND risk_declared IS NOT NULL
   AND first_generation>0 AND jsonb_typeof(input_schema)='object'
   AND (annotations IS NULL OR jsonb_typeof(annotations)='object')));
ALTER TABLE catalog.tool_definition ADD CONSTRAINT tool_definition_connector_fields CHECK
 (source='USER_REGISTERED_EXTERNAL' OR (mcp_connection_id IS NULL AND upstream_name IS NULL AND risk IS NULL
  AND risk_declared IS NULL AND first_generation IS NULL AND title IS NULL AND description IS NULL
  AND input_schema IS NULL AND output_schema IS NULL AND annotations IS NULL));

-- 第三档的 Resource：同 Tenant、与所属连接器同 owner 与 home Workspace；其余两档不变。
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
     OR (NEW.source='USER_REGISTERED_EXTERNAL' AND r.component_type_key='core'
       AND r.application_binding_id IS NULL AND r.native_type='tool.definition' AND r.native_id=r.id::text
       AND EXISTS (SELECT 1 FROM catalog.mcp_connection c JOIN catalog.resource cr ON cr.id=c.resource_id
         WHERE c.resource_id=NEW.mcp_connection_id AND c.tenant_id=r.tenant_id
           AND cr.owner_principal_id=r.owner_principal_id
           AND cr.home_workspace_id IS NOT DISTINCT FROM r.home_workspace_id
           AND (NEW.status='DELETED' OR c.state<>'DELETED')))
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

-- ToolBinding：第三档与平台原生工具同样只经 declaredToolResourceIds 选用；WORKSPACE
-- 范围的工具只能绑定到同一 Workspace 的 Installation。其余分支与 20261019230000 相同。
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
   AND ((t.source IN ('PLATFORM_NATIVE','USER_REGISTERED_EXTERNAL')
       AND v.content->'declaredToolResourceIds' @> jsonb_build_array(tool.id::text)
       AND (tool.home_workspace_id IS NULL OR tool.home_workspace_id=NEW.workspace_id)
       AND a.workspace_id=NEW.workspace_id AND a.target_id=i.resource_id
       AND a.action_key IN ('agent.installation.create','agent.installation.upgrade','agent.installation.enable'))
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
         AND ((a.action_key IN ('agent.installation.create','agent.installation.upgrade','agent.installation.enable') AND a.target_id=i.resource_id AND a.workspace_id=NEW.workspace_id)
           OR (a.action_key='application_binding.create' AND a.target_id=b.id
             AND a.workspace_id IS NOT DISTINCT FROM b.workspace_id)))));
 IF NOT FOUND THEN
   RAISE EXCEPTION 'ToolBinding lacks same scope governed immutable Installation' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 9. 工具调用子动作：Agent 回合根动作的子动作，发起者与执行者继承根动作，目标为该
--    Installation（与平台原生工具同形）；同一 Installation 可同时有多条待审批的工具调用，
--    因此“同一目标只有一条待决动作”的索引不约束这三个子动作键。
CREATE OR REPLACE FUNCTION admission.guard_action_execution_family() RETURNS trigger AS $$
DECLARE parent admission.action_execution%ROWTYPE;
BEGIN
    IF TG_OP='UPDATE' AND OLD.parent_action_execution_id IS NOT NULL AND OLD.action_key='automation.run'
        AND (NEW.parameters IS DISTINCT FROM OLD.parameters
          OR NEW.approval_workflow_id IS DISTINCT FROM OLD.approval_workflow_id
          OR NEW.approval_expires_at IS DISTINCT FROM OLD.approval_expires_at) THEN
        RAISE EXCEPTION 'Automation approval child input cannot change' USING ERRCODE='23514';
    END IF;
    IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id
        OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
        OR NEW.parent_action_execution_id IS DISTINCT FROM OLD.parent_action_execution_id) THEN
        RAISE EXCEPTION 'ActionExecution 不得替换身份、Operation 或 parent' USING ERRCODE='23514';
    END IF;
    IF TG_OP='UPDATE' AND (OLD.parent_action_execution_id IS NOT NULL
        OR EXISTS(SELECT 1 FROM admission.action_execution c WHERE c.parent_action_execution_id=OLD.id)) AND (
        NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
        OR NEW.initiator_principal_id IS DISTINCT FROM OLD.initiator_principal_id
        OR NEW.actor_principal_id IS DISTINCT FROM OLD.actor_principal_id
        OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
        OR NEW.action_key IS DISTINCT FROM OLD.action_key OR NEW.action_version IS DISTINCT FROM OLD.action_version
        OR NEW.target_id IS DISTINCT FROM OLD.target_id OR NEW.parameter_hash IS DISTINCT FROM OLD.parameter_hash) THEN
        RAISE EXCEPTION 'ActionExecution family 的冻结 scope 与动作不可替换' USING ERRCODE='23514';
    END IF;
    IF NEW.parent_action_execution_id IS NULL OR TG_OP='UPDATE' THEN RETURN NEW; END IF;
    SELECT * INTO parent FROM admission.action_execution WHERE id=NEW.parent_action_execution_id FOR UPDATE;
    IF NEW.parameters->>'componentActionKind'='SERVICE_READ_RECEIVER' THEN
        IF parent.id IS NULL OR parent.parent_action_execution_id IS NOT NULL
          OR parent.parameters->>'componentActionKind' IS DISTINCT FROM 'SERVICE_READ'
          OR parent.parameters->>'receiverActionExecutionId' IS DISTINCT FROM NEW.id::text
          OR NEW.id=parent.id OR NEW.operation_id IS DISTINCT FROM parent.operation_id
          OR NEW.tenant_id IS DISTINCT FROM parent.tenant_id OR NEW.workspace_id IS DISTINCT FROM parent.workspace_id
          OR NEW.correlation_id IS DISTINCT FROM parent.correlation_id
          OR NEW.initiator_principal_id IS DISTINCT FROM parent.initiator_principal_id
          OR NEW.actor_principal_id IS DISTINCT FROM parent.actor_principal_id
          OR NEW.actor_principal_id IS DISTINCT FROM NEW.initiator_principal_id
          OR NEW.component_binding_kind IS DISTINCT FROM 'APPLICATION'
          OR NEW.component_binding_id::text IS DISTINCT FROM parent.parameters->>'receiverBindingId'
          OR NEW.component_projection_generation::text IS DISTINCT FROM parent.parameters->>'receiverGeneration'
          OR parent.gate_state<>'ALLOWED' OR parent.dispatch_state<>'DISPATCHED'
          OR NEW.temporal_workflow_id IS NOT NULL OR NEW.approval_workflow_id IS NOT NULL
          OR NEW.idempotency_key IS NOT NULL THEN
            RAISE EXCEPTION 'Native receiver child must inherit its exact admitted read root' USING ERRCODE='23514';
        END IF;
        UPDATE admission.action_execution SET id=id WHERE id=parent.id;
        RETURN NEW;
    END IF;
    IF NEW.action_key='workspace.create' AND NEW.parameters ? 'projectChannelRequest' THEN
        PERFORM 1 FROM catalog.agent_invocation i
        JOIN catalog.agent_installation installed ON installed.resource_id=i.installation_resource_id
            AND installed.agent_principal_id=NEW.actor_principal_id AND installed.workspace_id=i.workspace_id
        JOIN catalog.resource installation ON installation.id=installed.resource_id
            AND installation.tenant_id=NEW.tenant_id AND installation.owner_principal_id=NEW.initiator_principal_id
        JOIN catalog.channel_agent_binding cb ON cb.installation_resource_id=installed.resource_id
            AND cb.workspace_id=i.workspace_id AND cb.status='ACTIVE'
        JOIN identity.principal human ON human.id=NEW.initiator_principal_id
            AND human.tenant_id=NEW.tenant_id AND human.kind='HUMAN' AND human.status='ACTIVE'
        JOIN identity.principal agent ON agent.id=NEW.actor_principal_id
            AND agent.tenant_id=NEW.tenant_id AND agent.kind='AGENT' AND agent.status='ACTIVE'
        WHERE parent.id IS NOT NULL AND parent.parent_action_execution_id IS NULL
          AND parent.action_key='agent.invoke' AND NEW.id<>parent.id
          AND NEW.operation_id=parent.operation_id AND NEW.tenant_id=parent.tenant_id
          AND NEW.correlation_id=parent.correlation_id AND NEW.actor_principal_id=parent.actor_principal_id
          AND NEW.temporal_workflow_id IS NULL
          AND i.action_execution_id=parent.id AND i.tenant_id=NEW.tenant_id
          AND i.workspace_id IS NOT DISTINCT FROM parent.workspace_id
          AND NEW.parameters->'projectChannelRequest'->>'installationResourceId'=installed.resource_id::text
          AND NEW.parameters->'projectChannelRequest'->>'ownerPrincipalId'=NEW.initiator_principal_id::text
          AND NEW.parameters->'projectChannelRequest'->>'invocationId'=i.id::text
          AND NEW.parameters->'projectChannelRequest'->'request'->>'homeChannelId'=i.workspace_id::text;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Project channel proposal lacks its exact Agent turn, Installation and owner' USING ERRCODE='23514';
        END IF;
        UPDATE admission.action_execution SET id=id WHERE id=parent.id;
        RETURN NEW;
    END IF;
    -- DD-149: a connector tool call inherits the complete root turn context, targets the
    -- Installation and names a bound, ACTIVE USER_REGISTERED_EXTERNAL tool of that exact
    -- generation whose frozen call policy is this action key.
    IF NEW.action_key IN ('mcp_connection.tool.invoke','mcp_connection.tool.invoke_confirmed',
                          'mcp_connection.tool.invoke_approved') THEN
        PERFORM 1 FROM catalog.agent_invocation i
        JOIN catalog.agent_installation installed ON installed.resource_id=i.installation_resource_id
            AND installed.agent_principal_id=NEW.actor_principal_id AND installed.workspace_id=i.workspace_id
        JOIN catalog.tool_binding tool_binding ON tool_binding.installation_resource_id=installed.resource_id
            AND tool_binding.projection_generation=i.projection_generation
            AND tool_binding.agent_version_asset_id=i.agent_version_asset_id AND tool_binding.workspace_id=i.workspace_id
            AND tool_binding.status IN ('NO_PERMISSION','ACTIVE')
        JOIN catalog.tool_definition tool ON tool.resource_id=tool_binding.tool_resource_id
            AND tool.source='USER_REGISTERED_EXTERNAL' AND tool.status='ACTIVE' AND tool.action_key=NEW.action_key
        JOIN catalog.mcp_connection connection ON connection.resource_id=tool.mcp_connection_id
            AND connection.tenant_id=NEW.tenant_id AND connection.state='ACTIVE'
        JOIN identity.principal human ON human.id=NEW.initiator_principal_id
            AND human.tenant_id=NEW.tenant_id AND human.kind='HUMAN' AND human.status='ACTIVE'
        JOIN identity.principal agent ON agent.id=NEW.actor_principal_id
            AND agent.tenant_id=NEW.tenant_id AND agent.kind='AGENT' AND agent.status='ACTIVE'
        WHERE parent.id IS NOT NULL AND parent.parent_action_execution_id IS NULL
          AND parent.action_key IN ('agent.invoke','automation.run') AND NEW.id<>parent.id
          AND parent.gate_state='ALLOWED' AND parent.dispatch_state='DISPATCHED'
          AND NEW.operation_id=parent.operation_id AND NEW.tenant_id=parent.tenant_id
          AND NEW.workspace_id IS NOT DISTINCT FROM parent.workspace_id
          AND NEW.correlation_id=parent.correlation_id
          AND NEW.initiator_principal_id=parent.initiator_principal_id
          AND NEW.actor_principal_id=parent.actor_principal_id
          AND NEW.component_binding_kind IS NULL AND NEW.temporal_workflow_id IS NULL
          AND i.action_execution_id=parent.id AND i.tenant_id=NEW.tenant_id
          AND i.workspace_id=NEW.workspace_id AND i.installation_resource_id=NEW.target_id
          AND NEW.parameters->>'toolResourceId'=tool.resource_id::text
          AND NEW.parameters->>'invocationId'=i.id::text
          AND NEW.parameters->>'mcpConnectionId'=connection.resource_id::text
          AND (NEW.parameters->>'mcpConnectionGeneration')::integer=connection.active_generation
          AND i.status IN ('DISPATCHING','RUNNING') AND NOT i.cancel_pending;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Connector tool call lacks its exact Agent turn, bound tool and ACTIVE connector' USING ERRCODE='23514';
        END IF;
        UPDATE admission.action_execution SET id=id WHERE id=parent.id;
        RETURN NEW;
    END IF;
    IF NOT FOUND OR parent.parent_action_execution_id IS NOT NULL
        OR parent.action_key NOT IN ('agent.invoke','automation.run') OR NEW.id=parent.id
        OR NEW.operation_id IS DISTINCT FROM parent.operation_id OR NEW.tenant_id IS DISTINCT FROM parent.tenant_id
        OR NEW.workspace_id IS DISTINCT FROM parent.workspace_id OR NEW.correlation_id IS DISTINCT FROM parent.correlation_id
        OR NEW.initiator_principal_id IS DISTINCT FROM parent.initiator_principal_id
        OR NEW.actor_principal_id IS DISTINCT FROM parent.actor_principal_id
        OR (NEW.action_key NOT IN ('agent.memory.entry.list','agent.memory.entry.read','automation.run')
            AND NEW.component_binding_kind IS DISTINCT FROM 'APPLICATION') THEN
        RAISE EXCEPTION 'Child must inherit the complete root ActionExecution context' USING ERRCODE='23514';
    END IF;
    IF NEW.component_binding_kind='APPLICATION' THEN
        PERFORM 1 FROM catalog.agent_invocation i
        JOIN catalog.agent_installation installed ON installed.resource_id=i.installation_resource_id
            AND installed.agent_principal_id=NEW.actor_principal_id AND installed.workspace_id=i.workspace_id
            AND catalog.agent_generation_admitted(installed.resource_id,i.agent_version_asset_id,i.projection_generation)
        JOIN catalog.agent_runtime_projection agent_runtime ON agent_runtime.installation_resource_id=installed.resource_id
            AND agent_runtime.generation=i.projection_generation AND agent_runtime.agent_version_asset_id=i.agent_version_asset_id
            AND agent_runtime.state='ACTIVE'
        JOIN identity.principal human ON human.id=NEW.initiator_principal_id
            AND human.tenant_id=NEW.tenant_id AND human.kind='HUMAN' AND human.status='ACTIVE'
        JOIN identity.principal agent ON agent.id=NEW.actor_principal_id
            AND agent.tenant_id=NEW.tenant_id AND agent.kind='AGENT' AND agent.status='ACTIVE'
        JOIN catalog.tool_binding tool_binding ON tool_binding.installation_resource_id=installed.resource_id
            AND tool_binding.projection_generation=i.projection_generation
            AND tool_binding.agent_version_asset_id=i.agent_version_asset_id AND tool_binding.workspace_id=i.workspace_id
            AND tool_binding.status IN ('NO_PERMISSION','ACTIVE')
        JOIN catalog.tool_definition tool ON tool.resource_id=tool_binding.tool_resource_id
            AND tool.source='APPLICATION' AND tool.status='ACTIVE' AND tool.action_key=NEW.action_key
            AND tool.application_projection_generation=NEW.component_projection_generation
        JOIN catalog.resource tool_resource ON tool_resource.id=tool.resource_id AND tool_resource.tenant_id=NEW.tenant_id
            AND tool_resource.application_binding_id=NEW.component_binding_id AND tool_resource.state='ACTIVE'
        JOIN catalog.action_definition definition ON definition.id=NEW.action_definition_id
            AND definition.action_key=NEW.action_key AND definition.version=NEW.action_version
            AND definition.component_release_id=NEW.component_release_id
        WHERE i.action_execution_id=parent.id AND i.tenant_id=NEW.tenant_id AND i.workspace_id=NEW.workspace_id
            AND parent.gate_state='ALLOWED' AND parent.dispatch_state='DISPATCHED'
            AND i.status IN ('DISPATCHING','RUNNING','UNKNOWN') AND NOT i.cancel_pending;
    ELSIF NEW.action_key='automation.run' THEN
        PERFORM 1 FROM catalog.agent_invocation i
        JOIN catalog.automation_version v ON v.asset_id=i.automation_version_asset_id
            AND v.automation_resource_id=i.automation_resource_id
        WHERE i.action_execution_id=parent.id AND parent.action_key='automation.run'
          AND i.tenant_id=NEW.tenant_id AND i.workspace_id=NEW.workspace_id
          AND i.automation_resource_id=NEW.target_id AND NEW.target_id=parent.target_id
          AND NEW.action_version=parent.action_version AND NEW.parameter_hash=parent.parameter_hash
          AND i.status='CREATED' AND i.runtime_turn_id IS NULL AND i.reply_event_id IS NULL
          AND NEW.approval_workflow_id IS NOT NULL AND NEW.temporal_workflow_id IS NULL
          AND NEW.parameters->'automationStepApproval'->>'invocationId'=i.id::text
          AND NEW.parameters->'automationStepApproval'->>'policyId'=v.approval_policy_id::text
          AND NEW.parameters->'automationStepApproval'->>'policyVersion'=v.approval_policy_version::text;
    ELSE
        PERFORM 1 FROM catalog.agent_invocation i
        JOIN catalog.agent_installation installed ON installed.resource_id=i.installation_resource_id
            AND installed.agent_principal_id=NEW.actor_principal_id AND installed.workspace_id=i.workspace_id
        JOIN identity.principal human ON human.id=NEW.initiator_principal_id
            AND human.tenant_id=NEW.tenant_id AND human.kind='HUMAN'
        JOIN identity.principal agent ON agent.id=NEW.actor_principal_id
            AND agent.tenant_id=NEW.tenant_id AND agent.kind='AGENT'
        WHERE i.action_execution_id=parent.id AND i.tenant_id=NEW.tenant_id
            AND i.workspace_id IS NOT DISTINCT FROM NEW.workspace_id AND i.installation_resource_id=NEW.target_id;
    END IF;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Child lacks its exact frozen Invocation and implemented consumer' USING ERRCODE='23514';
    END IF;
    UPDATE admission.action_execution SET id=id WHERE id=parent.id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP INDEX admission.action_execution_one_pending_per_target;
CREATE UNIQUE INDEX action_execution_one_pending_per_target
    ON admission.action_execution (target_id)
    WHERE gate_state IN ('EVALUATING', 'WAITING')
      AND action_key NOT IN ('mcp_connection.tool.invoke','mcp_connection.tool.invoke_confirmed',
                             'mcp_connection.tool.invoke_approved');

-- 10. 05 §2.15 的唯一 ActionDefinition 策略。管理动作：TENANT_ONLY、SYNC、EXPLICIT、无审批、
--     quota NONE、meters 空、ResultExposure NONE、FULL_LIFECYCLE。
INSERT INTO catalog.action_definition
 (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
 permission,permission_object_type,execution_mode,confirmation_mode,approval_policy_id,approval_policy_version,
 workflow_type,workflow_kind,capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,
 obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,obs_cost_source,obs_redaction_policy,status)
SELECT k.action_key,1,'core',k.target_type,'SESSION_TENANT','TENANT_ONLY',k.permission,k.object_type,'SYNC',
 'EXPLICIT',NULL,NULL,NULL,NULL,'NONE',NULL,'NONE','{}','NONE','FULL_LIFECYCLE',
 'OPERATION_REF','NONE','SYNC_RESULT','NONE','NONE','PLATFORM_METADATA_ONLY','ACTIVE'
FROM (VALUES ('mcp_connection.create','RESOURCE','discover','tenant'),
             ('mcp_connection.update','RESOURCE','manage','resource'),
             ('mcp_connection.rotate_credential','RESOURCE','manage','resource'),
             ('mcp_connection.disable','RESOURCE','manage','resource'),
             ('mcp_connection.enable','RESOURCE','manage','resource'),
             ('mcp_connection.delete','RESOURCE','manage','resource'),
             ('mcp_connection.policy.update','TENANT','manage','tenant'))
     k(action_key,target_type,permission,object_type);

-- 工具调用子动作：每次确认由 Installation owner 批准（自批允许），需要审批由 Tenant 管理员批准。
INSERT INTO catalog.approval_policy
 (id,version,action_key,target_type,role_requirements,owner_requirement,self_approval,expires_in_seconds,status)
VALUES
 ('4d2b7c1e-9a35-4e60-8f14-2c6b9e0d1a01',1,'mcp_connection.tool.invoke_confirmed','RESOURCE',
  '[]','TARGET_OWNER','ALLOW',3600,'ACTIVE'),
 ('4d2b7c1e-9a35-4e60-8f14-2c6b9e0d1a02',1,'mcp_connection.tool.invoke_approved','RESOURCE',
  '[{"selector":"TENANT_ADMIN","minDistinct":1}]','NONE','ALLOW',3600,'ACTIVE');
INSERT INTO catalog.action_definition
 (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
 permission,permission_object_type,execution_mode,confirmation_mode,approval_policy_id,approval_policy_version,
 workflow_type,workflow_kind,capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,
 obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,obs_cost_source,obs_redaction_policy,status)
SELECT k.action_key,1,'core','RESOURCE','SESSION_TENANT','WORKSPACE_REQUIRED','read','resource','SYNC',
 k.confirmation,k.policy,CASE WHEN k.policy IS NULL THEN NULL ELSE 1 END,NULL,NULL,'NONE',NULL,'NONE','{}','READ',
 'FULL_LIFECYCLE','OPERATION_REF','NONE','SYNC_RESULT','NONE','NONE','PLATFORM_METADATA_ONLY','ACTIVE'
FROM (VALUES ('mcp_connection.tool.invoke','NONE',NULL::uuid),
             ('mcp_connection.tool.invoke_confirmed','APPROVAL','4d2b7c1e-9a35-4e60-8f14-2c6b9e0d1a01'::uuid),
             ('mcp_connection.tool.invoke_approved','APPROVAL','4d2b7c1e-9a35-4e60-8f14-2c6b9e0d1a02'::uuid))
     k(action_key,confirmation,policy);
