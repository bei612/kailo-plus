-- DD-125(4)、05 §2.11、V-SCN-135：原频道 Canvas（SF-BUZ-54）只经 workspace.canvas.set 写入。
--
-- 1. workspace.canvas.set：执行 Workspace 即目标 Workspace，在其上检查 manage（≙ 原
--    canEditNarrative），Workspace 须 ACTIVE；SYNC、EXPLICIT 确认、无审批、quota NONE、
--    FULL_LIFECYCLE。Tenant CONTROL 只是 kind 40100 的签名者，发起人与执行人是已准入的
--    HUMAN。旧版本 Core 没有该 key 的消费者，按 BLOCKED 拒绝。
-- 2. admission.workspace_canvas_intent：DD-81 的写前意图。准入、已签事件 ID 与结果不明的
--    派发在同一事务内成立；正文不进 Core，只冻结 SHA-256 与字节数（≤64 KiB）。结果只按
--    事件 ID 回读收敛：查到即 VERIFIED；Relay 拒绝、或超出 Relay 时间漂移窗口仍查不到且
--    没有接受确认即 NOT_WRITTEN。同一幂等键的重发只回读，从不重签。
INSERT INTO catalog.action_definition
    (action_key, version, component_type_key, target_type, tenant_rule, workspace_rule,
     permission, permission_object_type, execution_mode, confirmation_mode,
     approval_policy_id, approval_policy_version, workflow_type, workflow_kind,
     capacity_policy, capacity_pool_key, quota_policy, meters, result_exposure, audit_policy,
     obs_correlation_mode, obs_progress_source, obs_terminal_source, obs_usage_source,
     obs_cost_source, obs_redaction_policy, status)
VALUES
    ('workspace.canvas.set', 1, 'core', 'WORKSPACE', 'SESSION_TENANT', 'WORKSPACE_REQUIRED',
     'manage', 'workspace', 'SYNC', 'EXPLICIT', NULL, NULL, NULL, NULL,
     'NONE', NULL, 'NONE', '{}'::text[], 'NONE', 'FULL_LIFECYCLE',
     'OPERATION_REF', 'NONE', 'SYNC_RESULT', 'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE');

CREATE TABLE admission.workspace_canvas_intent (
    action_execution_id uuid        NOT NULL
        REFERENCES admission.action_execution (id) ON DELETE CASCADE,
    tenant_id           uuid        NOT NULL,
    workspace_id        uuid        NOT NULL,
    channel_id          uuid        NOT NULL,
    control_pubkey      text        NOT NULL,
    event_id            text        NOT NULL,
    event_created_at    bigint      NOT NULL,
    content_sha256      text        NOT NULL,
    content_bytes       integer     NOT NULL,
    -- 唯一一次投递的确认；只作证据，结论以回读为准
    relay_ack           text        NOT NULL DEFAULT 'UNKNOWN',
    outcome             text,
    settled_at          timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT workspace_canvas_intent_pkey PRIMARY KEY (action_execution_id),
    CONSTRAINT workspace_canvas_intent_event_unique UNIQUE (event_id),
    CONSTRAINT workspace_canvas_intent_pubkey_check CHECK (control_pubkey ~ '^[0-9a-f]{64}$'),
    CONSTRAINT workspace_canvas_intent_event_check CHECK (event_id ~ '^[0-9a-f]{64}$'),
    CONSTRAINT workspace_canvas_intent_created_check CHECK (event_created_at > 0),
    CONSTRAINT workspace_canvas_intent_digest_check CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT workspace_canvas_intent_bytes_check CHECK (content_bytes BETWEEN 0 AND 65536),
    CONSTRAINT workspace_canvas_intent_ack_check
        CHECK (relay_ack IN ('UNKNOWN', 'ACCEPTED', 'REJECTED', 'NOT_DELIVERED')),
    CONSTRAINT workspace_canvas_intent_outcome_check
        CHECK (outcome IS NULL OR outcome IN ('VERIFIED', 'NOT_WRITTEN')),
    CONSTRAINT workspace_canvas_intent_settled_check CHECK ((outcome IS NULL) = (settled_at IS NULL))
);
CREATE INDEX workspace_canvas_intent_by_workspace
    ON admission.workspace_canvas_intent (tenant_id, workspace_id, created_at);
