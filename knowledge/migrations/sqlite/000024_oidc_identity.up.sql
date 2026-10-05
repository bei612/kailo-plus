-- Mirrors native Postgres migration 000104; SQLite remains supported by the
-- full native source but is not an admissible Redis-less Kailo binding.
ALTER TABLE users ADD COLUMN oidc_issuer TEXT;
ALTER TABLE users ADD COLUMN oidc_subject TEXT CHECK (
    (oidc_issuer IS NULL AND oidc_subject IS NULL) OR
    (oidc_issuer IS NOT NULL AND oidc_subject IS NOT NULL
     AND trim(oidc_issuer) <> '' AND trim(oidc_subject) <> '')
);
CREATE UNIQUE INDEX idx_users_oidc_identity ON users (oidc_issuer, oidc_subject);
CREATE TRIGGER users_oidc_identity_immutable BEFORE UPDATE ON users
WHEN NEW.oidc_issuer IS NOT OLD.oidc_issuer OR NEW.oidc_subject IS NOT OLD.oidc_subject
BEGIN
    SELECT RAISE(ABORT, 'native OIDC identity is immutable');
END;
