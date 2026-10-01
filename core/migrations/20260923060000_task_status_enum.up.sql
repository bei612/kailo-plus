-- TaskProjection.status 收为封闭枚举（contracts/enums/task_status.schema.json）。
-- 约束值与契约逐值相等，由 check.sh 校验。此前 Worker 只写过 RUNNING、
-- COMPLETED、FAILED，均在集合内。
ALTER TABLE projection.task_projection ADD CONSTRAINT task_status_enum CHECK (status IN
    ('RUNNING','COMPLETED','FAILED','CANCELED','TERMINATED','TIMED_OUT'));

-- 兜底对账只扫非终态的 WorkflowRef（.design/06 §3.1）。终态行只增不减，
-- 不加部分索引时每一轮都要走全表。
-- 每轮按「最久未被观察」取一批：否则一条长期重试中的 Workflow 会永远排在
-- 最前，把其余的挤出批次。
ALTER TABLE projection.workflow_ref ADD COLUMN last_observed_at timestamptz;
CREATE INDEX workflow_ref_nonterminal
    ON projection.workflow_ref (coalesce(last_observed_at, created_at))
    WHERE projection_state <> 'TERMINAL';
