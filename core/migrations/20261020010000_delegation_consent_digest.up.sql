-- DD-126（03 §4/§6、05 §4、10 §3/§4）：委托同意以动作键 + 目标 + 同意摘要成立。
--
-- (1)(2) 每个 ActionDefinition 版本带 consent_digest：只取同意相关字段（scope rule、
-- permission、确认与审批、RoleTemplate、结果暴露与 redaction；业务能力动作另取
-- release 声明的暴露与参数 schema digest）。执行方式、Workflow、Capacity、
-- Quota/meters、审计与其余观测来源不进入摘要，所以只改 meter 钉住集合的新版本
-- （DD-123，governance::meter_version）与前一版本摘要相同。业务能力动作的
-- action_key 即契约键（DD-88），已覆盖 capability_contract_key。
-- 摘要是不可变版本行的生成列：本迁移的表重写为全部存量版本补齐，之后随登记
-- 生成；AFTER UPDATE 版本守卫比较完整行，生成列随原列不变（20261007040000）。
-- 不改写任何 Grant 或 Scope。
CREATE FUNCTION catalog.action_consent_digest(
    action_key text, target_type text, tenant_rule text, workspace_rule text,
    permission text, permission_object_type text, confirmation_mode text,
    approval_policy_id uuid, approval_policy_version integer,
    role_template_key text, role_template_version integer,
    result_exposure text, redaction_policy text, declaration jsonb
) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    -- jsonb 规范文本（键序固定、只含 text/uuid/integer 值）与 UTF-8 编码都不依赖
    -- 会话设置，所以同一行恒得同一摘要；IMMUTABLE 由此成立。
    SELECT encode(sha256(convert_to(jsonb_build_object(
        'format', 'CONSENT_V1',
        'actionKey', action_key,
        'targetType', target_type,
        'tenantRule', tenant_rule,
        'workspaceRule', workspace_rule,
        'permission', permission,
        'permissionObjectType', permission_object_type,
        'confirmationMode', confirmation_mode,
        'approvalPolicyId', approval_policy_id,
        'approvalPolicyVersion', approval_policy_version,
        'roleTemplateKey', role_template_key,
        'roleTemplateVersion', role_template_version,
        'resultExposure', result_exposure,
        'redactionPolicy', redaction_policy,
        'declaredExposureMode', declaration #>> '{resultExposurePolicy,mode}',
        'declaredOutputSchemaHash', declaration #>> '{resultExposurePolicy,outputSchemaHash}',
        'declaredRedactionPolicy', declaration #>> '{resultExposurePolicy,redactionPolicy}',
        'inputSchemaDigest', declaration ->> 'inputSchemaDigest'
    )::text, 'UTF8')), 'hex')
$$;

ALTER TABLE catalog.action_definition
    ADD COLUMN consent_digest text GENERATED ALWAYS AS (catalog.action_consent_digest(
        action_key, target_type, tenant_rule, workspace_rule, permission,
        permission_object_type, confirmation_mode, approval_policy_id,
        approval_policy_version, role_template_key, role_template_version,
        result_exposure, obs_redaction_policy, implementation_declaration)) STORED;

-- (3) Scope 的同意（其授予版本 action_definition_id 的摘要）覆盖解析到的定义，
-- 当且仅当动作键相同且摘要相等。
CREATE FUNCTION catalog.consent_covers(granted_definition uuid, resolved_definition uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM catalog.action_definition g
        JOIN catalog.action_definition c ON c.id = resolved_definition
            AND c.action_key = g.action_key AND c.consent_digest = g.consent_digest
        WHERE g.id = granted_definition)
$$;

-- 平台动作按调用方已解析的确切 (key, version) 判定。
CREATE FUNCTION catalog.platform_consent_covers(granted_definition uuid, resolved_key text,
    resolved_version integer)
RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM catalog.action_definition g
        JOIN catalog.action_definition c ON c.action_key = resolved_key
            AND c.version = resolved_version AND c.component_release_id IS NULL
            AND c.action_key = g.action_key AND c.consent_digest = g.consent_digest
        WHERE g.id = granted_definition)
