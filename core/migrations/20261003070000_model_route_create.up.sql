-- DD-13/70/99/100、03 §3/§4/§8、17 §9：Core 唯一治理写者，native ConfigResource 保有正文。
-- PROVISIONING 意图先于 OpenBao read / Gateway 文件和配置副作用；pending 库存无伪 revision。
ALTER TABLE catalog.action_definition DROP CONSTRAINT action_workspace_rule_enum;
ALTER TABLE catalog.action_definition ADD CONSTRAINT action_workspace_rule_enum
    CHECK (workspace_rule IN ('TENANT_ONLY','WORKSPACE_REQUIRED','TARGET_HOME_WORKSPACE','DECLARED_WORKSPACE','INHERIT_PARENT'));

CREATE TABLE catalog.model_route_projection (
    resource_id uuid PRIMARY KEY REFERENCES catalog.resource(id),
    action_execution_id uuid NOT NULL UNIQUE REFERENCES admission.action_execution(id),
    source_refs jsonb NOT NULL CHECK (jsonb_typeof(source_refs)='object'),
    dispatch_started boolean NOT NULL DEFAULT false,
    projection_hashes jsonb,
    credential_hash text CHECK (credential_hash ~ '^[0-9a-f]{64}$'),
    retired_absence jsonb CHECK (jsonb_typeof(retired_absence)='array'),
    CONSTRAINT model_route_projection_fence CHECK ((
        (NOT dispatch_started AND projection_hashes IS NULL AND credential_hash IS NULL)
        OR (dispatch_started AND projection_hashes IS NOT NULL AND credential_hash IS NOT NULL
            AND jsonb_typeof(projection_hashes)='object'
            AND projection_hashes->>'llm.provider' ~ '^[0-9a-f]{64}$'
            AND projection_hashes->>'llm.model' ~ '^[0-9a-f]{64}$'
            AND projection_hashes->>'llm.virtualModel' ~ '^[0-9a-f]{64}$')) IS TRUE)
);
CREATE FUNCTION catalog.guard_model_route_projection() RETURNS trigger AS $$
BEGIN
    PERFORM 1 FROM catalog.resource r JOIN admission.action_execution a
        ON a.id=NEW.action_execution_id AND a.tenant_id=r.tenant_id AND a.target_id=r.id
        AND a.workspace_id IS NOT DISTINCT FROM r.home_workspace_id
    WHERE r.id=NEW.resource_id AND r.type_key='llm_route' AND r.native_id=r.id::text
        AND r.owner_principal_id=a.initiator_principal_id AND a.actor_principal_id=a.initiator_principal_id
        AND a.action_key='llm_route.create' AND a.gate_state='ALLOWED'
        AND NEW.source_refs IS NOT DISTINCT FROM a.parameters->'params'->'llmRouteCreate';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Route projection 必须消费同 scope HUMAN 的冻结治理意图' USING ERRCODE='check_violation';
    END IF;
    IF TG_OP='UPDATE' AND (NEW.resource_id IS DISTINCT FROM OLD.resource_id
        OR NEW.action_execution_id IS DISTINCT FROM OLD.action_execution_id
        OR NEW.source_refs IS DISTINCT FROM OLD.source_refs
        OR (OLD.dispatch_started AND (NOT NEW.dispatch_started
            OR NEW.projection_hashes IS DISTINCT FROM OLD.projection_hashes
            OR NEW.credential_hash IS DISTINCT FROM OLD.credential_hash))
        OR (OLD.retired_absence IS NOT NULL AND NEW.retired_absence IS DISTINCT FROM OLD.retired_absence)) THEN
        RAISE EXCEPTION 'Route 冻结归属、一次派发与确定销毁证据不可改写' USING ERRCODE='check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER model_route_projection_scope_guard BEFORE INSERT OR UPDATE ON catalog.model_route_projection
    FOR EACH ROW EXECUTE FUNCTION catalog.guard_model_route_projection();

UPDATE catalog.resource_type_definition SET status='ACTIVE' WHERE type_key='llm_route';
INSERT INTO catalog.action_definition
    (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
     permission,permission_object_type,execution_mode,confirmation_mode,
     approval_policy_id,approval_policy_version,workflow_type,workflow_kind,
     capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,
     obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,
     obs_cost_source,obs_redaction_policy,status)
VALUES ('llm_route.create',1,'core','RESOURCE','SESSION_TENANT','DECLARED_WORKSPACE',
    'create','tenant','SYNC','EXPLICIT',NULL,NULL,NULL,NULL,'NONE',NULL,'NONE','{}'::text[],
    'NONE','FULL_LIFECYCLE','OPERATION_REF','NONE','SYNC_RESULT','NONE','NONE','PLATFORM_METADATA_ONLY','ACTIVE');
