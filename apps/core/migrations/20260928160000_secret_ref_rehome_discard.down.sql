-- 已丢弃副本的 FAILED 行无法表达为旧约束；存在时拒绝回滚而不是改写审计事实。
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM admission.secret_ref_rehome WHERE new_ref_status = 'DISCARDED') THEN
        RAISE EXCEPTION 'secret_ref_rehome 含 DISCARDED 行，不能回滚到旧约束';
    END IF;
END $$;
ALTER TABLE admission.secret_ref_rehome
    DROP CONSTRAINT secret_ref_rehome_new_ref_status_state,
    DROP CONSTRAINT secret_ref_rehome_new_ref_version_state,
    DROP CONSTRAINT secret_ref_rehome_new_ref_status_check,
    ADD CONSTRAINT secret_ref_rehome_new_ref_status_check
        CHECK (new_ref_status IN ('NONE','PENDING','ACTIVE')),
    ADD CONSTRAINT secret_ref_rehome_check
        CHECK ((state IN ('COPIED','SWITCHED','RETIRED')) = (new_ref_version IS NOT NULL)),
    ADD CONSTRAINT secret_ref_rehome_check3
        CHECK ((state IN ('INTENT','COPY_UNKNOWN','FAILED') AND new_ref_status = 'NONE')
            OR (state = 'COPIED' AND new_ref_status = 'PENDING')
            OR (state IN ('SWITCHED','RETIRED') AND new_ref_status = 'ACTIVE'));
