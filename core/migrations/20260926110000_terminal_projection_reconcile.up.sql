-- 有界轮转核查已标 TERMINAL 的 WorkflowRef，避免每轮全表扫描历史任务。
-- 与既有 workflow_ref_nonterminal 互补，不改变 Workflow/TaskProjection 权威。
CREATE INDEX workflow_ref_terminal_observation
    ON projection.workflow_ref (coalesce(last_observed_at, created_at))
    WHERE projection_state = 'TERMINAL';
