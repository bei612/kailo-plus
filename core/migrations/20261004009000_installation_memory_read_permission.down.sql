DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM admission.action_execution
   WHERE action_key IN ('resource.grant_read','resource.revoke_read')) THEN
   RAISE EXCEPTION 'Memory reader permission 历史已存在，停止回滚；不得删除关系意图或审计事实';
 END IF;
END $$;
DELETE FROM catalog.action_definition WHERE action_key IN ('resource.grant_read','resource.revoke_read');
DELETE FROM catalog.approval_policy WHERE action_key='resource.grant_read';
