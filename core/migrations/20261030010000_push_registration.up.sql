-- DD-151: Mobile push through the platform's own channel.
--
-- PushRegistration is the device's own preference (DD-40 version CAS), keyed by the device
-- CLIENT public key (DD-79). The provider token itself lives only in the Tenant's OpenBao
-- (token_secret_*); this table keeps its SHA-256 digest so a re-registration of the same
-- token is recognised without reading the secret back.
CREATE TABLE identity.push_registration (
    tenant_id              uuid        NOT NULL REFERENCES identity.tenant (id),
    device_pubkey          text        NOT NULL CHECK (device_pubkey ~ '^[0-9a-f]{64}$'),
    tenant_principal_id    uuid        NOT NULL REFERENCES identity.principal (id),
    platform               text        NOT NULL CONSTRAINT push_platform_enum CHECK (platform IN ('APNS','FCM')),
    app_id                 text        NOT NULL CHECK (app_id ~ '^[A-Za-z0-9._-]{1,200}$'),
    locale                 text        NOT NULL CHECK (locale IN ('en','zh-CN')),
    token_digest           text        CHECK (token_digest ~ '^[0-9a-f]{64}$'),
    token_secret_locator   text,
    token_secret_version   integer,
    token_secret_audience  text,
    enabled                boolean     NOT NULL,
    state                  text        NOT NULL CONSTRAINT push_registration_state_enum CHECK (state IN ('ACTIVE','INVALID','REVOKED')),
    version                integer     NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, device_pubkey),
    -- The three SecretRef columns are all present or all absent; a REVOKED registration
    -- has neither the token nor its reference (the OpenBao version is destroyed).
    CONSTRAINT push_registration_token_ref CHECK (
        (token_secret_locator IS NULL) = (token_secret_version IS NULL)
        AND (token_secret_locator IS NULL) = (token_secret_audience IS NULL)
        AND (token_secret_locator IS NULL) = (token_digest IS NULL)),
    CONSTRAINT push_registration_revoked_has_no_token CHECK (
        state <> 'REVOKED' OR (token_secret_locator IS NULL AND NOT enabled)),
    CONSTRAINT push_registration_active_has_token CHECK (
        state <> 'ACTIVE' OR token_secret_locator IS NOT NULL)
);
CREATE INDEX push_registration_deliverable ON identity.push_registration (tenant_id, tenant_principal_id)
    WHERE state = 'ACTIVE' AND enabled;

-- Per-Tenant read position over the Relay message stream (DD-151(3)). `since` is the newest
-- created_at already handled and `seen_ids` the event ids handled at exactly that second, so
-- a repeated query never pushes the same event twice. New Tenants start at "now": history
-- is never pushed.
CREATE TABLE projection.push_cursor (
    tenant_id   uuid        PRIMARY KEY REFERENCES identity.tenant (id),
    since       bigint      NOT NULL CHECK (since >= 0),
    seen_ids    text[]      NOT NULL DEFAULT '{}',
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Collapse and rate limits (DD-151(5)): one row per device and collapse key holds the last
-- delivery; the row with collapse_key '*' carries the device-wide one-minute window.
CREATE TABLE projection.push_delivery_window (
    tenant_id      uuid        NOT NULL,
    device_pubkey  text        NOT NULL,
    collapse_key   text        NOT NULL CHECK (length(collapse_key) BETWEEN 1 AND 64),
    last_sent_at   timestamptz NOT NULL,
    window_start   timestamptz NOT NULL,
    window_count   integer     NOT NULL DEFAULT 0 CHECK (window_count >= 0),
    PRIMARY KEY (tenant_id, device_pubkey, collapse_key),
    FOREIGN KEY (tenant_id, device_pubkey)
        REFERENCES identity.push_registration (tenant_id, device_pubkey) ON DELETE CASCADE
);
