-- DD-131(2)、(7)（2026-10-23 裁定）：快照包内联头像不再丢弃。上传时以导入人身份按附件规则存为
-- 本 Tenant Community 的内容寻址媒体对象，暂存只记对象地址、回执摘要与包内头像字节摘要；
-- Workflow 重读包时以后者确认仍是同一份头像，DRAFT personaIdentity 只引用该对象。
ALTER TABLE admission.transfer_upload
    ADD COLUMN avatar_url text,
    ADD COLUMN avatar_media_sha256 text
        CONSTRAINT transfer_upload_avatar_media_sha256 CHECK (avatar_media_sha256 ~ '^[0-9a-f]{64}$'),
    ADD COLUMN avatar_source_digest text
        CONSTRAINT transfer_upload_avatar_source_digest CHECK (avatar_source_digest ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT transfer_upload_avatar_all_or_none CHECK (
        (avatar_url IS NULL) = (avatar_media_sha256 IS NULL)
        AND (avatar_url IS NULL) = (avatar_source_digest IS NULL)
        AND (avatar_url IS NULL OR avatar_url ~ ('/media/' || avatar_media_sha256 || '(\.[A-Za-z0-9]+)?$'))
    );
