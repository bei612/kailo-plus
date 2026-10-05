-- Kailo native identity seam: email is profile data, never an identity alias.
-- Existing local / legacy OIDC users remain unbound; do not infer a subject
-- from email, username or a platform role.
ALTER TABLE users ADD COLUMN oidc_issuer TEXT;
ALTER TABLE users ADD COLUMN oidc_subject TEXT;
ALTER TABLE users ADD CONSTRAINT users_oidc_identity_pair CHECK (
    (oidc_issuer IS NULL AND oidc_subject IS NULL) OR
    (oidc_issuer IS NOT NULL AND oidc_subject IS NOT NULL
     AND btrim(oidc_issuer) <> '' AND btrim(oidc_subject) <> '')
);
-- Include soft-deleted users: an external identity cannot be reassigned.
CREATE UNIQUE INDEX idx_users_oidc_identity ON users (oidc_issuer, oidc_subject);

CREATE FUNCTION guard_users_oidc_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.oidc_issuer IS DISTINCT FROM OLD.oidc_issuer OR
       NEW.oidc_subject IS DISTINCT FROM OLD.oidc_subject THEN
        RAISE EXCEPTION 'native OIDC identity is immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER users_oidc_identity_immutable
    BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION guard_users_oidc_identity();