$$;

-- (4) 一个 Scope 当前会被准入解析到的定义：平台动作为 ACTIVE 版本；业务能力动作为
-- 目标或 Tool 的 binding 当前 release 中的 ACTIVE 定义（与授予时的
-- action_definition_for_scope 同一解析，只是不固定版本）。不可解析为 NULL。
CREATE FUNCTION catalog.current_definition_for_scope(key text, typ text, target uuid, tool uuid)
RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE target_binding uuid; tool_binding uuid; release uuid; result uuid;
BEGIN
    IF typ = 'RESOURCE' THEN
        SELECT application_binding_id INTO target_binding FROM catalog.resource WHERE id = target;
    ELSIF typ = 'ASSET' THEN
        SELECT r.application_binding_id INTO target_binding FROM catalog.asset a
        JOIN catalog.resource r ON r.id = a.resource_id AND r.tenant_id = a.tenant_id
        WHERE a.id = target;
    ELSE
        RETURN NULL;
    END IF;
    SELECT application_binding_id INTO tool_binding FROM catalog.resource WHERE id = tool;
    IF target_binding IS NOT NULL AND tool_binding IS NOT NULL AND target_binding <> tool_binding THEN
        RETURN NULL;
    END IF;
    IF coalesce(target_binding, tool_binding) IS NOT NULL THEN
        SELECT p.component_release_id INTO release FROM catalog.application_binding b
        JOIN projection.application_runtime p ON p.binding_id = b.id
            AND p.generation = b.active_projection_generation
        WHERE b.id = coalesce(target_binding, tool_binding) AND b.state = 'ACTIVE'
            AND p.state = 'ACTIVE' AND p.component_release_id = b.component_release_id;
        IF release IS NULL THEN
            RETURN NULL;
        END IF;
        SELECT id INTO result FROM catalog.action_definition
        WHERE action_key = key AND component_release_id = release AND status = 'ACTIVE';
    ELSE
        SELECT id INTO result FROM catalog.action_definition
        WHERE action_key = key AND component_release_id IS NULL AND status = 'ACTIVE';
    END IF;
    RETURN result;
END $$;

-- (5) 续签替换：被替换的 Grant 记 superseded_by 并进入终态 SUPERSEDED。
ALTER TABLE admission.delegation_grant
    ADD COLUMN superseded_by_delegation_id uuid REFERENCES admission.delegation_grant(id),
    DROP CONSTRAINT delegation_grant_state_check,
    ADD CONSTRAINT delegation_grant_state_check
        CHECK (state IN ('ACTIVE','REVOKING','REVOKED','EXPIRED','SUPERSEDED')),
    ADD CONSTRAINT delegation_grant_superseded_by
        CHECK ((state = 'SUPERSEDED') = (superseded_by_delegation_id IS NOT NULL)
            AND superseded_by_delegation_id IS DISTINCT FROM id);

-- 固定引用 Grant 的消费者（AutomationDefinition）沿替换链解析到链尾；
-- 链尾是否可用仍由调用方逐项核验。
CREATE FUNCTION admission.current_delegation(grant_id uuid)
RETURNS uuid LANGUAGE sql STABLE AS $$
    WITH RECURSIVE chain(id, next, depth) AS (
        SELECT id, superseded_by_delegation_id, 0
        FROM admission.delegation_grant WHERE id = grant_id
        UNION ALL
        SELECT g.id, g.superseded_by_delegation_id, c.depth + 1
        FROM chain c JOIN admission.delegation_grant g ON g.id = c.next
        WHERE c.depth < 64
    )
    SELECT id FROM chain WHERE next IS NULL
$$;

