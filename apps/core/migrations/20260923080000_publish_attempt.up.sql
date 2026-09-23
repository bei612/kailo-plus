-- 代签发布的幂等键（DD-81）。同一人以同一个键重发时，Core 不再发第二条，而是回答
-- 原操作的结论——正文不进 Core，已签事件无从重发，能做的就是不重复。
-- 行在其操作有结论且超过保留期后由对账作业清除。
CREATE TABLE admission.publish_attempt (
    tenant_principal_id uuid        NOT NULL REFERENCES identity.principal (id),
    idempotency_key     uuid        NOT NULL,
    operation_id        uuid        NOT NULL,
    event_id            text        NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_principal_id, idempotency_key)
);
CREATE INDEX publish_attempt_age ON admission.publish_attempt (created_at);
