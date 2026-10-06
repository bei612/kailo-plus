-- Never erase existing definitions or workflow history to make rollback pass.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM catalog.action_definition WHERE workflow_kind='COMPONENT_ACTION')
 OR EXISTS (SELECT 1 FROM projection.workflow_ref WHERE kind='COMPONENT_ACTION') THEN
  RAISE EXCEPTION 'COMPONENT_ACTION definitions/history exist; stop rollback';
 END IF;
END $$;
ALTER TABLE catalog.action_definition DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE catalog.action_definition ADD CONSTRAINT workflow_kind_enum CHECK (workflow_kind IN
 ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
 'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION','COMPONENT_RELEASE',
'COMPONENT_BINDING','COMPONENT_DISABLE','RESOURCE_PROVISION'));

CREATE OR REPLACE FUNCTION catalog.guard_application_definition() RETURNS trigger LANGUAGE plpgsql AS $$
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
ALTER TABLE projection.workflow_ref DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE projection.workflow_ref ADD CONSTRAINT workflow_kind_enum CHECK (kind IN
 ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
 'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION','COMPONENT_RELEASE',
 'COMPONENT_BINDING','COMPONENT_DISABLE','RESOURCE_PROVISION','PROTOCOL_SESSION_RECONCILE'));
