ALTER TABLE identity.relay_operator_identity
    DROP CONSTRAINT IF EXISTS active_requires_secret_triple,
    DROP COLUMN IF EXISTS private_key_secret_audience,
    DROP COLUMN IF EXISTS private_key_secret_version;
