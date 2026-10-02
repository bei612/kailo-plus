-- DD-24/25/45/99/100、03 §4/§7、05 §2.8：首个真实平台核心 Resource。
-- 这里只登记 AgentDefinition；没有 Version、Asset、Installation 或 runtime 表。
CREATE TABLE catalog.resource_type_definition (
    type_key text PRIMARY KEY,
    capability_category text,
    capability_contract_version integer,
    incremental_contracts jsonb NOT NULL,
    llm_gateway_contract text NOT NULL CHECK (llm_gateway_contract IN ('REQUIRED','NOT_USED')),
    transfer_formats jsonb NOT NULL,
    tenant_delete_action_key text,
    status text NOT NULL,
    CHECK (jsonb_typeof(incremental_contracts) = 'array' AND jsonb_array_length(incremental_contracts) > 0),
    CHECK (jsonb_typeof(transfer_formats) = 'array'),
    CHECK ((capability_category IS NULL) = (capability_contract_version IS NULL))
);
INSERT INTO catalog.resource_type_definition VALUES
    ('agent.definition',NULL,NULL,
     '[{"contract_key":"agent.definition@v1","role":"NATIVE_INTERNAL","engine":"NATIVE", "stable_key_rule":"catalog.resource.id", "revision_rule":"catalog.resource.version", "delete_semantics":"Tenant frozen inventory -> SpiceDB relationship deletion and empty read -> Core DELETED tombstone", "reconciliation_trigger":"governance_reconcile resumes the same ActionExecution projection intent", "readiness_semantics":"Resource ACTIVE with no pending projection; FullyConsistent SpiceDB relationships match Tenant and HUMAN owner"}]',
     'NOT_USED','[]','tenant.delete','ACTIVE');

CREATE TABLE catalog.resource (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES identity.tenant(id),
    type_key text NOT NULL REFERENCES catalog.resource_type_definition(type_key),
    home_workspace_id uuid REFERENCES identity.workspace(id),
    owner_principal_id uuid NOT NULL REFERENCES identity.principal(id),
    component_type_key text NOT NULL,
    application_binding_id uuid,
    native_type text,
    native_id text,
    state text NOT NULL CONSTRAINT resource_state_enum CHECK (state IN
        ('PROVISIONING','ACTIVE','UNKNOWN','FAILED','RETAINED_READ_ONLY','DELETING','DELETED')),
    version integer NOT NULL CHECK (version > 0),
    -- 唯一真实投影意图是既有 ActionExecution；不是第二套 outbox/工作流。
    projection_action_execution_id uuid REFERENCES admission.action_execution(id),
    UNIQUE (tenant_id,id),
    CHECK (application_binding_id IS NULL),
    CHECK (home_workspace_id IS NULL),
    CHECK (native_id = id::text),
    CHECK (type_key = 'agent.definition')
);
CREATE INDEX resource_owner ON catalog.resource(tenant_id,owner_principal_id);
CREATE TABLE catalog.agent_definition (
    resource_id uuid PRIMARY KEY REFERENCES catalog.resource(id),
    stable_slug text NOT NULL,
    display_name text NOT NULL,
    current_published_version_asset_id uuid,
    status text NOT NULL,
    -- 尚无真实 Version producer：不能写入虚假发布引用。
    CHECK (current_published_version_asset_id IS NULL)
);
CREATE FUNCTION catalog.guard_agent_resource_owner() RETURNS trigger AS $$
BEGIN
    -- 插入/换 owner 与撤权共用 membership 行锁；不能查完 ACTIVE 再并发撤权。
    IF TG_OP = 'INSERT' OR NEW.owner_principal_id IS DISTINCT FROM OLD.owner_principal_id THEN
        PERFORM 1 FROM identity.principal p
        JOIN identity.tenant_membership tm ON tm.tenant_principal_id = p.id
        WHERE p.id = NEW.owner_principal_id AND p.tenant_id = NEW.tenant_id
          AND p.kind = 'HUMAN' AND p.status = 'ACTIVE'
          AND tm.tenant_id = NEW.tenant_id AND tm.state = 'ACTIVE'
        FOR UPDATE OF p,tm;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Resource owner 必须是同 Tenant 的 active HUMAN member'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER agent_resource_owner_guard BEFORE INSERT OR UPDATE OF owner_principal_id
    ON catalog.resource FOR EACH ROW EXECUTE FUNCTION catalog.guard_agent_resource_owner();

-- 所有权转移复用既有职责分离策略时限，不另造部署开关或硬编码时限。
INSERT INTO catalog.approval_policy
    (id,version,action_key,target_type,role_requirements,owner_requirement,self_approval,
     expires_in_seconds,status)
SELECT gen_random_uuid(),1,'resource.transfer_owner','RESOURCE',
       '[{"selector":"TENANT_ADMIN","minDistinct":1}]','NONE','DENY',
       expires_in_seconds,'ACTIVE'
FROM catalog.approval_policy WHERE action_key='tenant.member.revoke' AND status='ACTIVE';

INSERT INTO catalog.action_definition
    (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
     permission,permission_object_type,execution_mode,confirmation_mode,
     approval_policy_id,approval_policy_version,workflow_type,workflow_kind,
     capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,
     obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,
     obs_cost_source,obs_redaction_policy,status)
SELECT keys.action_key,1,'core','RESOURCE',
       'SESSION_TENANT',
       CASE WHEN keys.action_key='agent.definition.create' THEN 'TENANT_ONLY' ELSE 'TARGET_HOME_WORKSPACE' END,
       keys.permission,
       CASE WHEN keys.action_key='agent.definition.create' THEN 'tenant' ELSE 'resource' END,
       'SYNC',CASE WHEN keys.action_key='resource.transfer_owner' THEN 'APPROVAL' ELSE 'NONE' END,
       p.id,p.version,NULL,NULL,'NONE',NULL,'NONE','{}','NONE','FULL_LIFECYCLE',
       'OPERATION_REF','NONE','SYNC_RESULT','NONE','NONE','PLATFORM_METADATA_ONLY','ACTIVE'
FROM (VALUES ('agent.definition.create','create'),('agent.definition.update','update'),
             ('resource.transfer_owner','transfer_owner')) AS keys(action_key,permission)
LEFT JOIN catalog.approval_policy p ON p.action_key=keys.action_key AND p.status='ACTIVE';