-- 插入分支与 20261002220000 相同；更新分支只多一条转移：ACTIVE 或 EXPIRED 由同一
-- grantor 在同一 Installation 上的 ACTIVE 续签 Grant 替换为 SUPERSEDED。
CREATE OR REPLACE FUNCTION admission.guard_delegation_grant() RETURNS trigger AS $$
BEGIN
    IF TG_OP='UPDATE' THEN
        IF (to_jsonb(NEW)-'state'-'version'-'superseded_by_delegation_id')
                IS DISTINCT FROM (to_jsonb(OLD)-'state'-'version'-'superseded_by_delegation_id')
            OR NEW.version<>OLD.version+1
            OR OLD.superseded_by_delegation_id IS NOT NULL
            OR NOT ((OLD.state='ACTIVE' AND NEW.state IN ('REVOKING','REVOKED','EXPIRED')
                    AND NEW.superseded_by_delegation_id IS NULL)
                OR (OLD.state='REVOKING' AND NEW.state='REVOKED'
                    AND NEW.superseded_by_delegation_id IS NULL)
                OR (OLD.state IN ('ACTIVE','EXPIRED') AND NEW.state='SUPERSEDED'
                    AND EXISTS (SELECT 1 FROM admission.delegation_grant s
                        WHERE s.id=NEW.superseded_by_delegation_id AND s.id<>NEW.id
                          AND s.state='ACTIVE' AND s.tenant_id=NEW.tenant_id
                          AND s.workspace_id=NEW.workspace_id
                          AND s.grantor_principal_id=NEW.grantor_principal_id
                          AND s.installation_resource_id=NEW.installation_resource_id
                          AND s.agent_principal_id=NEW.agent_principal_id))) THEN
            RAISE EXCEPTION 'DelegationGrant 内容不可替换或扩大；终态不可重新激活'
                USING ERRCODE='check_violation';
        END IF;
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

-- (3) DelegationUse：Scope 按动作键与同意摘要覆盖本次执行的确切定义，不再要求版本号
-- 相等；其余与 20261004010000 相同。
CREATE OR REPLACE FUNCTION admission.guard_delegation_use() RETURNS trigger AS $$
DECLARE
    g admission.delegation_grant%ROWTYPE;
    execution_id uuid;
    grant_tenant uuid;
BEGIN
    IF TG_OP='UPDATE' OR TG_OP='DELETE' THEN
        RAISE EXCEPTION 'DelegationUse 是首次dispatch证据，不能改写或抹去' USING ERRCODE='restrict_violation';
    END IF;
    SELECT id INTO execution_id FROM admission.action_execution
        WHERE root_operation_id=NEW.operation_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'DelegationUse缺准入operation' USING ERRCODE='check_violation';
    END IF;
    SELECT tenant_id INTO grant_tenant FROM admission.delegation_grant WHERE id=NEW.delegation_id;
    PERFORM 1 FROM identity.tenant WHERE id=grant_tenant FOR UPDATE;
    SELECT * INTO g FROM admission.delegation_grant WHERE id=NEW.delegation_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'DelegationUse缺Grant' USING ERRCODE='check_violation';
    END IF;
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
        AND s.action_key=ae.action_key AND s.target_type=a.target_type
    JOIN catalog.action_definition granted ON granted.id=s.action_definition_id
        AND granted.action_key=a.action_key AND granted.consent_digest=a.consent_digest
    JOIN catalog.result_exposure_policy p ON p.id=s.result_exposure_policy_id
        AND p.version=s.result_exposure_policy_version AND p.status='ACTIVE'
    JOIN catalog.agent_installation i ON i.resource_id=g.installation_resource_id
        AND i.agent_principal_id=g.agent_principal_id AND i.workspace_id=g.workspace_id AND i.state='ACTIVE'
    JOIN identity.tenant t ON t.id=g.tenant_id AND t.state='ACTIVE'
    JOIN identity.workspace w ON w.id=g.workspace_id AND w.tenant_id=t.id AND w.state='ACTIVE'
    JOIN identity.principal human ON human.id=g.grantor_principal_id AND human.tenant_id=t.id
        AND human.kind='HUMAN' AND human.status='ACTIVE'
    JOIN identity.tenant_membership tm ON tm.tenant_principal_id=human.id AND tm.tenant_id=t.id AND tm.state='ACTIVE'
    WHERE ae.id=execution_id AND ae.operation_id=NEW.operation_id
        AND ae.tenant_id=g.tenant_id AND ae.workspace_id=g.workspace_id
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
