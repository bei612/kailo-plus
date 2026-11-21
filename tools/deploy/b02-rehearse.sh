#!/bin/bash
# b02-rehearse.sh: timing rehearsal of the B-02a/B-02b first deploy runbook on copies (read-only on the live data).
set -uo pipefail
export DOCKER_HOST=unix:///run/kailo-docker/docker.sock
W=/volumes/data/kailo/capacity/backup/b02-rehearsal-$(date -u +%Y%m%dT%H%M%SZ); mkdir -p $W
log() { echo "$(date -u +%T) $*"; }
t() { local s=$(date +%s%N); "$@"; local rc=$?; local e=$(( ($(date +%s%N) - s) / 1000000 )); echo "  ${e} ms rc=$rc"; return $rc; }
st=/volumes/kailo/deploy/kailo
kc_db=keycloak  # KC_DB_URL jdbc:postgresql://platform-postgres:5432/keycloak (keycloak.compose.yaml)
log "1. snapshots (live, read-only): macrodb and Keycloak DB ${kc_db:-?}"
t sh -c "docker exec kailo-postgres-1 sh -c 'pg_dump -U \"\$POSTGRES_USER\" -Fc macrodb' > $W/macrodb.dump"
t sh -c "docker exec kailo-platform-postgres-1 sh -c 'pg_dump -U \"\$POSTGRES_USER\" -Fc ${kc_db:-keycloak}' > $W/keycloak.dump"
ls -la $W/*.dump | awk '{print "  "$5" "$9}'
log "2. restore timing into throwaway Postgres containers"
for db in macrodb ${kc_db:-keycloak}; do
  img=$(docker inspect -f '{{.Config.Image}}' $( [ $db = macrodb ] && echo kailo-postgres-1 || echo kailo-platform-postgres-1))
  docker rm -f b02r-$db >/dev/null 2>&1
  docker run -d --name b02r-$db --network none --cpus 2 --memory 2g --tmpfs /var/lib/postgresql:size=4g -e POSTGRES_PASSWORD=r -e POSTGRES_DB=$db "$img" >/dev/null
  for i in $(seq 120); do docker exec b02r-$db pg_isready -U postgres >/dev/null 2>&1 && sleep 2 && break; sleep 1; done
  f=$W/$([ $db = macrodb ] && echo macrodb || echo keycloak).dump
  docker cp $f b02r-$db:/tmp/d.dump
  echo " $db:"; t docker exec b02r-$db pg_restore -U postgres -d $db --no-owner --no-acl /tmp/d.dump
done
log "3. B-02a migrations on the macrodb copy (from main, read from git)"
git -C /volumes/kailo/kailo-macro fetch -q origin main
for f in 20261109120000_principal_ids 20261109120100_email_links_is_primary_column 20261109120200_principal_id_rekey; do
  git -C /volumes/kailo/kailo-macro show origin/main:crates/macro_db_client/migrations/$f.up.sql > $W/$f.up.sql
  echo " $f:"; t sh -c "docker exec -i b02r-macrodb psql -U postgres -d macrodb -X -q -v ON_ERROR_STOP=1 -1 -f - < $W/$f.up.sql > $W/$f.out 2>&1"
done
docker exec b02r-macrodb psql -U postgres -d macrodb -At -c "select count(*) from \"User\" where id !~ '^macro\|[0-9a-f-]{36}\$'" | sed 's/^/  legacy-format user ids left: /'
docker exec b02r-macrodb psql -U postgres -d macrodb -At -c "select kind, count(*) from kailo_principal_id_map group by 1" | sed 's/^/  map: /'
log "4. live sizes the principal-rekey job walks (identity, objects, search)"
docker exec kailo-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d macrodb -At -c "select count(*) from macro_user"' | sed 's/^/  macro_user rows: /'
docker exec kailo-minio-1 sh -c 'du -s /data 2>/dev/null' | sed 's/^/  minio data (KiB): /'
curl -s -u "kailo:$(grep ^KAILO_OPENSEARCH_PASSWORD= $st/secrets/secrets.env | cut -d= -f2-)" "http://$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' kailo-search-1 | awk '{print $1}'):9200/_cat/count?h=count" 2>/dev/null | sed 's/^/  opensearch docs: /'
docker rm -f b02r-macrodb b02r-${kc_db:-keycloak} >/dev/null 2>&1
log "evidence in $W"
