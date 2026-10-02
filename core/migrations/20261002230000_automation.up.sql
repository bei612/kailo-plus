-- REQ-23、DD-107：Core 原生自动化事实；不创建外部 workflow/正文镜像或默认授权。
-- 类型保持 DRAFT：公开管理和同构建 Tenant-delete handler 未交付时不能生成入口。
ALTER TABLE catalog.resource DROP CONSTRAINT resource_type_key_check;
ALTER TABLE catalog.resource DROP CONSTRAINT resource_home_workspace_check;
ALTER TABLE catalog.resource ADD CONSTRAINT resource_type_key_check
    CHECK(type_key IN ('agent.definition','agent.installation','llm_route','automation'));
ALTER TABLE catalog.resource ADD CONSTRAINT resource_home_workspace_check CHECK(
    (type_key='agent.definition' AND home_workspace_id IS NULL)
    OR (type_key IN ('agent.installation','automation') AND home_workspace_id IS NOT NULL)
    OR type_key='llm_route');
ALTER TABLE catalog.asset DROP CONSTRAINT asset_type_key_check;
ALTER TABLE catalog.asset ADD CONSTRAINT asset_type_key_check
    CHECK(type_key IN ('agent.version','automation.version'));
INSERT INTO catalog.resource_type_definition VALUES
    ('automation',NULL,NULL,
     '[{"contract_key":"automation@v1","role":"NATIVE_INTERNAL","engine":"NATIVE","stable_key_rule":"catalog.resource.id","revision_rule":"catalog.resource.version plus pinned AutomationVersion Asset","delete_semantics":"frozen Tenant inventory and native Workflow drain before Core tombstones","reconciliation_trigger":"Relay durable ingress checkpoint and existing AgentTaskWorkflow reference","readiness_semantics":"exact published trigger/action version, active owner and Installation, fresh Delegation and CHECK"}]',
     'REQUIRED','[]','tenant.delete','DRAFT');

CREATE TABLE catalog.automation_definition (
    resource_id uuid PRIMARY KEY REFERENCES catalog.resource(id),
    workspace_id uuid NOT NULL REFERENCES identity.workspace(id),
    executor_installation_resource_id uuid NOT NULL REFERENCES catalog.agent_installation(resource_id),
    delegation_id uuid REFERENCES admission.delegation_grant(id),
    pinned_version_asset_id uuid,
    schedule_id text,
    webhook_secret_ref jsonb,
    state text NOT NULL CHECK(state IN ('DRAFT','ENABLED','PAUSED','DISABLED')),
    version integer NOT NULL CHECK(version>0),
    enabled_at timestamptz,
    CHECK(state<>'ENABLED' OR (pinned_version_asset_id IS NOT NULL AND enabled_at IS NOT NULL AND delegation_id IS NOT NULL)),
    CHECK(webhook_secret_ref IS NULL OR jsonb_typeof(webhook_secret_ref)='object')
);
CREATE TABLE catalog.automation_version (
    asset_id uuid PRIMARY KEY REFERENCES catalog.asset(id),
    automation_resource_id uuid NOT NULL REFERENCES catalog.automation_definition(resource_id),
    ordinal integer NOT NULL CHECK(ordinal>0),
    trigger jsonb NOT NULL CHECK((jsonb_typeof(trigger)='object'
        AND trigger->>'kind' IN ('CHANNEL_MESSAGE','MENTION','SCHEDULE','WEBHOOK')) IS TRUE),
    action jsonb NOT NULL CHECK((jsonb_typeof(action)='object'
        AND action->>'kind' IN ('AGENT_TURN','POST_MESSAGE')
        AND jsonb_typeof(action->'template')='string' AND length(action->>'template')>0) IS TRUE),
    approval_policy_id uuid,
    result_target text NOT NULL CHECK(result_target IN ('TRIGGER_THREAD','CHANNEL')),
    config_hash text NOT NULL CHECK(config_hash ~ '^[0-9a-f]{64}$'),
    state text NOT NULL CHECK(state IN ('DRAFT','PUBLISHED','RETIRED')),
    UNIQUE(automation_resource_id,ordinal),
    UNIQUE(asset_id,automation_resource_id)
);
ALTER TABLE catalog.automation_definition ADD CONSTRAINT automation_pinned_version FOREIGN KEY(pinned_version_asset_id,resource_id)
    REFERENCES catalog.automation_version(asset_id,automation_resource_id);

