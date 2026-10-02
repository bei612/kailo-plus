-- DD-21、03 §3/8、11 §4：Core 仅持久已知外部流的恢复游标。
-- Gateway request log/outbox 保持原生权威；不建第二 usage/outbox/额度账本。
CREATE TABLE projection.ingress_checkpoint (
    source_key text PRIMARY KEY CHECK (source_key <> ''),
    tenant_id uuid REFERENCES identity.tenant(id),
    cursor text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
