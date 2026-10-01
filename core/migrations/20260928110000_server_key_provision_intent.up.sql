-- SERVER HUMAN 初建与重建：在 OpenBao 写入前冻结 ActionExecution 的唯一 KV 路径。
-- 这不是第二份密钥权威；私钥、公钥和 KV 版本都不写进意图表。
CREATE TABLE admission.server_key_provision_intent (
    action_execution_id uuid PRIMARY KEY REFERENCES admission.action_execution (id),
    tenant_id           uuid NOT NULL REFERENCES identity.tenant (id),
    principal_id        uuid NOT NULL REFERENCES identity.principal (id),
    target_locator      text NOT NULL UNIQUE,
    source_membership_id uuid,
    source_membership_version integer,
    source_membership_scope text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    finished_at         timestamptz,
    CONSTRAINT server_key_provision_source_shape CHECK (
        (source_membership_id IS NULL AND source_membership_version IS NULL
         AND source_membership_scope IS NULL)
        OR (source_membership_id IS NOT NULL AND source_membership_version > 0
            AND source_membership_scope IN ('TENANT', 'WORKSPACE'))
    )
);

-- 同一 HUMAN 的初建与重建不能并发写入两个独立 KV 路径。
CREATE UNIQUE INDEX server_key_provision_one_open_principal
    ON admission.server_key_provision_intent (tenant_id, principal_id)
    WHERE finished_at IS NULL;
