-- DD-127 回滚。停止发布条件：已存在空类别 binding（原生页面入口，含已 DISABLED
-- 的审计行）时不能回到要求非空类别的模型；这些行是入口 binding 的审计事实，不得
-- 删除或改写，迁移拒绝执行，只能前向修复。没有空类别 binding 时恢复原约束。
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM catalog.application_binding
               WHERE jsonb_array_length(capability_categories)=0) THEN
        RAISE EXCEPTION 'DD-127 回滚被拒：已存在原生页面入口 binding'
            USING ERRCODE='restrict_violation';
    END IF;
END $$;
DROP TRIGGER application_binding_native_page ON catalog.application_binding;
DROP FUNCTION catalog.guard_application_binding_native_page();
ALTER TABLE catalog.application_binding
    DROP CONSTRAINT application_binding_capability_categories_check;
ALTER TABLE catalog.application_binding
    ADD CONSTRAINT application_binding_capability_categories_check
    CHECK (jsonb_typeof(capability_categories)='array' AND jsonb_array_length(capability_categories)>0);
