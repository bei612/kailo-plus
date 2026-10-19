-- DD-126 回滚。停止发布条件：已有 Grant 被续签替换（SUPERSEDED）时不能回到没有该
-- 终态的模型——回滚会让被替换的 Grant 无处安放或被重新激活，迁移拒绝执行，
-- 只能前向修复。没有 SUPERSEDED 时恢复按版本号匹配的守卫与原 Grant 守卫。
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM admission.delegation_grant WHERE state='SUPERSEDED') THEN
        RAISE EXCEPTION 'DD-126 回滚被拒：已存在被续签替换的 DelegationGrant'
            USING ERRCODE='restrict_violation';
    END IF;
END $$;

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

CREATE OR REPLACE FUNCTION admission.guard_delegation_grant() RETURNS trigger AS $$
BEGIN
    IF TG_OP='UPDATE' THEN
        IF (to_jsonb(NEW)-'state'-'version') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'version')
            OR NEW.version<>OLD.version+1
            OR NOT ((OLD.state='ACTIVE' AND NEW.state IN ('REVOKING','REVOKED','EXPIRED'))
                OR (OLD.state='REVOKING' AND NEW.state='REVOKED')) THEN
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

DROP FUNCTION admission.current_delegation(uuid);
ALTER TABLE admission.delegation_grant
    DROP CONSTRAINT delegation_grant_superseded_by,
    DROP CONSTRAINT delegation_grant_state_check,
    ADD CONSTRAINT delegation_grant_state_check
        CHECK (state IN ('ACTIVE','REVOKING','REVOKED','EXPIRED')),
    DROP COLUMN superseded_by_delegation_id;

DROP FUNCTION catalog.current_definition_for_scope(text, text, uuid, uuid);
DROP FUNCTION catalog.platform_consent_covers(uuid, text, integer);
DROP FUNCTION catalog.consent_covers(uuid, uuid);
ALTER TABLE catalog.action_definition DROP COLUMN consent_digest;
DROP FUNCTION catalog.action_consent_digest(
    text, text, text, text, text, text, text, uuid, integer, text, integer, text, text, jsonb);
