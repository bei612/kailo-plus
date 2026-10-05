-- DD-88 / 03 §3–4: the existing Catalog retains logical contract keys.
-- Release is the immutable implementation discriminator, not a second registry.
ALTER TABLE identity.service_principal DROP CONSTRAINT service_principal_audience_key;
CREATE INDEX service_principal_audience ON identity.service_principal(audience);
-- Audience identifies a receiving adapter, not an incoming caller. Independent
-- binding principals/clients remain unique; authentication resolves exact azp.

ALTER TABLE catalog.action_definition
    ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN component_release_id uuid REFERENCES catalog.component_release(id),
    ADD COLUMN implementation_declaration jsonb,
    ADD COLUMN platform_action_key text GENERATED ALWAYS AS
        (CASE WHEN component_release_id IS NULL THEN action_key END) STORED,
    ADD CONSTRAINT action_definition_locator UNIQUE(id,action_key,version),
    ADD CONSTRAINT action_definition_release_locator UNIQUE(id,component_release_id),
    ADD CONSTRAINT action_definition_platform_version UNIQUE(platform_action_key,version),
    ADD CONSTRAINT action_definition_release_version UNIQUE NULLS NOT DISTINCT
        (action_key,version,component_release_id),
    ADD CONSTRAINT action_definition_release_declaration CHECK (
        (component_release_id IS NULL)=(implementation_declaration IS NULL)
        AND (implementation_declaration IS NULL OR jsonb_typeof(implementation_declaration)='object'));

-- Preserve the exact old scope reference through a technical locator. This
-- only backfills the original FK's unique definition; no policy is replaced.
ALTER TABLE admission.delegation_scope ADD COLUMN action_definition_id uuid;
ALTER TABLE admission.delegation_scope DISABLE TRIGGER delegation_scope_guard;
UPDATE admission.delegation_scope s SET action_definition_id=d.id
FROM catalog.action_definition d WHERE d.action_key=s.action_key AND d.version=s.action_version;
ALTER TABLE admission.delegation_scope ENABLE TRIGGER delegation_scope_guard;
ALTER TABLE admission.delegation_scope
    ALTER COLUMN action_definition_id SET NOT NULL,
    DROP CONSTRAINT delegation_scope_action_key_action_version_fkey,
    ADD CONSTRAINT delegation_scope_exact_definition
        FOREIGN KEY(action_definition_id,action_key,action_version)
        REFERENCES catalog.action_definition(id,action_key,version);
ALTER TABLE catalog.action_definition DROP CONSTRAINT action_definition_pkey;
ALTER TABLE catalog.action_definition ADD PRIMARY KEY(id);
DROP INDEX catalog.action_definition_one_active;
CREATE UNIQUE INDEX action_definition_one_active ON catalog.action_definition(action_key)
    WHERE status='ACTIVE' AND component_release_id IS NULL;
CREATE UNIQUE INDEX action_definition_release_active
    ON catalog.action_definition(component_release_id,action_key)
    WHERE status='ACTIVE' AND component_release_id IS NOT NULL;
ALTER TABLE catalog.action_definition DROP CONSTRAINT capacity_not_yet_enforced;
ALTER TABLE catalog.action_definition ADD CONSTRAINT capacity_not_yet_enforced CHECK (
    capacity_policy IN ('NONE','PLATFORM_SLOT')
    OR (capacity_policy='NATIVE' AND component_release_id IS NOT NULL));
ALTER TABLE catalog.action_definition DROP CONSTRAINT result_exposure_enum;
ALTER TABLE catalog.action_definition ADD CONSTRAINT result_exposure_enum CHECK (
    result_exposure IN ('NONE','READ')
    OR (component_release_id IS NOT NULL AND result_exposure IN ('CONSUME_ONLY','EXPORT')));

ALTER TABLE catalog.resource_type_definition
    ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN component_release_id uuid REFERENCES catalog.component_release(id),
    ADD COLUMN implementation_declaration jsonb,
    ADD COLUMN platform_type_key text GENERATED ALWAYS AS
        (CASE WHEN component_release_id IS NULL THEN type_key END) STORED,
    ADD CONSTRAINT resource_type_definition_locator UNIQUE(id,type_key),
    ADD CONSTRAINT resource_type_definition_platform_key UNIQUE(platform_type_key),
    ADD CONSTRAINT resource_type_definition_release_key UNIQUE NULLS NOT DISTINCT(type_key,component_release_id),
    ADD CONSTRAINT resource_type_definition_release_declaration CHECK (
        (component_release_id IS NULL)=(implementation_declaration IS NULL)
        AND (implementation_declaration IS NULL OR jsonb_typeof(implementation_declaration)='object'));
