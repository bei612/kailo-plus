-- 已被消费的停用动作保留其定义与审计；只在没有执行记录时撤回登记。
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM admission.action_execution WHERE action_key='llm_route.disable') THEN
        RAISE EXCEPTION 'llm_route.disable 已被消费，不能撤回其登记' USING ERRCODE='restrict_violation';
    END IF;
END $$;
DELETE FROM catalog.action_definition WHERE action_key='llm_route.disable' AND version=1;
