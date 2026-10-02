ALTER TABLE projection.tenant_buzz_binding
    DROP CONSTRAINT IF EXISTS relay_self_pubkey_is_hex,
    DROP COLUMN IF EXISTS relay_self_pubkey;
