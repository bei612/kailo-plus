-- Stop rollback once an external identity exists. Dropping its binding would
-- re-enable email-based identity resolution in the old binary.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM users WHERE oidc_issuer IS NOT NULL OR oidc_subject IS NOT NULL) THEN
        RAISE EXCEPTION 'cannot roll back native OIDC identity with bound accounts';
    END IF;
END $$;
DROP TRIGGER users_oidc_identity_immutable ON users;
DROP FUNCTION guard_users_oidc_identity();
DROP INDEX idx_users_oidc_identity;
ALTER TABLE users DROP CONSTRAINT users_oidc_identity_pair;
ALTER TABLE users DROP COLUMN oidc_subject;
ALTER TABLE users DROP COLUMN oidc_issuer;
