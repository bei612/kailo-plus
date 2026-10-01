DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM admission.action_execution
        WHERE action_key IN ('task.rerun.identity.client_key.register.v1',
                             'task.rerun.identity.client_key.revoke.v1')
    ) THEN
        RAISE EXCEPTION '已有身份重跑事实，不能删除其确切 Catalog 定义'
            USING ERRCODE = 'check_violation';
    END IF;
END;
$$;

DELETE FROM catalog.action_definition
WHERE version = 1
  AND action_key IN ('task.rerun.identity.client_key.register.v1',
                     'task.rerun.identity.client_key.revoke.v1');
