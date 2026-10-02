-- 管理历史仍被引用时不能移除其合同；不删除用户定义或历史AE来强行收缩。
DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM admission.action_execution WHERE action_key IN
        ('automation.create','automation.publish_version','automation.enable','automation.pause','automation.disable'))
       OR EXISTS(SELECT 1 FROM catalog.resource WHERE type_key='automation') THEN
        RAISE EXCEPTION 'Automation管理仍有真实事实，停止收缩' USING ERRCODE='restrict_violation';
    END IF;
END $$;
DELETE FROM catalog.action_definition WHERE action_key IN
    ('automation.create','automation.publish_version','automation.enable','automation.pause','automation.disable')
    AND version=1;
UPDATE catalog.resource_type_definition SET status='DRAFT' WHERE type_key='automation' AND status='ACTIVE';