ALTER TABLE catalog.resource DROP CONSTRAINT resource_type_key_fkey;
ALTER TABLE catalog.resource_type_definition DROP CONSTRAINT resource_type_definition_pkey;
ALTER TABLE catalog.resource_type_definition ADD PRIMARY KEY(id);
ALTER TABLE catalog.resource ADD COLUMN resource_type_definition_id uuid;
UPDATE catalog.resource r SET resource_type_definition_id=d.id
FROM catalog.resource_type_definition d WHERE d.type_key=r.type_key;
ALTER TABLE catalog.resource ALTER COLUMN resource_type_definition_id SET NOT NULL;
ALTER TABLE catalog.resource ADD CONSTRAINT resource_exact_type_definition
    FOREIGN KEY(resource_type_definition_id,type_key) REFERENCES catalog.resource_type_definition(id,type_key);

-- The registered declaration must be an exact member of the original APPROVED
-- immutable release. Missing/ambiguous declarations cannot become live policy.
CREATE FUNCTION catalog.guard_application_definition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE manifest jsonb; declaration jsonb; matches integer;
BEGIN
    IF NEW.component_release_id IS NULL THEN
        IF TG_TABLE_NAME='action_definition' THEN
            IF EXISTS(SELECT 1 FROM catalog.action_definition d
                WHERE d.action_key=NEW.action_key AND d.component_release_id IS NOT NULL) THEN
                RAISE EXCEPTION 'platform action cannot replace an application contract namespace' USING ERRCODE='23514';
            END IF;
        ELSE
            IF EXISTS(SELECT 1 FROM catalog.resource_type_definition d
                WHERE d.type_key=NEW.type_key AND d.component_release_id IS NOT NULL) THEN
                RAISE EXCEPTION 'platform resource type cannot replace an application contract namespace' USING ERRCODE='23514';
            END IF;
        END IF;
        RETURN NEW;
    END IF;
    SELECT r.manifest INTO manifest FROM catalog.component_release r
      JOIN catalog.component_definition c ON c.type_key=r.component_type_key
      WHERE r.id=NEW.component_release_id AND r.status='APPROVED' AND c.class='APPLICATION';
    IF NOT FOUND THEN RAISE EXCEPTION 'definition requires approved application release' USING ERRCODE='23514'; END IF;
    IF TG_TABLE_NAME='action_definition' THEN
        SELECT count(*),jsonb_agg(value)->0 INTO matches,declaration
        FROM jsonb_array_elements(manifest->'actionDefinitions')
        WHERE value->>'actionKey'=NEW.action_key AND (value->>'version')::integer=NEW.version;
        IF matches<>1 OR declaration IS DISTINCT FROM NEW.implementation_declaration
           OR declaration->>'componentTypeKey' IS DISTINCT FROM NEW.component_type_key
           OR manifest->>'componentTypeKey' IS DISTINCT FROM NEW.component_type_key
           OR declaration->>'capabilityContractKey' IS DISTINCT FROM NEW.action_key
           OR declaration->>'targetType' IS DISTINCT FROM NEW.target_type
           OR declaration->>'tenantRule' IS DISTINCT FROM NEW.tenant_rule
           OR declaration->>'workspaceRule' IS DISTINCT FROM NEW.workspace_rule
           OR declaration->>'permission' IS DISTINCT FROM NEW.permission
           OR lower(declaration->>'targetType') IS DISTINCT FROM NEW.permission_object_type
           OR declaration->>'executionMode' IS DISTINCT FROM NEW.execution_mode
           OR declaration->>'confirmationMode' IS DISTINCT FROM NEW.confirmation_mode
           OR declaration->>'status' IS DISTINCT FROM NEW.status
           OR nullif(declaration->>'approvalPolicyId','NONE')::uuid IS DISTINCT FROM NEW.approval_policy_id
           OR declaration->>'capacityPolicy' IS DISTINCT FROM NEW.capacity_policy
           OR nullif(declaration->>'capacityPoolKey','NONE') IS DISTINCT FROM NEW.capacity_pool_key
           OR declaration->>'quotaPolicy' IS DISTINCT FROM NEW.quota_policy
           OR declaration->'meters' IS DISTINCT FROM to_jsonb(NEW.meters)
           OR declaration#>>'{resultExposurePolicy,mode}' IS DISTINCT FROM NEW.result_exposure
           OR declaration->>'auditPolicy' IS DISTINCT FROM NEW.audit_policy
           OR declaration#>>'{businessObservabilityPolicy,correlationMode}' IS DISTINCT FROM NEW.obs_correlation_mode
           OR declaration#>>'{businessObservabilityPolicy,progressSource}' IS DISTINCT FROM NEW.obs_progress_source
           OR declaration#>>'{businessObservabilityPolicy,terminalSource}' IS DISTINCT FROM NEW.obs_terminal_source
           OR declaration#>>'{businessObservabilityPolicy,usageSource}' IS DISTINCT FROM NEW.obs_usage_source
           OR declaration#>>'{businessObservabilityPolicy,costSource}' IS DISTINCT FROM NEW.obs_cost_source
           OR declaration#>>'{businessObservabilityPolicy,redactionPolicy}' IS DISTINCT FROM NEW.obs_redaction_policy
           OR NEW.workflow_type IS NOT NULL OR NEW.workflow_kind IS NOT NULL
           OR declaration->>'workflowType'<>'NONE'
           OR NEW.role_template_key IS NOT NULL OR NEW.role_template_version IS NOT NULL
           OR (NEW.approval_policy_id IS NOT NULL AND NOT EXISTS(
               SELECT 1 FROM catalog.approval_policy policy WHERE policy.id=NEW.approval_policy_id
                 AND policy.version=NEW.approval_policy_version AND policy.action_key=NEW.action_key
                 AND policy.target_type=NEW.target_type AND policy.status='ACTIVE'))
           OR EXISTS(SELECT 1 FROM catalog.action_definition d
                     WHERE d.component_release_id IS NULL AND d.action_key=NEW.action_key) THEN
            RAISE EXCEPTION 'action declaration differs from exact release or platform namespace' USING ERRCODE='23514';
        END IF;
    ELSE
        SELECT count(*),jsonb_agg(value)->0 INTO matches,declaration
        FROM jsonb_array_elements(manifest->'resourceTypeDefinitions') WHERE value->>'typeKey'=NEW.type_key;
        IF matches<>1 OR declaration IS DISTINCT FROM NEW.implementation_declaration
           OR declaration->>'capabilityCategory' IS DISTINCT FROM NEW.capability_category
           OR (declaration->>'capabilityContractVersion')::integer IS DISTINCT FROM NEW.capability_contract_version
           OR declaration->'incrementalContracts' IS DISTINCT FROM NEW.incremental_contracts
           OR declaration->>'llmGatewayContract' IS DISTINCT FROM NEW.llm_gateway_contract
           OR declaration->'transferFormats' IS DISTINCT FROM NEW.transfer_formats
           OR nullif(declaration->>'tenantDeleteActionKey','NONE') IS DISTINCT FROM NEW.tenant_delete_action_key
           OR declaration->>'status' IS DISTINCT FROM NEW.status
           OR EXISTS(SELECT 1 FROM catalog.resource_type_definition d
                     WHERE d.component_release_id IS NULL AND d.type_key=NEW.type_key) THEN
            RAISE EXCEPTION 'resource type differs from exact release or platform namespace' USING ERRCODE='23514';
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER application_action_definition_source BEFORE INSERT ON catalog.action_definition
FOR EACH ROW EXECUTE FUNCTION catalog.guard_application_definition();
CREATE TRIGGER application_resource_type_source BEFORE INSERT ON catalog.resource_type_definition
FOR EACH ROW EXECUTE FUNCTION catalog.guard_application_definition();