CREATE FUNCTION catalog.guard_automation_scope() RETURNS trigger AS $$
BEGIN
    IF TG_TABLE_NAME='automation_definition' THEN
        PERFORM 1 FROM catalog.resource r
        JOIN catalog.agent_installation i ON i.resource_id=NEW.executor_installation_resource_id
        JOIN catalog.resource ir ON ir.id=i.resource_id AND ir.tenant_id=r.tenant_id
        JOIN identity.workspace w ON w.id=NEW.workspace_id AND w.tenant_id=r.tenant_id
        LEFT JOIN admission.delegation_grant g ON g.id=NEW.delegation_id
          AND g.tenant_id=r.tenant_id AND g.workspace_id=w.id
          AND g.installation_resource_id=i.resource_id AND g.agent_principal_id=i.agent_principal_id
          AND g.grantor_principal_id=r.owner_principal_id
        WHERE r.id=NEW.resource_id AND r.type_key='automation'
          AND r.home_workspace_id=w.id AND i.workspace_id=w.id AND ir.home_workspace_id=w.id
          AND (NEW.delegation_id IS NULL OR g.id IS NOT NULL);
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Automation owner/Installation/Delegation 必须同 scope'
                USING ERRCODE='check_violation';
        END IF;
        IF NEW.state='ENABLED' THEN
            PERFORM 1 FROM catalog.automation_version v
            WHERE v.asset_id=NEW.pinned_version_asset_id AND v.automation_resource_id=NEW.resource_id
              AND v.state='PUBLISHED'
              AND (v.trigger->>'kind'<>'SCHEDULE' OR NEW.schedule_id IS NOT NULL)
              AND (v.trigger->>'kind'<>'WEBHOOK' OR NEW.webhook_secret_ref IS NOT NULL);
            IF NOT FOUND THEN
                RAISE EXCEPTION 'ENABLED Automation 必须 pin 发布版本与真实触发引用'
                    USING ERRCODE='check_violation';
            END IF;
        END IF;
        IF TG_OP='UPDATE' AND (NEW.resource_id IS DISTINCT FROM OLD.resource_id
            OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.version<>OLD.version+1
            OR (NEW.state='ENABLED' AND OLD.state='ENABLED' AND NEW.enabled_at IS DISTINCT FROM OLD.enabled_at)) THEN
            RAISE EXCEPTION 'Automation scope/version 或已启用起点不可替换'
                USING ERRCODE='check_violation';
        END IF;
    ELSE
        PERFORM 1 FROM catalog.asset a JOIN catalog.resource r ON r.id=a.resource_id AND r.tenant_id=a.tenant_id
        WHERE a.id=NEW.asset_id AND a.type_key='automation.version'
          AND r.id=NEW.automation_resource_id AND r.type_key='automation';
        IF NOT FOUND THEN
            RAISE EXCEPTION 'AutomationVersion 必须是同 Resource 的真实 Asset'
                USING ERRCODE='check_violation';
        END IF;
        IF TG_OP='UPDATE' AND OLD.state<>'DRAFT' AND (
            (to_jsonb(NEW)-'state') IS DISTINCT FROM (to_jsonb(OLD)-'state')
            OR (OLD.state='PUBLISHED' AND NEW.state NOT IN ('PUBLISHED','RETIRED'))
            OR (OLD.state='RETIRED' AND NEW.state<>'RETIRED')) THEN
            RAISE EXCEPTION '发布后的 AutomationVersion 不可替换'
                USING ERRCODE='restrict_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER automation_definition_scope BEFORE INSERT OR UPDATE ON catalog.automation_definition
    FOR EACH ROW EXECUTE FUNCTION catalog.guard_automation_scope();
