-- DD-49、03 §6、17 §8：Core 授权限制；不产生 runtime action、Invocation 或默认 Grant。
CREATE TABLE catalog.result_exposure_policy (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL REFERENCES identity.tenant(id),
    mode text NOT NULL CHECK (mode IN ('CONSUME_ONLY','READ','EXPORT')),
    output_schema_hash text NOT NULL CHECK (output_schema_hash ~ '^[0-9a-f]{64}$'),
    redaction_policy text NOT NULL CHECK (length(redaction_policy)>0),
    version integer NOT NULL CHECK (version>0),
    status text NOT NULL CHECK (status IN ('ACTIVE','RETIRED')),
    PRIMARY KEY(id,version)
);
CREATE FUNCTION catalog.guard_result_exposure_policy() RETURNS trigger AS $$
BEGIN
    IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN
        RAISE EXCEPTION 'ResultExposurePolicy 内容不可原地替换' USING ERRCODE='restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER result_exposure_policy_immutable BEFORE UPDATE ON catalog.result_exposure_policy
    FOR EACH ROW EXECUTE FUNCTION catalog.guard_result_exposure_policy();

CREATE TABLE admission.delegation_grant (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES identity.tenant(id),
    workspace_id uuid NOT NULL REFERENCES identity.workspace(id),
    grantor_principal_id uuid NOT NULL REFERENCES identity.principal(id),
    installation_resource_id uuid NOT NULL REFERENCES catalog.agent_installation(resource_id),
    agent_principal_id uuid NOT NULL REFERENCES identity.principal(id),
    valid_from timestamptz NOT NULL,
    expires_at timestamptz NOT NULL CHECK (expires_at>valid_from),
    max_uses bigint CHECK (max_uses>0),
    state text NOT NULL CHECK (state IN ('ACTIVE','REVOKING','REVOKED','EXPIRED')),
    version integer NOT NULL CHECK (version>0),
    action_execution_id uuid NOT NULL UNIQUE REFERENCES admission.action_execution(id)
);
CREATE INDEX delegation_grant_expiration ON admission.delegation_grant(expires_at,id)
    WHERE state IN ('ACTIVE','REVOKING');

CREATE TABLE admission.delegation_scope (
    delegation_id uuid NOT NULL REFERENCES admission.delegation_grant(id),
    action_key text NOT NULL CHECK (length(action_key)>0),
    action_version integer NOT NULL CHECK (action_version>0),
    target_type text NOT NULL CHECK (length(target_type)>0),
    target_id uuid,
    create_workspace_id uuid REFERENCES identity.workspace(id),
    tool_resource_id uuid REFERENCES catalog.resource(id),
    result_exposure_policy_id uuid NOT NULL,
    result_exposure_policy_version integer NOT NULL,
    FOREIGN KEY(action_key,action_version) REFERENCES catalog.action_definition(action_key,version),
    FOREIGN KEY(result_exposure_policy_id,result_exposure_policy_version)
        REFERENCES catalog.result_exposure_policy(id,version),
    CHECK ((target_id IS NULL) <> (create_workspace_id IS NULL)),
    UNIQUE NULLS NOT DISTINCT
        (delegation_id,action_key,action_version,target_type,target_id,create_workspace_id,tool_resource_id)
);

CREATE TABLE admission.delegation_use (
    delegation_id uuid NOT NULL REFERENCES admission.delegation_grant(id),
    operation_id uuid NOT NULL REFERENCES admission.action_execution(operation_id),
    first_dispatch_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(delegation_id,operation_id)
);