CREATE FUNCTION catalog.guard_resource_type_declaration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.component_release_id IS NOT NULL THEN
        RAISE EXCEPTION 'application type declaration is immutable and retained' USING ERRCODE='23001';
    END IF;
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER application_resource_type_immutable BEFORE UPDATE OR DELETE ON catalog.resource_type_definition
FOR EACH ROW EXECUTE FUNCTION catalog.guard_resource_type_declaration();

-- The exact implementation is resolved through the target, never through an
-- arbitrary first row for the contract key. Tool and target bindings must agree.
CREATE FUNCTION catalog.action_definition_for_scope(key text, ver integer, typ text, target uuid, tool uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE target_binding uuid; tool_binding uuid; release uuid; result uuid;
BEGIN
    IF typ='RESOURCE' THEN
        SELECT application_binding_id INTO target_binding FROM catalog.resource WHERE id=target;
    ELSIF typ='ASSET' THEN
        SELECT r.application_binding_id INTO target_binding FROM catalog.asset a
        JOIN catalog.resource r ON r.id=a.resource_id AND r.tenant_id=a.tenant_id WHERE a.id=target;
    ELSE RAISE EXCEPTION 'unknown scope target type' USING ERRCODE='23514'; END IF;
    SELECT application_binding_id INTO tool_binding FROM catalog.resource WHERE id=tool;
    IF target_binding IS NOT NULL AND tool_binding IS NOT NULL AND target_binding<>tool_binding THEN
        RAISE EXCEPTION 'scope target and tool implementations differ' USING ERRCODE='23514';
    END IF;
    IF coalesce(target_binding,tool_binding) IS NOT NULL THEN
        SELECT p.component_release_id INTO release FROM catalog.application_binding b
        JOIN projection.application_runtime p ON p.binding_id=b.id AND p.generation=b.active_projection_generation
        WHERE b.id=coalesce(target_binding,tool_binding) AND b.state='ACTIVE' AND p.state='ACTIVE'
          AND p.component_release_id=b.component_release_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'scope implementation unavailable' USING ERRCODE='23514'; END IF;
        SELECT id INTO result FROM catalog.action_definition
        WHERE action_key=key AND version=ver AND component_release_id=release AND status='ACTIVE';
    ELSE
        SELECT id INTO result FROM catalog.action_definition
        WHERE action_key=key AND version=ver AND component_release_id IS NULL AND status='ACTIVE';
    END IF;
    IF result IS NULL THEN RAISE EXCEPTION 'scope exact definition unavailable' USING ERRCODE='23514'; END IF;
    RETURN result;
END $$;
CREATE FUNCTION admission.freeze_delegation_definition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected uuid;
BEGIN
    expected:=catalog.action_definition_for_scope(NEW.action_key,NEW.action_version,NEW.target_type,NEW.target_id,NEW.tool_resource_id);
    IF NEW.action_definition_id IS NOT NULL AND NEW.action_definition_id<>expected THEN
        RAISE EXCEPTION 'scope definition does not match target implementation' USING ERRCODE='23514';
    END IF;
    NEW.action_definition_id:=expected;
    RETURN NEW;
END $$;
CREATE TRIGGER aa_delegation_definition BEFORE INSERT ON admission.delegation_scope
FOR EACH ROW EXECUTE FUNCTION admission.freeze_delegation_definition();

CREATE OR REPLACE FUNCTION admission.guard_delegation_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP='UPDATE' THEN
        RAISE EXCEPTION 'DelegationScope 不可扩大或改指另一target' USING ERRCODE='23001';
    END IF;
    PERFORM 1 FROM admission.delegation_grant g
    JOIN catalog.action_definition a ON a.id=NEW.action_definition_id
        AND a.action_key=NEW.action_key AND a.version=NEW.action_version
        AND a.target_type=NEW.target_type AND a.status='ACTIVE'
    JOIN catalog.result_exposure_policy p ON p.id=NEW.result_exposure_policy_id
        AND p.version=NEW.result_exposure_policy_version AND p.tenant_id=g.tenant_id AND p.status='ACTIVE'
    WHERE g.id=NEW.delegation_id AND g.state='ACTIVE'
        AND (NEW.create_workspace_id IS NULL OR NEW.create_workspace_id=g.workspace_id)
        AND (NEW.target_id IS NULL OR EXISTS (SELECT 1 FROM catalog.resource r
            WHERE ((NEW.target_type='RESOURCE' AND r.id=NEW.target_id)
                OR (NEW.target_type='ASSET' AND EXISTS(SELECT 1 FROM catalog.asset asset
                    WHERE asset.id=NEW.target_id AND asset.resource_id=r.id AND asset.tenant_id=r.tenant_id AND asset.state='ACTIVE')))
                AND r.tenant_id=g.tenant_id AND r.state='ACTIVE'
                AND (r.home_workspace_id IS NULL OR r.home_workspace_id=g.workspace_id)))
        AND (NEW.tool_resource_id IS NULL OR EXISTS (SELECT 1 FROM catalog.resource r
            WHERE r.id=NEW.tool_resource_id AND r.tenant_id=g.tenant_id AND r.state='ACTIVE'
                AND (r.home_workspace_id IS NULL OR r.home_workspace_id=g.workspace_id)));
    IF NOT FOUND THEN
        RAISE EXCEPTION 'DelegationScope 的action/target/tool/exposure必须同scope并固定确切版本' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END $$;

CREATE FUNCTION catalog.freeze_resource_type_definition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected uuid; release uuid; component text;
BEGIN
    IF TG_OP='UPDATE' THEN
        IF NEW.resource_type_definition_id IS DISTINCT FROM OLD.resource_type_definition_id THEN
            RAISE EXCEPTION 'resource type definition is frozen' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.application_binding_id IS NULL OR NEW.type_key='tool.definition' THEN
        SELECT id INTO expected FROM catalog.resource_type_definition
        WHERE type_key=NEW.type_key AND component_release_id IS NULL AND status='ACTIVE';
    ELSE
        SELECT p.component_release_id,b.component_type_key INTO release,component FROM catalog.application_binding b
        JOIN projection.application_runtime p ON p.binding_id=b.id AND p.generation=b.active_projection_generation
        WHERE b.id=NEW.application_binding_id AND b.tenant_id=NEW.tenant_id
          AND (b.workspace_id IS NULL OR b.workspace_id=NEW.home_workspace_id)
          AND b.state='ACTIVE' AND p.state='ACTIVE' AND p.component_release_id=b.component_release_id;
        IF NOT FOUND OR component IS DISTINCT FROM NEW.component_type_key THEN
            RAISE EXCEPTION 'resource binding unavailable or implementation differs' USING ERRCODE='23514';
        END IF;
        SELECT id INTO expected FROM catalog.resource_type_definition
        WHERE type_key=NEW.type_key AND component_release_id=release AND status='ACTIVE';
    END IF;
    IF expected IS NULL OR (NEW.resource_type_definition_id IS NOT NULL AND NEW.resource_type_definition_id<>expected) THEN
        RAISE EXCEPTION 'resource exact type declaration unavailable' USING ERRCODE='23514';
    END IF;
    NEW.resource_type_definition_id:=expected;
    RETURN NEW;
END $$;
CREATE TRIGGER aa_resource_type_definition BEFORE INSERT OR UPDATE ON catalog.resource
FOR EACH ROW EXECUTE FUNCTION catalog.freeze_resource_type_definition();

ALTER TABLE admission.action_execution
    ADD COLUMN action_definition_id uuid,
    ADD COLUMN component_binding_kind text,
    ADD COLUMN component_binding_id uuid,
    ADD COLUMN component_release_id uuid REFERENCES catalog.component_release(id),
    ADD COLUMN component_projection_generation bigint,
    ADD CONSTRAINT action_execution_exact_definition FOREIGN KEY(action_definition_id,action_key,action_version)
        REFERENCES catalog.action_definition(id,action_key,version),
    ADD CONSTRAINT action_execution_definition_release FOREIGN KEY(action_definition_id,component_release_id)
        REFERENCES catalog.action_definition(id,component_release_id),
    ADD CONSTRAINT action_execution_application_ref CHECK (
        (component_binding_kind IS NULL AND component_binding_id IS NULL AND component_release_id IS NULL
         AND component_projection_generation IS NULL)
        OR (component_binding_kind='APPLICATION' AND component_binding_id IS NOT NULL
            AND component_release_id IS NOT NULL AND component_projection_generation IS NOT NULL
            AND component_projection_generation>0 AND action_definition_id IS NOT NULL));
ALTER TABLE projection.application_runtime ADD CONSTRAINT application_runtime_release_locator
    UNIQUE(binding_id,generation,component_release_id);
ALTER TABLE admission.action_execution ADD CONSTRAINT action_execution_application_projection
    FOREIGN KEY(component_binding_id,component_projection_generation,component_release_id)
    REFERENCES projection.application_runtime(binding_id,generation,component_release_id);
CREATE FUNCTION admission.freeze_execution_definition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected uuid;
BEGIN
    IF TG_OP='UPDATE' THEN
        IF ROW(NEW.action_definition_id,NEW.component_binding_kind,NEW.component_binding_id,
               NEW.component_release_id,NEW.component_projection_generation)
          IS DISTINCT FROM ROW(OLD.action_definition_id,OLD.component_binding_kind,OLD.component_binding_id,
               OLD.component_release_id,OLD.component_projection_generation) THEN
            RAISE EXCEPTION 'execution implementation is frozen' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.component_binding_kind IS NULL THEN
        SELECT id INTO expected FROM catalog.action_definition
        WHERE action_key=NEW.action_key AND version=NEW.action_version AND component_release_id IS NULL;
        -- Existing bootstrap and rejected unknown-action admissions have no
        -- ActionDefinition. Preserve that boundary; never invent one for them.
    ELSE
        SELECT d.id INTO expected FROM catalog.application_binding b
        JOIN projection.application_runtime p ON p.binding_id=b.id AND p.generation=NEW.component_projection_generation
        JOIN catalog.action_definition d ON d.component_release_id=p.component_release_id
        WHERE b.id=NEW.component_binding_id AND b.tenant_id=NEW.tenant_id
          AND (b.workspace_id IS NULL OR b.workspace_id=NEW.workspace_id)
          AND b.state='ACTIVE' AND b.active_projection_generation=p.generation AND p.state='ACTIVE'
          AND p.component_release_id=NEW.component_release_id AND b.component_release_id=p.component_release_id
          AND d.action_key=NEW.action_key AND d.version=NEW.action_version AND d.status='ACTIVE';
        IF expected IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM catalog.action_definition d
            JOIN catalog.resource r ON r.application_binding_id=NEW.component_binding_id
              AND r.tenant_id=NEW.tenant_id AND r.state='ACTIVE'
              AND (r.home_workspace_id IS NULL OR r.home_workspace_id=NEW.workspace_id)
            WHERE d.id=expected AND (
                (d.target_type='RESOURCE' AND r.id=NEW.target_id)
                OR (d.target_type='ASSET' AND EXISTS(SELECT 1 FROM catalog.asset a
                    WHERE a.id=NEW.target_id AND a.resource_id=r.id AND a.tenant_id=r.tenant_id AND a.state='ACTIVE')))
        ) THEN RAISE EXCEPTION 'execution target differs from binding scope' USING ERRCODE='23514'; END IF;
        IF expected IS NULL THEN RAISE EXCEPTION 'execution implementation unavailable' USING ERRCODE='23514'; END IF;
    END IF;
    IF NEW.action_definition_id IS NOT NULL AND NEW.action_definition_id IS DISTINCT FROM expected THEN
        RAISE EXCEPTION 'execution definition differs from frozen implementation' USING ERRCODE='23514';
    END IF;
    NEW.action_definition_id:=expected;
    RETURN NEW;
