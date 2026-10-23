-- 只在团队快照合同尚未被真实事实引用时回退；不删除真实导出、导入或暂存来强行收缩合同。
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM admission.action_execution
               WHERE action_key IN ('agent.team.export','agent.team.import'))
        OR EXISTS (SELECT 1 FROM admission.transfer_upload WHERE format_key = 'buzz-team-snapshot@1')
        OR EXISTS (SELECT 1 FROM catalog.export_package WHERE format_key = 'buzz-team-snapshot@1') THEN
        RAISE EXCEPTION 'agent.team 快照合同已被真实事实引用，停止收缩'
            USING ERRCODE = 'restrict_violation';
    END IF;
END $$;

DELETE FROM catalog.transfer_format WHERE format_key = 'buzz-team-snapshot@1';
DELETE FROM catalog.action_definition
 WHERE action_key IN ('agent.team.export','agent.team.import') AND version = 1;
DELETE FROM catalog.approval_policy WHERE action_key = 'agent.team.export';

DROP TABLE admission.transfer_upload_member_avatar;
ALTER TABLE admission.transfer_upload DROP CONSTRAINT transfer_upload_team_avatar_per_member;
ALTER TABLE admission.transfer_upload DROP CONSTRAINT transfer_upload_json_size;
ALTER TABLE admission.transfer_upload DROP CONSTRAINT transfer_upload_package_size;
ALTER TABLE admission.transfer_upload ADD CONSTRAINT transfer_upload_package_byte_size_check
    CHECK (package_byte_size > 0 AND package_byte_size <= 10485760);
ALTER TABLE admission.transfer_upload ADD CONSTRAINT transfer_upload_check1
    CHECK (media_type = 'image/png' OR package_byte_size <= 5242880);
ALTER TABLE admission.transfer_upload DROP CONSTRAINT transfer_upload_format_enum;
ALTER TABLE admission.transfer_upload ADD CONSTRAINT transfer_upload_format_enum
    CHECK (format_key IN ('buzz-agent-snapshot@1'));
