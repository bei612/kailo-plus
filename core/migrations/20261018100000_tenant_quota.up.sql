-- DD-123 / V-SCN-113–116：Tenant 额度由 Tenant admin 以 tenant.quota.set 直接设置，
-- OpenMeter 是唯一权威（DD-07/38）。
--
-- 1. tenant.quota.set：目标 Tenant、manage@tenant、SYNC、显式确认、无审批策略、
--    FULL_LIFECYCLE、quota_policy NONE。派发只写该 Tenant Customer 的硬限制 entitlement。
--    Agent 没有发起路径（Delegation 只接受 agent.invoke、automation.run 与登记过 Agent
--    consumer 的动作），.design/12 对 Agent 发起所需的审批不会被绕开。旧版本 Core 没有
--    该 key 的语义，按 BLOCKED 拒绝。
-- 2. admission.tenant_quota_intent：DD-81 的写前意图。每次设置（SET）与每个默认额度
--    （DEFAULT，部署引导）一行，冻结额度项、上限与 Customer；开始派发时冻结原生请求与
--    被替换的 entitlement，结论只记原生引用。它不是余额或用量账本：上限、用量与余额只在
--    OpenMeter。同一 Tenant 同一额度项至多一个未被确定拒绝的默认意图。
INSERT INTO catalog.action_definition
    (action_key, version, component_type_key, target_type, tenant_rule, workspace_rule,
     permission, permission_object_type, execution_mode, confirmation_mode,
     approval_policy_id, approval_policy_version, workflow_type, workflow_kind,
     capacity_policy, capacity_pool_key, quota_policy, meters, result_exposure, audit_policy,
     obs_correlation_mode, obs_progress_source, obs_terminal_source, obs_usage_source,
     obs_cost_source, obs_redaction_policy, status)
VALUES
    ('tenant.quota.set', 1, 'core', 'TENANT', 'SESSION_TENANT', 'TENANT_ONLY',
     'manage', 'tenant', 'SYNC', 'EXPLICIT', NULL, NULL, NULL, NULL,
     'NONE', NULL, 'NONE', '{}'::text[], 'NONE', 'FULL_LIFECYCLE',
     'OPERATION_REF', 'NONE', 'SYNC_RESULT', 'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE');

CREATE TABLE admission.tenant_quota_intent (
    action_execution_id     uuid        NOT NULL
        REFERENCES admission.action_execution (id) ON DELETE CASCADE,
    tenant_id               uuid        NOT NULL,
    feature_key             text        NOT NULL,
    limit_per_period        bigint      NOT NULL,
    origin                  text        NOT NULL,
    openmeter_namespace     text        NOT NULL,
    openmeter_customer_id   text        NOT NULL,
    -- 写前冻结：置 true 之后只对账，不再发原生写入
    dispatch_started        boolean     NOT NULL DEFAULT false,
    request                 jsonb,
    replaced_entitlement_id text,
    -- 原生结论：VERIFIED 带回读确认的 entitlement ID；SUPERSEDED 为已写入后又被替换；
    -- REJECTED 为原生确定拒绝（未写入）；PREEXISTING 为默认额度遇到已有 entitlement
    outcome                 text,
    entitlement_id          text,
    settled_at              timestamptz,
    created_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tenant_quota_intent_pkey PRIMARY KEY (action_execution_id),
    CONSTRAINT tenant_quota_intent_feature_check
        CHECK (feature_key IN ('agent_tokens', 'automation_runs', 'agent_memory_writes')),
    CONSTRAINT tenant_quota_intent_limit_check
        CHECK (limit_per_period BETWEEN 0 AND 1000000000000),
    CONSTRAINT tenant_quota_intent_origin_check CHECK (origin IN ('SET', 'DEFAULT')),
    CONSTRAINT tenant_quota_intent_namespace_check CHECK (openmeter_namespace <> ''),
    CONSTRAINT tenant_quota_intent_customer_check
        CHECK (openmeter_customer_id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
    CONSTRAINT tenant_quota_intent_request_check
        CHECK (dispatch_started = (request IS NOT NULL)
               AND (replaced_entitlement_id IS NULL OR dispatch_started)),
    CONSTRAINT tenant_quota_intent_outcome_check CHECK (outcome IS NULL OR outcome IN
        ('VERIFIED', 'SUPERSEDED', 'REJECTED', 'PREEXISTING')),
    CONSTRAINT tenant_quota_intent_settled_check CHECK (
        (outcome IS NULL) = (settled_at IS NULL)
        AND (outcome IS NOT DISTINCT FROM 'VERIFIED') = (entitlement_id IS NOT NULL)
        AND (outcome IS DISTINCT FROM 'VERIFIED' OR dispatch_started)
        AND (outcome IS DISTINCT FROM 'SUPERSEDED' OR dispatch_started)
    )
);
CREATE UNIQUE INDEX tenant_quota_intent_one_default
    ON admission.tenant_quota_intent (tenant_id, feature_key)
    WHERE origin = 'DEFAULT' AND outcome IS DISTINCT FROM 'REJECTED';
CREATE INDEX tenant_quota_intent_by_tenant
    ON admission.tenant_quota_intent (tenant_id, feature_key, created_at);
