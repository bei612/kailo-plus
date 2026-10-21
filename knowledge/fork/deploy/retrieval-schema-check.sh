#!/usr/bin/env bash
# Structure comparison for migration 000108 (DD-128(5), SF-WEK-18): on the pinned
# ParadeDB image, a database migrated normally and one migrated with
# app.skip_embedding=true and then repaired by 000108 must have the same tables,
# columns, constraints, sequences, indexes and extensions; 000108 on a database
# that never skipped must change nothing.
#
# Usage (CI node; docker; no host port, no data volume, nothing persists):
#   retrieval-schema-check.sh <knowledge-service image@sha256:...> [<migrations dir>]
# The knowledge-service image provides the application's locked golang-migrate
# binary (docker/Dockerfile.app); migrations default to this tree's
# knowledge/migrations/versioned. The ParadeDB image is the one compose.yaml pins.
set -euo pipefail
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
service=${1:?knowledge-service image reference with digest}
migrations=${2:-$(cd -- "$here/../../migrations/versioned" && pwd)}
[[ $service =~ @sha256:[0-9a-f]{64}$ ]] || { echo 'knowledge-service image must be pinned by digest' >&2; exit 2; }
paradedb=$(grep -Eo 'paradedb/paradedb@sha256:[0-9a-f]{64}' "$here/compose.yaml" | head -1)
[ -n "$paradedb" ] || { echo 'compose.yaml pins no ParadeDB image' >&2; exit 2; }
latest=$(ls "$migrations" | sed -nE 's/^0*([0-9]+)_.*\.up\.sql$/\1/p' | sort -n | tail -1)
[ "$latest" = 108 ] || { echo "expected 000108 to be the latest migration, found $latest" >&2; exit 2; }
D=(sudo -n docker)
run=wk-schema-$$
work=$(mktemp -d)
cleanup() {
  "${D[@]}" rm -f "$run-normal" "$run-skipped" >/dev/null 2>&1 || true
  "${D[@]}" network rm "$run" >/dev/null 2>&1 || true
  rm -rf -- "$work"
}
trap cleanup EXIT
"${D[@]}" network create --internal "$run" >/dev/null
for db in normal skipped; do
  # Throwaway, internal network only: trust auth, tmpfs data.
  "${D[@]}" run -d --name "$run-$db" --network "$run" --tmpfs /var/lib/postgresql/data \
    -e POSTGRES_USER=weknora -e POSTGRES_DB=weknora -e POSTGRES_HOST_AUTH_METHOD=trust "$paradedb" >/dev/null
done
for db in normal skipped; do
  for _ in $(seq 120); do
    "${D[@]}" exec "$run-$db" pg_isready -U weknora -d weknora -h 127.0.0.1 >/dev/null 2>&1 && break
    sleep 1
  done
  # The image's init scripts restart the server once; wait until it stays up.
  sleep 5
  "${D[@]}" exec "$run-$db" pg_isready -U weknora -d weknora -h 127.0.0.1 >/dev/null
done

migrate() {  # <db> <skip true|false> <migrate args...>
  local db=$1 skip=$2
  shift 2
  "${D[@]}" run --rm --network "$run" --entrypoint migrate -v "$migrations:/migrations:ro" "$service" \
    -path /migrations -database "postgres://weknora@$run-$db:5432/weknora?sslmode=disable&options=-c%20app.skip_embedding=$skip" \
    "$@" 2>&1 | tail -2
}
snapshot() {  # <db> <name>: every structural fact compared, sorted
  "${D[@]}" exec -i "$run-$1" psql -X -q -At -v ON_ERROR_STOP=1 -U weknora -d weknora > "$work/$2" <<'SQL'
select 'table|'||table_name||'|'||table_type from information_schema.tables where table_schema='public' order by 1;
select 'column|'||table_name||'|'||ordinal_position||'|'||column_name||'|'||data_type||'|'||udt_name||'|'||coalesce(character_maximum_length::text,'')||'|'||is_nullable||'|'||coalesce(column_default,'') from information_schema.columns where table_schema='public' order by table_name, ordinal_position;
select 'constraint|'||conrelid::regclass||'|'||conname||'|'||pg_get_constraintdef(oid) from pg_constraint where connamespace='public'::regnamespace order by 1;
select 'sequence|'||sequence_name||'|'||data_type||'|'||start_value||'|'||increment from information_schema.sequences where sequence_schema='public' order by 1;
select 'index|'||tablename||'|'||indexname||'|'||indexdef from pg_indexes where schemaname='public' order by 1;
select 'extension|'||extname||'|'||extversion from pg_extension order by 1;
select 'version|'||version||'|'||dirty from schema_migrations;
SQL
}
fail=0
check() {  # <label> <file a> <file b>
  if diff -u "$work/$2" "$work/$3" > "$work/$1.diff"; then
    echo "PASS $1 ($(wc -l < "$work/$2") structural facts identical)"
  else
    echo "FAIL $1"; cat "$work/$1.diff"; fail=1
  fi
}

echo "== normal: 000001..000107 with app.skip_embedding=false, then 000108"
migrate normal false goto 107
snapshot normal normal-107
migrate normal false up
snapshot normal normal-108
echo "== skipped: 000001..000107 with app.skip_embedding=true, then 000108 with the driver declared"
migrate skipped true goto 107
snapshot skipped skipped-107
migrate skipped false up
snapshot skipped skipped-108

grep -q '^table|embeddings|' "$work/normal-107" || { echo 'FAIL normal initialisation has no embeddings table'; fail=1; }
if grep -q '^table|embeddings|' "$work/skipped-107"; then echo 'FAIL skipped initialisation created embeddings'; fail=1
else echo "PASS skipped initialisation lacks embeddings ($(grep -c '^index|embeddings|' "$work/normal-107") embeddings indexes absent)"; fi
# 000108 changes nothing on a database that never skipped (only the version row moves).
grep -v '^version|' "$work/normal-107" > "$work/normal-107.s"; grep -v '^version|' "$work/normal-108" > "$work/normal-108.s"
check no-op-on-normal normal-107.s normal-108.s
check repaired-equals-normal normal-108 skipped-108
grep -Eq '^version\|108\|(f|false)$' "$work/skipped-108" && echo 'PASS repaired database at 108, not dirty' || { echo 'FAIL repaired database version'; fail=1; }
exit "$fail"
