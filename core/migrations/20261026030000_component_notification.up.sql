-- DD-138(4)：ComponentNotification（.design/03 §3，07 §4.8.3）。组件经成员目录同一服务
-- 身份投递给 Kailo 收件箱的一条通知；Core 是唯一权威，没有 Relay 投影。
--
-- 归 identity：与 collaboration_user_state 同理，它按接收人 Principal 归属、Core 即权威，
-- 不是任何上游的投影。它不是 Resource：没有 owner、不写 SpiceDB 关系、不授予权限。
CREATE TABLE identity.component_notification (
    id                     uuid        PRIMARY KEY,
    tenant_id              uuid        NOT NULL REFERENCES identity.tenant (id),
    application_binding_id uuid        NOT NULL REFERENCES catalog.application_binding (id),
    -- 取 binding 的 Workspace；Tenant binding 为空。
    workspace_id           uuid        REFERENCES identity.workspace (id),
    recipient_principal_id uuid        NOT NULL REFERENCES identity.principal (id),
    actor_principal_id     uuid        REFERENCES identity.principal (id),
    idempotency_key        text        NOT NULL,
    -- 投递请求体规范 JSON 的 SHA-256（hex）；同键异摘要的投递被拒绝而不覆写。
    content_digest         text        NOT NULL,
    category               text        NOT NULL,
    title                  jsonb       NOT NULL,
    summary                jsonb,
    path                   text        NOT NULL,
    occurred_at            timestamptz NOT NULL,
    received_at            timestamptz NOT NULL DEFAULT now(),
    read_at                timestamptz,

    CONSTRAINT component_notification_idempotency UNIQUE (application_binding_id, idempotency_key),
    CONSTRAINT component_notification_category_enum CHECK (category IN
        ('SHARED','MENTIONED','COMMENTED','ACCESS_REQUESTED','TASK_COMPLETED','CONTENT_UPDATED')),
    CONSTRAINT component_notification_key_shape CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{1,128}$'),
    CONSTRAINT component_notification_digest_shape CHECK (content_digest ~ '^[0-9a-f]{64}$'),
    -- 形状由写入路径逐项校验；库里只兜底对象形状、长度与相对路径前缀。
    CONSTRAINT component_notification_title_shape CHECK (jsonb_typeof(title) = 'object'
        AND title ?& array['ZH_CN','EN']),
    CONSTRAINT component_notification_summary_shape CHECK (summary IS NULL OR (jsonb_typeof(summary) = 'object'
        AND summary ?& array['ZH_CN','EN'])),
    CONSTRAINT component_notification_path_shape CHECK (char_length(path) BETWEEN 1 AND 1024
        AND path LIKE '/%' AND path NOT LIKE '//%'),
    CONSTRAINT component_notification_actor_not_recipient CHECK (actor_principal_id IS DISTINCT FROM recipient_principal_id),
    CONSTRAINT component_notification_read_after_receipt CHECK (read_at IS NULL OR read_at >= received_at)
);

-- 收件箱分页：本人在本 Tenant 内按接收时间倒序。
CREATE INDEX component_notification_inbox
    ON identity.component_notification (tenant_id, recipient_principal_id, received_at DESC, id DESC);
-- 本人未读计数。
CREATE INDEX component_notification_unread
    ON identity.component_notification (recipient_principal_id, application_binding_id)
    WHERE read_at IS NULL;
-- 按 binding 的 60 秒限流计数，与 90 天保留清理。
CREATE INDEX component_notification_binding_received
    ON identity.component_notification (application_binding_id, received_at);
CREATE INDEX component_notification_retention
    ON identity.component_notification (received_at);