END $$;
CREATE TRIGGER aa_execution_definition BEFORE INSERT OR UPDATE ON admission.action_execution
FOR EACH ROW EXECUTE FUNCTION admission.freeze_execution_definition();

-- Extend the original root/child source guard, retaining both Memory and step
-- approval consumers. The APPLICATION child belongs to the actual original
-- Invocation, not to a new Operation/Workflow or a provider-selected caller.
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
            AND installed.state='ACTIVE' AND installed.active_projection_generation=i.projection_generation
            AND installed.pinned_version_asset_id=i.agent_version_asset_id
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

-- Existing version immutability is unchanged. Deletion now locates the actual
-- referencing implementation, including pre-migration platform admissions.
CREATE OR REPLACE FUNCTION catalog.guard_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP='UPDATE' THEN
        IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN
            RAISE EXCEPTION '% 的版本内容不可变；改规则就登记新版本',TG_TABLE_NAME USING ERRCODE='23001';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_TABLE_NAME='action_definition' THEN
        IF EXISTS (SELECT 1 FROM admission.action_execution WHERE action_definition_id=OLD.id
            OR (action_definition_id IS NULL AND component_binding_kind IS NULL
                AND OLD.component_release_id IS NULL AND action_key=OLD.action_key AND action_version=OLD.version)) THEN
            RAISE EXCEPTION 'ActionDefinition已被其确切ActionExecution引用，不能删除' USING ERRCODE='23001';
        END IF;
    END IF;
    RETURN OLD;
END $$;
