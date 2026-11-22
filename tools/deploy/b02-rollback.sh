#!/bin/bash
# b02-rollback.sh <snapshot dir from b02-deploy.sh> [commit to return to, default 850f9942d4]: snapshot rollback of the
# 2026-11-15 batch deploy (运维/部署批次-2026-11-15.md §3). Writes made after the snapshot are lost.
#   1. pause the probe timer (enabled and active again at the end, G-10); stop edge and the application services
#   2. if principal-rekey already re-keyed the stores outside Postgres, put objects and search documents back to the
#      upstream IDs with the new release's `kailo_principal_rekey restore` (it reads the map in the migrated macrodb)
#   3. stop Keycloak, SpiceDB and Temporal; recreate macrodb, keycloak, spicedb, temporal, temporal_visibility from the
#      snapshots (each database dropped and created with its owner, then pg_restore); the operator model catalog back
#   4. check out the old commit, recreate ElasticMQ with its queues, up.sh up --no-build (old images come back from
#      the release registry), probe
set -euo pipefail
B=${1:?snapshot dir}; old=${2:-850f9942d4}
export DOCKER_HOST=unix:///run/kailo-docker/docker.sock KAILO_STATE_DIR=/volumes/kailo/deploy/kailo
repo=/volumes/kailo/kailo-macro up=$repo/kailo/deploy/up.sh st=$KAILO_STATE_DIR
log() { echo "$(date -u +%T) $*"; }
for f in macrodb keycloak spicedb temporal temporal_visibility; do [ -s "$B/$f.dump" ] || { log "missing $B/$f.dump"; exit 1; }; done
[ -s "$B/catalog.json" ] || { log "missing $B/catalog.json"; exit 1; }
# G-10: paused for the window, enabled and active again when the rollback ends (probe-timer.sh).
. "$(dirname "$(readlink -f "$0")")/probe-timer.sh"
probe_pause
trap 'probe_on || log "WARNING: kailo-probe.timer is not enabled and active"' EXIT
infra='postgres|platform-postgres|redis|kafka|search|elasticmq|openbao|mailpit|minio|keycloak|temporal|spicedb|sandbox-docker|codex-agent|.*-init|db-migrate|search-indices|kafka-topics|temporal-db-init|temporal-schema|temporal-namespace|temporal-align-schedules|spicedb-db-init|spicedb-migrate|spicedb-schema|keycloak-db-init|principal-rekey'
log "1. stop edge and the application services"
$up compose stop edge
$up compose stop $($up compose config --services 2>/dev/null | grep -vxE "$infra")
log "2. stores outside Postgres back to upstream IDs (only if the re-key ran)"
mapped=$(docker exec -i kailo-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d macrodb -At -f -' <<<"select to_regclass('kailo_principal_id_map') is not null")
if [ "$mapped" = t ] && $up compose config --services 2>/dev/null | grep -qx principal-rekey; then
  $up compose run --rm principal-rekey /app/out/kailo_principal_rekey restore | tee "$B/principal-rekey-restore.json"
else
  log "  re-key did not run; nothing to restore outside Postgres"
fi
log "3. databases and catalog from $B"
$up compose stop keycloak spicedb temporal 2>/dev/null || true
restore() {  # <container> <db>
  local owner
  owner=$(docker exec $1 sh -c "psql -U \"\$POSTGRES_USER\" -d postgres -Atc \"select r.rolname from pg_database d join pg_roles r on r.oid=d.datdba where datname='$2'\"")
  [ -n "$owner" ] || { log "no owner for $2"; exit 1; }
  docker exec $1 sh -c "dropdb -U \"\$POSTGRES_USER\" --force $2 && createdb -U \"\$POSTGRES_USER\" -O $owner $2"
  docker exec -i $1 sh -c "pg_restore -U \"\$POSTGRES_USER\" -d $2 --exit-on-error" < "$B/$2.dump"
  log "  $2 restored (owner $owner)"
}
restore kailo-postgres-1 macrodb
for db in keycloak spicedb temporal temporal_visibility; do restore kailo-platform-postgres-1 $db; done
cp -a "$B/catalog.json" "$st/models/catalog.json"
log "4. back to $old"
git -C $repo checkout -q -B deploy "$old"
$up compose up -d --no-deps --force-recreate --wait elasticmq
$up up --no-build
KAILO_STATE_DIR=$KAILO_STATE_DIR $repo/kailo/deploy/probe.sh
probe_assert
log "rolled back to $old"