CREATE TRIGGER automation_version_scope BEFORE INSERT OR UPDATE ON catalog.automation_version
    FOR EACH ROW EXECUTE FUNCTION catalog.guard_automation_scope();

ALTER TABLE catalog.agent_invocation ADD COLUMN automation_resource_id uuid
    REFERENCES catalog.automation_definition(resource_id);
ALTER TABLE catalog.agent_invocation ADD FOREIGN KEY(automation_version_asset_id,automation_resource_id)
    REFERENCES catalog.automation_version(asset_id,automation_resource_id);
ALTER TABLE catalog.agent_invocation ADD CONSTRAINT invocation_automation_pair
    CHECK((automation_resource_id IS NULL)=(automation_version_asset_id IS NULL));
-- 原普通 Agent 触发键不覆盖 automation；03 §7 的两个唯一键各自成立。
DO $$ DECLARE constraint_name text; BEGIN
    SELECT c.conname INTO STRICT constraint_name FROM pg_constraint c
    WHERE c.conrelid='catalog.agent_invocation'::regclass AND c.contype='u'
      AND (SELECT array_agg(a.attname::text ORDER BY k.ordinality)
           FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
           JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum)
          = ARRAY['tenant_id','source_event_id','installation_resource_id'];
    EXECUTE format('ALTER TABLE catalog.agent_invocation DROP CONSTRAINT %I',constraint_name);
END $$;
CREATE UNIQUE INDEX invocation_agent_trigger ON catalog.agent_invocation(tenant_id,source_event_id,installation_resource_id)
    WHERE automation_resource_id IS NULL;
CREATE UNIQUE INDEX invocation_automation_trigger ON catalog.agent_invocation(tenant_id,source_event_id,automation_resource_id)
    WHERE automation_resource_id IS NOT NULL;
CREATE FUNCTION catalog.guard_automation_invocation() RETURNS trigger AS $$
BEGIN
    IF TG_OP='UPDATE' AND NEW.automation_resource_id IS DISTINCT FROM OLD.automation_resource_id THEN
        RAISE EXCEPTION 'Invocation Automation 引用已冻结' USING ERRCODE='check_violation';
    END IF;
    IF NEW.automation_resource_id IS NOT NULL THEN
        PERFORM 1 FROM catalog.automation_version v
        JOIN catalog.automation_definition d ON d.resource_id=v.automation_resource_id
        JOIN catalog.resource r ON r.id=d.resource_id
        JOIN admission.action_execution ae ON ae.id=NEW.action_execution_id
        JOIN admission.delegation_grant g ON g.id=NEW.delegation_id
        WHERE v.asset_id=NEW.automation_version_asset_id AND r.id=NEW.automation_resource_id
          AND r.tenant_id=NEW.tenant_id AND d.workspace_id=NEW.workspace_id
          AND g.installation_resource_id=NEW.installation_resource_id
          AND (TG_OP='UPDATE' OR (d.executor_installation_resource_id=NEW.installation_resource_id AND g.id=d.delegation_id))
          AND g.tenant_id=NEW.tenant_id AND g.workspace_id=NEW.workspace_id
          AND g.grantor_principal_id=ae.initiator_principal_id AND g.agent_principal_id=ae.actor_principal_id
          AND ae.action_key='automation.run' AND ae.target_id=r.id
          AND ae.tenant_id=NEW.tenant_id AND ae.workspace_id=NEW.workspace_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Automation Invocation 必须关联同 scope 的版本/actor/Delegation/AE'
                USING ERRCODE='check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER automation_invocation_guard BEFORE INSERT OR UPDATE ON catalog.agent_invocation
    FOR EACH ROW EXECUTE FUNCTION catalog.guard_automation_invocation();
