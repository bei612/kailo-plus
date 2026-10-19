-- DD-125(5)、09 §3、V-SCN-139：Web 原 composer 链接预览由 BFF 代为抓取。
--
-- 1. admission.link_preview_snapshot：BFF 短期持有、绑定本人（Tenant + Principal）与
--    Community host 的快照，字段即原 11 元素 link-preview snapshot 标签（版本 1）的内容。
--    图片与 favicon 只是本人上传的 Relay 媒体引用。expires_at 之后发布不可引用，由发布
--    对账节拍清除。它不是消息正文：正文仍不进 Core。
-- 2. admission.publish_attempt 冻结发布引用的快照 ID 与抑制标记（原 link-preview none）：
--    同一幂等键改引用其他快照或改抑制即 409。快照只随新的 kind 9；抑制随 kind 9 或
--    本人消息的 40003（原“对所有人移除预览”）。旧 writer 写默认值，原语义不变。
CREATE TABLE admission.link_preview_snapshot (
    id                  uuid        NOT NULL,
    tenant_id           uuid        NOT NULL REFERENCES identity.tenant (id),
    tenant_principal_id uuid        NOT NULL REFERENCES identity.principal (id),
    community_host      text        NOT NULL,
    canonical_url       text        NOT NULL,
    title               text        NOT NULL,
    site_name           text        NOT NULL,
    description         text        NOT NULL,
    image_url           text        NOT NULL,
    image_sha256        text        NOT NULL,
    favicon_url         text        NOT NULL,
    favicon_sha256      text        NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz NOT NULL,
    CONSTRAINT link_preview_snapshot_pkey PRIMARY KEY (id),
    CONSTRAINT link_preview_snapshot_host_check CHECK (community_host <> ''),
    CONSTRAINT link_preview_snapshot_url_check
        CHECK (canonical_url ~ '^https://' AND position('#' in canonical_url) = 0
               AND octet_length(canonical_url) <= 2048),
    CONSTRAINT link_preview_snapshot_text_check
        CHECK (octet_length(title) <= 300 AND octet_length(site_name) <= 100
               AND octet_length(description) <= 1000),
    CONSTRAINT link_preview_snapshot_image_check
        CHECK ((image_url = '' AND image_sha256 = '')
               OR (image_url <> '' AND image_sha256 ~ '^[0-9a-f]{64}$')),
    CONSTRAINT link_preview_snapshot_favicon_check
        CHECK ((favicon_url = '' AND favicon_sha256 = '')
               OR (favicon_url <> '' AND favicon_sha256 ~ '^[0-9a-f]{64}$')),
    CONSTRAINT link_preview_snapshot_expiry_check CHECK (expires_at > created_at)
);
CREATE INDEX link_preview_snapshot_owner
    ON admission.link_preview_snapshot (tenant_id, tenant_principal_id, created_at);
CREATE INDEX link_preview_snapshot_expiry ON admission.link_preview_snapshot (expires_at);

ALTER TABLE admission.publish_attempt
    ADD COLUMN link_preview_snapshot_ids uuid[] NOT NULL DEFAULT '{}',
    ADD COLUMN suppress_link_previews boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT publish_link_preview_shape CHECK (
        cardinality(link_preview_snapshot_ids) <= 8
        AND array_position(link_preview_snapshot_ids, NULL) IS NULL
        AND (cardinality(link_preview_snapshot_ids) = 0
             OR (message_kind = 9 AND NOT suppress_link_previews AND edit_event_id IS NULL
                 AND delete_event_id IS NULL AND send_to_channel_source_event_id IS NULL))
        AND (NOT suppress_link_previews
             OR (message_kind IN (9, 40003) AND delete_event_id IS NULL
                 AND send_to_channel_source_event_id IS NULL)));
