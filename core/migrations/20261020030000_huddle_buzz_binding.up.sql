-- DD-125(3)、03 §2、05 §2.11、V-SCN-131..134/158..161：原版 Huddle 的临时频道投影。
--
-- 1. 四个动作（SYNC、确认 NONE——原版点击即发起、无审批、quota NONE、FULL_LIFECYCLE）：
--    huddle.start 与 huddle.end 为 DECLARED_WORKSPACE：父 Workspace 时在其上检查 discover
--    （Workspace 须 ACTIVE），父私聊时在 Tenant 上检查 discover，再由 Core 核当前参与者；
--    huddle.agent.add/remove 只属于父 Workspace。Tenant CONTROL 只是 9007/9000/9001/9002 的
--    签名者，发起人与执行人是已准入的 HUMAN。旧版本 Core 没有这些 key 的消费者，按 BLOCKED 拒绝。
-- 2. projection.huddle_buzz_binding：Relay 的音频房间、参与者与归档才是权威；这里只记临时
--    频道投影、冻结的创建者公钥与状态。PROVISIONING 由准入事务写入（Channel UUID 预分配，
--    重试不另建），回读一致才 ACTIVE，Relay 确定拒绝投影即 ERROR，观察到 48103 或归档即
--    ENDED（终态、不复用）。Web 创建者的 48106/48100 各签一次随行保存，重试只重投不重签。
INSERT INTO catalog.action_definition
    (action_key, version, component_type_key, target_type, tenant_rule, workspace_rule,
     permission, permission_object_type, execution_mode, confirmation_mode,
     approval_policy_id, approval_policy_version, workflow_type, workflow_kind,
     capacity_policy, capacity_pool_key, quota_policy, meters, result_exposure, audit_policy,
     obs_correlation_mode, obs_progress_source, obs_terminal_source, obs_usage_source,
     obs_cost_source, obs_redaction_policy, status)
VALUES
    ('huddle.start', 1, 'core', 'HUDDLE', 'SESSION_TENANT', 'DECLARED_WORKSPACE',
     'discover', 'tenant', 'SYNC', 'NONE', NULL, NULL, NULL, NULL,
     'NONE', NULL, 'NONE', '{}'::text[], 'NONE', 'FULL_LIFECYCLE',
     'OPERATION_REF', 'NONE', 'SYNC_RESULT', 'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE'),
    ('huddle.agent.add', 1, 'core', 'HUDDLE', 'SESSION_TENANT', 'WORKSPACE_REQUIRED',
     'discover', 'workspace', 'SYNC', 'NONE', NULL, NULL, NULL, NULL,
     'NONE', NULL, 'NONE', '{}'::text[], 'NONE', 'FULL_LIFECYCLE',
     'OPERATION_REF', 'NONE', 'SYNC_RESULT', 'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE'),
    ('huddle.agent.remove', 1, 'core', 'HUDDLE', 'SESSION_TENANT', 'WORKSPACE_REQUIRED',
     'discover', 'workspace', 'SYNC', 'NONE', NULL, NULL, NULL, NULL,
     'NONE', NULL, 'NONE', '{}'::text[], 'NONE', 'FULL_LIFECYCLE',
     'OPERATION_REF', 'NONE', 'SYNC_RESULT', 'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE'),
    ('huddle.end', 1, 'core', 'HUDDLE', 'SESSION_TENANT', 'DECLARED_WORKSPACE',
     'discover', 'tenant', 'SYNC', 'NONE', NULL, NULL, NULL, NULL,
     'NONE', NULL, 'NONE', '{}'::text[], 'NONE', 'FULL_LIFECYCLE',
     'OPERATION_REF', 'NONE', 'SYNC_RESULT', 'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE');

CREATE TABLE projection.huddle_buzz_binding (
    id                              uuid        NOT NULL,
    tenant_id                       uuid        NOT NULL REFERENCES identity.tenant (id),
    parent_workspace_id             uuid        REFERENCES identity.workspace (id),
    parent_conversation_id          uuid        REFERENCES projection.conversation_buzz_binding (id),
    parent_channel_id               uuid        NOT NULL,
    channel_id                      uuid        NOT NULL,
    channel_name                    text        NOT NULL,
    initiator_principal_id          uuid        NOT NULL REFERENCES identity.principal (id),
    creator_pubkey                  text        NOT NULL
        REFERENCES identity.buzz_identity_binding (pubkey),
    agent_installation_resource_ids uuid[]      NOT NULL DEFAULT '{}',
    operation_id                    uuid        NOT NULL,
    action_execution_id             uuid        NOT NULL
        REFERENCES admission.action_execution (id),
    state                           text        NOT NULL,
    version                         integer     NOT NULL DEFAULT 1,
    -- Web 创建者的 48106 与 48100：各签一次，重投同一事件（DD-81）
    guidelines_event                jsonb,
    started_event                   jsonb,
    -- 结束观察的轮转游标；只读 Relay，不是业务状态
    observed_at                     timestamptz,
    created_at                      timestamptz NOT NULL DEFAULT now(),
    updated_at                      timestamptz NOT NULL DEFAULT now(),
    ended_at                        timestamptz,
    CONSTRAINT huddle_buzz_binding_pkey PRIMARY KEY (id),
    CONSTRAINT huddle_buzz_binding_channel_unique UNIQUE (channel_id),
    CONSTRAINT huddle_buzz_binding_execution_unique UNIQUE (action_execution_id),
    CONSTRAINT huddle_state_enum
        CHECK (state IN ('PROVISIONING', 'ACTIVE', 'ENDED', 'ERROR')),
    CONSTRAINT huddle_buzz_binding_parent_check
        CHECK ((parent_workspace_id IS NULL) <> (parent_conversation_id IS NULL)),
    CONSTRAINT huddle_buzz_binding_agents_check
        CHECK (cardinality(agent_installation_resource_ids) <= 20
               AND (parent_conversation_id IS NULL
                    OR cardinality(agent_installation_resource_ids) = 0)),
    CONSTRAINT huddle_buzz_binding_creator_check CHECK (creator_pubkey ~ '^[0-9a-f]{64}$'),
    CONSTRAINT huddle_buzz_binding_name_check
        CHECK (char_length(channel_name) BETWEEN 1 AND 100),
    CONSTRAINT huddle_buzz_binding_ended_check CHECK ((state = 'ENDED') = (ended_at IS NOT NULL)),
    CONSTRAINT huddle_buzz_binding_announcement_check
        CHECK ((guidelines_event IS NULL) = (started_event IS NULL)),
    CONSTRAINT huddle_buzz_binding_version_check CHECK (version > 0)
);
CREATE INDEX huddle_buzz_binding_by_parent
    ON projection.huddle_buzz_binding (tenant_id, parent_channel_id, created_at DESC);
CREATE INDEX huddle_buzz_binding_by_workspace
    ON projection.huddle_buzz_binding (tenant_id, parent_workspace_id)
    WHERE state IN ('PROVISIONING', 'ACTIVE');
CREATE INDEX huddle_buzz_binding_live
    ON projection.huddle_buzz_binding (observed_at NULLS FIRST, id)
    WHERE state = 'ACTIVE';