CREATE FUNCTION admission.guard_delegation_grant() RETURNS trigger AS $$
BEGIN
    IF TG_OP='UPDATE' THEN
        IF (to_jsonb(NEW)-'state'-'version') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'version')
            OR NEW.version<>OLD.version+1
            OR NOT ((OLD.state='ACTIVE' AND NEW.state IN ('REVOKING','REVOKED','EXPIRED'))
                OR (OLD.state='REVOKING' AND NEW.state='REVOKED')) THEN
            RAISE EXCEPTION 'DelegationGrant 内容不可替换或扩大；终态不可重新激活'
                USING ERRCODE='check_violation';
        END IF;
        -- 生命周期收紧不依赖已撤权 HUMAN 或已停用 Installation 仍然 ACTIVE。
        RETURN NEW;
    END IF;
    PERFORM 1 FROM catalog.agent_installation i
    JOIN catalog.resource r ON r.id=i.resource_id AND r.tenant_id=NEW.tenant_id
    JOIN identity.tenant t ON t.id=r.tenant_id AND t.state='ACTIVE'
    JOIN identity.workspace w ON w.id=i.workspace_id AND w.tenant_id=t.id AND w.state='ACTIVE'
    JOIN identity.principal a ON a.id=i.agent_principal_id AND a.tenant_id=t.id
        AND a.kind='AGENT' AND a.status='ACTIVE'
    JOIN identity.principal p ON p.id=NEW.grantor_principal_id AND p.tenant_id=t.id
        AND p.kind='HUMAN' AND p.status='ACTIVE'
    JOIN identity.tenant_membership tm ON tm.tenant_principal_id=p.id AND tm.tenant_id=t.id
        AND tm.state='ACTIVE'
    JOIN admission.action_execution ae ON ae.id=NEW.action_execution_id
        AND ae.tenant_id=t.id AND ae.workspace_id=w.id
        AND ae.initiator_principal_id=p.id AND ae.actor_principal_id=p.id
        AND ae.action_key='agent.delegation.grant' AND ae.target_id=r.id
        AND ae.gate_state='ALLOWED' AND ae.dispatch_state='DISPATCHED'
    WHERE i.resource_id=NEW.installation_resource_id AND i.agent_principal_id=NEW.agent_principal_id
        AND i.workspace_id=NEW.workspace_id AND i.state='ACTIVE'
        AND r.type_key='agent.installation' AND r.state='ACTIVE'
        AND r.home_workspace_id=w.id AND r.projection_action_execution_id IS NULL
        AND NEW.state='ACTIVE' AND NEW.version=1 AND NEW.expires_at>now()
    FOR NO KEY UPDATE OF t,w,p,tm;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'DelegationGrant 必须来自同scope已准入HUMAN管理动作'
            USING ERRCODE='check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER delegation_grant_guard BEFORE INSERT OR UPDATE ON admission.delegation_grant
    FOR EACH ROW EXECUTE FUNCTION admission.guard_delegation_grant();

CREATE FUNCTION admission.guard_delegation_scope() RETURNS trigger AS $$
BEGIN
    IF TG_OP='UPDATE' THEN
        RAISE EXCEPTION 'DelegationScope 不可扩大或改指另一target' USING ERRCODE='restrict_violation';
    END IF;
    PERFORM 1 FROM admission.delegation_grant g
    JOIN catalog.action_definition a ON a.action_key=NEW.action_key AND a.version=NEW.action_version
        AND a.target_type=NEW.target_type AND a.status='ACTIVE'
    JOIN catalog.result_exposure_policy p ON p.id=NEW.result_exposure_policy_id
        AND p.version=NEW.result_exposure_policy_version AND p.tenant_id=g.tenant_id AND p.status='ACTIVE'
    WHERE g.id=NEW.delegation_id AND g.state='ACTIVE'
        AND (NEW.create_workspace_id IS NULL OR NEW.create_workspace_id=g.workspace_id)
        AND (NEW.target_id IS NULL OR EXISTS (SELECT 1 FROM catalog.resource r
            WHERE r.id=NEW.target_id AND r.tenant_id=g.tenant_id AND r.state='ACTIVE'
                AND (r.home_workspace_id IS NULL OR r.home_workspace_id=g.workspace_id)))
        AND (NEW.tool_resource_id IS NULL OR EXISTS (SELECT 1 FROM catalog.resource r
            WHERE r.id=NEW.tool_resource_id AND r.tenant_id=g.tenant_id AND r.state='ACTIVE'
                AND (r.home_workspace_id IS NULL OR r.home_workspace_id=g.workspace_id)));
    IF NOT FOUND THEN
        RAISE EXCEPTION 'DelegationScope 的action/target/tool/exposure必须同scope并固定确切版本'
            USING ERRCODE='check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER delegation_scope_guard BEFORE INSERT OR UPDATE ON admission.delegation_scope
    FOR EACH ROW EXECUTE FUNCTION admission.guard_delegation_scope();

CREATE FUNCTION admission.guard_delegation_use() RETURNS trigger AS $$
DECLARE
    g admission.delegation_grant%ROWTYPE;
    execution_id uuid;
    grant_tenant uuid;
