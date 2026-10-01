-- 已有经治理准入产生的动作或审批时拒绝回退：删掉它们等于抹去「谁因何被允许」的
-- 准入事实，而 ActionExecution 本身不随回退删除。
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM admission.action_execution
               WHERE idempotency_key IS NOT NULL OR approval_workflow_id IS NOT NULL) THEN
        RAISE EXCEPTION '存在经治理准入产生的 ActionExecution，不能回退';
    END IF;
    IF EXISTS (SELECT action_execution_id FROM projection.workflow_ref
               GROUP BY action_execution_id HAVING count(*) > 1) THEN
        RAISE EXCEPTION '存在同一 ActionExecution 的多个 WorkflowRef，不能恢复旧唯一约束';
    END IF;
END $$;

DROP TABLE projection.approval_projection;
ALTER TABLE projection.workflow_ref DROP CONSTRAINT workflow_ref_one_per_type;
ALTER TABLE projection.workflow_ref ADD CONSTRAINT workflow_ref_action_execution_id_key UNIQUE (action_execution_id);

DROP TABLE admission.action_decision;
DROP FUNCTION admission.reject_decision_mutation();
DROP DOMAIN admission.decision_outcome;

DROP INDEX admission.action_execution_open;
DROP INDEX admission.action_execution_one_pending_per_target;
DROP INDEX admission.action_execution_idempotency;
ALTER TABLE admission.action_execution
    DROP CONSTRAINT waiting_requires_approval,
    DROP COLUMN updated_at,
    DROP COLUMN reason_code,
    DROP COLUMN approval_expires_at,
    DROP COLUMN approval_workflow_id,
    DROP COLUMN idempotency_key,
    DROP COLUMN parameters;

DROP TABLE catalog.action_definition;
DROP TABLE catalog.approval_policy;
DROP FUNCTION catalog.guard_version();
