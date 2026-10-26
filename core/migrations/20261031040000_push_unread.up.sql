-- DD-151(4): accepted push messages derived from provider outcomes. read_contexts remains
-- the read authority. Event identity, not its second-resolution timestamp, deduplicates
-- replay and multiple devices. The worker retains the newest 999 events per read context.
CREATE TABLE projection.push_unread (
    tenant_id            uuid        NOT NULL REFERENCES identity.tenant (id),
    tenant_principal_id  uuid        NOT NULL REFERENCES identity.principal (id),
    event_id             text        NOT NULL CHECK (event_id ~ '^[0-9a-f]{64}$'),
    context_key          text        NOT NULL CHECK (context_key ~ '^([0-9a-f-]{1,64}|thread:[0-9a-f]{64})$'),
    channel_id           text        NOT NULL CHECK (channel_id ~ '^[0-9a-f-]{1,64}$'),
    created_at           bigint      NOT NULL CHECK (created_at >= 0),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, tenant_principal_id, event_id)
);
CREATE INDEX push_unread_context ON projection.push_unread
    (tenant_id, tenant_principal_id, context_key, created_at DESC, event_id DESC);
