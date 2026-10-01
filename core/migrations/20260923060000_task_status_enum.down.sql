DROP INDEX projection.workflow_ref_nonterminal;
ALTER TABLE projection.workflow_ref DROP COLUMN last_observed_at;
ALTER TABLE projection.task_projection DROP CONSTRAINT task_status_enum;
