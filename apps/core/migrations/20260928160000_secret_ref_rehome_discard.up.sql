-- DD-85：COPIED 之后切换被确定拒绝时，目标 locator 版本 1 经 metadata 查证销毁，
-- 归位终结为 FAILED 并保留已销毁的新版本号，新 ref 记 DISCARDED。
ALTER TABLE admission.secret_ref_rehome
    DROP CONSTRAINT secret_ref_rehome_new_ref_status_check,
    DROP CONSTRAINT secret_ref_rehome_check,
    DROP CONSTRAINT secret_ref_rehome_check3,
    ADD CONSTRAINT secret_ref_rehome_new_ref_status_check
        CHECK (new_ref_status IN ('NONE','PENDING','ACTIVE','DISCARDED')),
    ADD CONSTRAINT secret_ref_rehome_new_ref_version_state
        CHECK ((state IN ('COPIED','SWITCHED','RETIRED') OR new_ref_status = 'DISCARDED')
               = (new_ref_version IS NOT NULL)),
    ADD CONSTRAINT secret_ref_rehome_new_ref_status_state
        CHECK ((state IN ('INTENT','COPY_UNKNOWN','FAILED') AND new_ref_status = 'NONE')
            OR (state = 'FAILED' AND new_ref_status = 'DISCARDED')
            OR (state = 'COPIED' AND new_ref_status = 'PENDING')
            OR (state IN ('SWITCHED','RETIRED') AND new_ref_status = 'ACTIVE'));
