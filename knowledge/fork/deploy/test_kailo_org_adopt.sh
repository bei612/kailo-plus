#!/usr/bin/env bash
# Repeatable test of kailo-org-adopt.sh/.sql against a disposable copy of the
# native Postgres (same paradedb image as compose.yaml) migrated with this
# tree's migrations by the native image's migrate tool. Needs Docker; runs on
# the CI node, never against a live database.
#
#   test_kailo_org_adopt.sh <knowledge-service image ref>
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
app_image=${1:?knowledge-service image providing /usr/local/bin/migrate}
pg_image=paradedb/paradedb@sha256:58bf87d2a6f1e72f56590b0f0ae1467e82c3f99ca203dde646672c8ac13148b2
docker=${DOCKER:-docker}
pg=kailo-adopt-test-$$
cleanup() { $docker rm -f "$pg" >/dev/null 2>&1 || true; }
trap cleanup EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

# No network of its own: the migrate container joins the database's
# namespace and reaches it on localhost.
$docker run -d --name "$pg" --network none --tmpfs /var/lib/postgresql/data \
    -e POSTGRES_USER=weknora -e POSTGRES_DB=weknora -e POSTGRES_PASSWORD=fixture "$pg_image" >/dev/null
for _ in $(seq 1 60); do
    $docker exec "$pg" pg_isready -U weknora -d weknora >/dev/null 2>&1 && break
    sleep 2
done
sleep 3
$docker run --rm --network "container:$pg" --entrypoint /usr/local/bin/migrate \
    -v "$here/../../migrations:/m:ro" "$app_image" \
    -path /m/versioned -database "postgres://weknora:fixture@127.0.0.1:5432/weknora?sslmode=disable" up >/dev/null

psql() { $docker exec -i "$pg" psql -X -q -At -v ON_ERROR_STOP=1 -U weknora -d weknora "$@"; }
psql <<'SQL'
INSERT INTO tenants (id, name, description, status) VALUES
  (10000, 'local-administrator''s Workspace', 'Default workspace', 'active'),
  (10002, '1-qa''s Workspace', 'Default workspace', 'active'),
  (10003, '2-qa''s Workspace', 'Default workspace', 'active');
INSERT INTO users (id, username, email, password_hash, tenant_id, preferences) VALUES
  ('u-admin', 'local-administrator', 'admin@test', 'x', 10000, '{}'),
  ('u-qa1', '1-qa', 'qa1@test', 'x', 10002, '{}'),
  ('u-qa2', '2-qa', 'qa2@test', 'x', 10003, '{"last_active_tenant_id": 10003}');
INSERT INTO tenant_members (user_id, tenant_id, role, status, joined_at) VALUES
  ('u-admin', 10000, 'owner', 'active', now()),
  ('u-qa1', 10002, 'owner', 'active', now()),
  ('u-qa2', 10003, 'owner', 'active', now());
INSERT INTO auth_tokens (id, user_id, token, token_type, expires_at, is_revoked) VALUES
  ('t-qa2', 'u-qa2', 'jwt-qa2', 'access_token', now() + interval '1 day', false);
INSERT INTO knowledge_bases (id, name, tenant_id) VALUES
  ('kb-greenhouse', 'r-accept-星河兰花温室', 10002),
  ('kb-conformance', 'CONFORMANCE_ONLY receiver', 10000);
SQL

adopt() {
    KNOWLEDGE_POSTGRES_CONTAINER=$pg DOCKER=$docker bash "$here/kailo-org-adopt.sh" "$@" \
        --kailo-tenant-id 6179e160-tenant --kailo-tenant-name 'Kailo 验证' \
        --adopt-space 10002 --retire-space 10003 --attach-space 10000
}
backups=$(mktemp -d)
trap 'cleanup; rm -rf "$backups"' EXIT

plan=$(adopt plan)
echo "$plan" | grep -q 'plan only (rolled back)' || fail "plan did not roll back"
[ "$(psql -c "SELECT count(*) FROM tenants WHERE kailo_scope_ref IS NOT NULL")" = 0 ] || fail "plan changed data"

adopt apply --backup-dir "$backups" | tee /dev/stderr | grep -q 'kailo-org-adopt: applied' || fail "apply did not commit"
ls "$backups"/*.dump >/dev/null || fail "no backup before apply"
[ "$(psql -c "SELECT kailo_scope_ref || '|' || name FROM tenants WHERE id = 10002")" = 'tenant:6179e160-tenant|Kailo 验证' ] || fail "space not adopted"
[ "$(psql -c "SELECT tenant_id FROM knowledge_bases WHERE id = 'kb-greenhouse'")" = 10002 ] || fail "knowledge base moved"
[ "$(psql -c "SELECT deleted_at IS NOT NULL FROM tenants WHERE id = 10003")" = t ] || fail "empty space not retired"
[ "$(psql -c "SELECT count(*) FROM tenant_members WHERE tenant_id = 10003 AND deleted_at IS NULL")" = 0 ] || fail "retired memberships kept"
[ "$(psql -c "SELECT coalesce(tenant_id::text, 'null') || '|' || (preferences ? 'last_active_tenant_id')::text FROM users WHERE id = 'u-qa2'")" = 'null|false' ] || fail "home pointers kept"
[ "$(psql -c "SELECT is_revoked FROM auth_tokens WHERE id = 't-qa2'")" = t ] || fail "sessions of retired space kept"
[ "$(psql -c "SELECT count(*) FROM organizations WHERE kailo_tenant_ref = '6179e160-tenant'")" = 1 ] || fail "organisation missing"
[ "$(psql -c "SELECT string_agg(m.tenant_id || ':' || m.role, ',' ORDER BY m.tenant_id) FROM organization_tenant_members m JOIN organizations o ON o.id = m.organization_id WHERE o.kailo_tenant_ref = '6179e160-tenant'")" = '10000:editor,10002:admin' ] || fail "organisation spaces"

# Repeatable: the same plan again changes nothing.
snapshot() { psql -c "SELECT md5(string_agg(t::text, ',' ORDER BY t.id)) FROM tenants t" ; psql -c "SELECT count(*) FROM organization_tenant_members"; }
before=$(snapshot)
adopt apply --backup-dir "$backups" | grep -q 'space 10002 unchanged' || fail "second apply not idempotent"
[ "$(snapshot)" = "$before" ] || fail "second apply changed data"

# A space with content is never retired.
psql -c "UPDATE tenants SET deleted_at = NULL WHERE id = 10003" >/dev/null
psql -c "INSERT INTO knowledge_bases (id, name, tenant_id) VALUES ('kb-qa2', 'qa2', 10003)" >/dev/null
if adopt plan >/dev/null 2>&1; then fail "retiring a space with content was accepted"; fi
# Another space cannot take over an adopted Kailo Tenant.
if KNOWLEDGE_POSTGRES_CONTAINER=$pg DOCKER=$docker bash "$here/kailo-org-adopt.sh" plan \
    --kailo-tenant-id 6179e160-tenant --kailo-tenant-name X --adopt-space 10000 >/dev/null 2>&1; then
    fail "second space adopted for the same Kailo Tenant"
fi
echo "kailo-org-adopt: all checks passed"
