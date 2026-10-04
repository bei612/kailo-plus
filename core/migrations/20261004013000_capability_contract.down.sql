-- 已登记内容/ActionExecution 不能被回退删除；旧 writer 仍兼容，停止发布再处置。
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM catalog.capability_category)
    OR EXISTS (SELECT 1 FROM admission.action_execution WHERE action_key IN
      ('capability_contract.register','capability_contract.approve','capability_contract.deprecate')) THEN
  RAISE EXCEPTION 'capability contracts or original actions exist: refuse rollback' USING ERRCODE='23514';
 END IF;
END $$;
DELETE FROM catalog.action_definition WHERE action_key IN
 ('capability_contract.register','capability_contract.approve','capability_contract.deprecate');
DELETE FROM catalog.approval_policy WHERE id='4c0c8a5f-d70b-541d-a6af-65a0c84cbbab';
DROP TABLE catalog.capability_contract;
DROP TABLE catalog.capability_category;
DROP FUNCTION catalog.guard_capability_contract();
DROP FUNCTION catalog.guard_capability_category();
