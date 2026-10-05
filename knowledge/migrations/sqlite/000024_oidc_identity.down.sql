-- Refuse to lose any real native identity (including a deleted account).
CREATE TEMP TABLE oidc_rollback_guard (value INTEGER);
CREATE TEMP TRIGGER oidc_rollback_refusal BEFORE INSERT ON oidc_rollback_guard
WHEN EXISTS (SELECT 1 FROM users WHERE oidc_issuer IS NOT NULL OR oidc_subject IS NOT NULL)
BEGIN
    SELECT RAISE(ABORT, 'cannot roll back native OIDC identity with bound accounts');
END;
INSERT INTO oidc_rollback_guard VALUES (1);
DROP TRIGGER oidc_rollback_refusal;
DROP TABLE oidc_rollback_guard;
DROP TRIGGER users_oidc_identity_immutable;
DROP INDEX idx_users_oidc_identity;
ALTER TABLE users DROP COLUMN oidc_subject;
ALTER TABLE users DROP COLUMN oidc_issuer;
