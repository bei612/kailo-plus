ALTER TABLE identity.buzz_identity_binding
    DROP CONSTRAINT IF EXISTS custody_matches_secret_triple,
    DROP COLUMN IF EXISTS private_key_secret_audience,
    DROP COLUMN IF EXISTS private_key_secret_version;
