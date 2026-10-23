-- 头像暂存列只在没有引用它的暂存时撤回；不删除真实上传事实来强行收缩合同。
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM admission.transfer_upload WHERE avatar_url IS NOT NULL) THEN
        RAISE EXCEPTION 'transfer_upload 头像暂存已被真实上传引用，停止收缩'
            USING ERRCODE = 'restrict_violation';
    END IF;
END $$;

ALTER TABLE admission.transfer_upload
    DROP CONSTRAINT transfer_upload_avatar_all_or_none,
    DROP COLUMN avatar_source_digest,
    DROP COLUMN avatar_media_sha256,
    DROP COLUMN avatar_url;