BEGIN
    IF TG_OP='UPDATE' OR TG_OP='DELETE' THEN
        RAISE EXCEPTION 'DelegationUse 是首次dispatch证据，不能改写或抹去' USING ERRCODE='restrict_violation';
    END IF;
    -- 所有消费者共用 AE→Tenant→Grant 锁序；expiry/revoke 不可与首dispatch竞态。
    SELECT id INTO execution_id FROM admission.action_execution WHERE operation_id=NEW.operation_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'DelegationUse缺准入operation' USING ERRCODE='check_violation';
    END IF;
    SELECT tenant_id INTO grant_tenant FROM admission.delegation_grant WHERE id=NEW.delegation_id;
    PERFORM 1 FROM identity.tenant WHERE id=grant_tenant FOR UPDATE;
    SELECT * INTO g FROM admission.delegation_grant WHERE id=NEW.delegation_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'DelegationUse缺Grant' USING ERRCODE='check_violation';
    END IF;
    -- 同operation重试不重复计数；此幂等事实不替代调用方的fresh授权。
    IF EXISTS (SELECT 1 FROM admission.delegation_use
        WHERE delegation_id=NEW.delegation_id AND operation_id=NEW.operation_id) THEN
        RETURN NEW;
    END IF;
    IF g.state<>'ACTIVE' OR g.valid_from>now() OR g.expires_at<=now()
        OR (g.max_uses IS NOT NULL AND (SELECT count(*) FROM admission.delegation_use
            WHERE delegation_id=g.id)>=g.max_uses) THEN
        RAISE EXCEPTION 'Delegation已失效或使用次数耗尽' USING ERRCODE='check_violation';
    END IF;
    PERFORM 1 FROM admission.action_execution ae
    JOIN catalog.action_definition a ON a.action_key=ae.action_key AND a.version=ae.action_version
        AND a.status='ACTIVE'
    JOIN admission.delegation_scope s ON s.delegation_id=g.id
        AND s.action_key=ae.action_key AND s.action_version=ae.action_version
        AND s.target_type=a.target_type
    JOIN catalog.result_exposure_policy p ON p.id=s.result_exposure_policy_id
        AND p.version=s.result_exposure_policy_version AND p.status='ACTIVE'
    JOIN catalog.agent_installation i ON i.resource_id=g.installation_resource_id
        AND i.agent_principal_id=g.agent_principal_id AND i.workspace_id=g.workspace_id AND i.state='ACTIVE'
    JOIN identity.tenant t ON t.id=g.tenant_id AND t.state='ACTIVE'
    JOIN identity.workspace w ON w.id=g.workspace_id AND w.tenant_id=t.id AND w.state='ACTIVE'
    JOIN identity.principal human ON human.id=g.grantor_principal_id AND human.tenant_id=t.id
        AND human.kind='HUMAN' AND human.status='ACTIVE'
    JOIN identity.tenant_membership tm ON tm.tenant_principal_id=human.id AND tm.tenant_id=t.id AND tm.state='ACTIVE'
    WHERE ae.operation_id=NEW.operation_id AND ae.tenant_id=g.tenant_id AND ae.workspace_id=g.workspace_id
        AND ae.initiator_principal_id=g.grantor_principal_id AND ae.actor_principal_id=g.agent_principal_id
        AND ae.gate_state='ALLOWED' AND ae.dispatch_state='NOT_DISPATCHED'
        AND (s.target_id=ae.target_id OR (s.target_id IS NULL AND s.create_workspace_id=ae.workspace_id))
        AND (s.target_id IS NULL OR EXISTS (SELECT 1 FROM catalog.resource r
            WHERE r.id=s.target_id AND r.tenant_id=g.tenant_id AND r.state='ACTIVE'
                AND r.projection_action_execution_id IS NULL AND r.application_binding_id IS NULL
                AND (r.home_workspace_id IS NULL OR r.home_workspace_id=g.workspace_id)))
    FOR NO KEY UPDATE OF t,w,human,tm;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'DelegationUse必须绑定同scope、同grantor/Agent的准入operation和exact action'
            USING ERRCODE='check_violation';
    END IF;
    NEW.first_dispatch_at=now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER delegation_use_guard BEFORE INSERT OR UPDATE OR DELETE ON admission.delegation_use
    FOR EACH ROW EXECUTE FUNCTION admission.guard_delegation_use();

INSERT INTO catalog.action_definition
    (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
     permission,permission_object_type,execution_mode,confirmation_mode,
     approval_policy_id,approval_policy_version,workflow_type,workflow_kind,
     capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,
     obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,
     obs_cost_source,obs_redaction_policy,status)
SELECT action,1,'core','RESOURCE','SESSION_TENANT','TARGET_HOME_WORKSPACE',
    'delegate','resource','SYNC','EXPLICIT',NULL,NULL,NULL,NULL,
    'NONE',NULL,'NONE','{}','NONE','FULL_LIFECYCLE','OPERATION_REF','NONE','SYNC_RESULT',
    'NONE','NONE','PLATFORM_METADATA_ONLY','ACTIVE'
FROM (VALUES ('agent.delegation.grant'),('agent.delegation.revoke')) actions(action);
