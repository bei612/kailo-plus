#!/bin/bash
# b02-deploy.sh [--rehearse] <commit>: first deploy of a main that contains B-02a (principal-ID re-key) and B-02b, and
# since the 2026-11-15 batch also B-05b, B-07/B-08/B-12, C-02/C-04/C-07, E-00/E-02/E-11, A-22 (运维/部署批次-2026-11-15.md §3).
#   0. check out <commit>, build its images (no downtime; prebuilt images are reused: "is current" / registry pull-back)
#      and run the configuration preflight with them (`up.sh preflight`, G-09: every service's --check-config against
#      the deployment's rendered compose environment, the compose files' required settings; every problem listed).
#      A failed build or preflight checks the previous revision out again and stops before anything is stopped.
#      The probe timer is paused from here on (the checkout's probe.sh would judge the old stack by the new rules)
#   1. snapshots to the capacity disk: macrodb, and keycloak, spicedb, temporal, temporal_visibility (platform-postgres);
#      the operator model catalog
#   2. stop user traffic (edge), wait until the ElasticMQ queues are empty, stop the application services
#   3. window steps: operator model catalog gains what the commit's default catalog declares (E-00: `responses`,
#      `responses_rewrites`), ElasticMQ recreated with the commit's elasticmq.conf (A-22)
#   4. up.sh up --no-build (db-migrate re-keys and migrates; principal-rekey; spicedb-schema; services; align-schedules)
#   5. checks: principal-rekey JSON without failures, `status` with *_old = 0, no legacy user IDs, probe OK
#   6. the probe timer (kailo-probe.timer) enabled and active, whatever state the deploy found it in (G-10); on any
#      failure it is started again too, so a half-done deploy is reported by the probe
# Stops at the first failed step and prints the snapshot directory; roll back with b02-rollback.sh <snapshot dir>.
# --rehearse (env REHEARSE_CHECKOUT=<clean checkout of the commit>, REHEARSE_STATE=<scratch state dir>,
#   REHEARSE_INIT_TAG=<its kailo/init tag>): read-only on the live stack. Takes the same snapshots into a rehearsal directory, restores each into a
#   throwaway Postgres (drop/create/restore as the rollback does), applies the catalog step to a copy and validates it,
#   reads the queue depths without stopping anything, runs the commit's migrations on the macrodb copy with its init
#   image, and lists what the window would stop. Nothing is checked out, stopped or started.
set -euo pipefail
rehearse=false; [ "${1:-}" = --rehearse ] && { rehearse=true; shift; }
c=${1:?commit}
export DOCKER_HOST=unix:///run/kailo-docker/docker.sock KAILO_STATE_DIR=/volumes/kailo/deploy/kailo
repo=/volumes/kailo/kailo-macro up=$repo/kailo/deploy/up.sh st=$KAILO_STATE_DIR
B=/volumes/data/kailo/capacity/backup/b02-$($rehearse && echo rehearse || echo deploy)-$(date -u +%Y%m%dT%H%M%SZ); mkdir -p "$B"
log() { echo "$(date -u +%T) $*"; }
step() { STEP_T=$(date +%s); log "$*"; }
took() { log "  took $(( $(date +%s) - STEP_T ))s"; }
PLATFORM_DBS="keycloak spicedb temporal temporal_visibility"
# G-10: probe_pause, probe_on, probe_assert (the probe timer stays on after every deploy).
. "$(dirname "$(readlink -f "$0")")/probe-timer.sh"
trap 'rc=$?; $rehearse || probe_on || log "WARNING: kailo-probe.timer is not enabled and active"
  [ $rc = 0 ] || log "FAILED (rc=$rc). Snapshots: $B — roll back: b02-rollback.sh $B"' EXIT

git -C $repo fetch -q origin
git -C $repo merge-base --is-ancestor 395baa21ee "$c" || { log "$c does not contain B-02a"; exit 1; }
# (not `git log | grep -q`: under pipefail grep's early exit makes git log fail with SIGPIPE)
[ -n "$(git -C $repo log -1 --format=%h --grep=B-02b "$c")" ] || { log "$c does not contain B-02b"; exit 1; }
git -C $repo show "$c:kailo/deploy/models/catalog.default.json" > "$B/catalog.default.json"

# The commit's default catalog decides what the operator copy must declare: for every provider and model of the same
# name, capabilities the default declares are added and provider fields the copy lacks (responses_rewrites) are taken
# over. Nothing else in the operator copy changes.
catalog_sync() {  # <operator catalog> <commit default catalog> -> rewrites the first in place, prints what changed
  python3 - "$1" "$2" <<'PY'
import json, sys
path, default = sys.argv[1], json.load(open(sys.argv[2]))
doc = json.load(open(path)); changed = []
ops = {p["name"]: p for p in doc["providers"]}
for dp in default["providers"]:
    op = ops.get(dp["name"])
    if op is None:
        continue
    for key, value in dp.items():
        if key not in ("name", "models") and key not in op and key == "responses_rewrites":
            op[key] = value; changed.append(f"{dp['name']}.{key}={value}")
    models = {m["id"]: m for m in op.get("models", [])}
    for dm in dp.get("models", []):
        om = models.get(dm["id"])
        if om is None:
            continue
        for cap in dm.get("capabilities", []):
            if cap not in om["capabilities"]:
                om["capabilities"].append(cap); changed.append(f"{dp['name']}/{dm['id']} +{cap}")
tmp = path + ".tmp"
json.dump(doc, open(tmp, "w"), indent=2); open(tmp, "a").write("\n")
import os; os.chmod(tmp, 0o644); os.replace(tmp, path)
print("catalog: " + ("; ".join(changed) if changed else "no change"))
PY
}
catalog_check() {  # the role Codex runs on must be a `responses` model (agent_harness_service refuses to start otherwise)
  python3 - "$1" "${KAILO_CODEX_DEFAULT_MODEL:-kailo/smart}" <<'PY'
import json, sys
doc = json.load(open(sys.argv[1])); role = sys.argv[2].split("/", 1)[-1]
target = doc["roles"][role]; target = target["model"] if isinstance(target, dict) else target
prov, model = target.split("/", 1)
p = next(p for p in doc["providers"] if p["name"] == prov); m = next(m for m in p["models"] if m["id"] == model)
assert "responses" in m["capabilities"], f"{target} lacks responses"
print(f"catalog: role {role} -> {target}: responses ok; rewrites {p.get('responses_rewrites')}")
PY
}
queue_depth() {  # visible + in-flight messages of every work queue; dead-letter queues (another queue's redrive target)
  # never drain and are only reported (their messages are kept, in the old ID format, for inspection)
  local emq urls url attrs dlqs="" left=0 n
  emq=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' kailo-elasticmq-1 | awk '{print $1}')
  urls=$(curl -s "http://$emq:9324/?Action=ListQueues" | grep -o '<QueueUrl>[^<]*' | sed 's/<QueueUrl>//')
  for url in $urls; do
    dlqs+=" $(curl -s "http://$emq:9324/?Action=GetQueueAttributes&AttributeName.1=RedrivePolicy&QueueUrl=$url" \
      | { grep -o 'deadLetterTargetArn&quot;:&quot;[^&]*\|deadLetterTargetArn":"[^"]*' || true; } | sed 's/.*[:;]//; s/.*://')"
  done
  for url in $urls; do
    attrs=$(curl -s "http://$emq:9324/?Action=GetQueueAttributes&AttributeName.1=All&QueueUrl=$url")
    n=$(( $(grep -A1 '>ApproximateNumberOfMessages<' <<<"$attrs" | grep -o '[0-9]*</Value>' | tr -dc 0-9 || true)0 / 10 \
        + $(grep -A1 '>ApproximateNumberOfMessagesNotVisible<' <<<"$attrs" | grep -o '[0-9]*</Value>' | tr -dc 0-9 || true)0 / 10 ))
    if grep -qw -- "${url##*/}" <<<"$dlqs"; then
      [ "$n" = 0 ] || echo "  dead-letter ${url##*/}: $n (kept, not waited for)" >&2
    else
      left=$((left + n))
    fi
  done
  echo $left
}
infra='postgres|platform-postgres|redis|kafka|search|elasticmq|openbao|mailpit|minio|keycloak|temporal|spicedb|sandbox-docker|codex-agent|.*-init|db-migrate|search-indices|kafka-topics|temporal-db-init|temporal-schema|temporal-namespace|temporal-align-schedules|spicedb-db-init|spicedb-migrate|spicedb-schema|keycloak-db-init|principal-rekey'

if $rehearse; then
  [ "$(git -C "${REHEARSE_CHECKOUT:?scratch checkout of the commit}" rev-parse HEAD)" = "$(git -C $repo rev-parse "$c")" ] \
    || { log "REHEARSE_CHECKOUT is not at $c"; exit 1; }
  init=kailo/init:${REHEARSE_INIT_TAG:?set REHEARSE_INIT_TAG to the kailo/init tag of the commit}
fi

step "0. $($rehearse && echo '[rehearse] skip checkout/build/preflight' || echo "check out $c, build its images and preflight its configuration while the old release still serves")"
if ! $rehearse; then
  probe_pause
  prev=$(git -C $repo rev-parse HEAD)
  git -C $repo checkout -q -B deploy "$c"
  # Nothing is stopped yet: a release that cannot build, or whose services would not start on this deployment's
  # configuration, goes no further and leaves the old release's checkout in place.
  if ! $up build || ! $up preflight; then
    git -C $repo checkout -q -B deploy "$prev"
    log "$c not deployed: build or configuration preflight failed (above); $prev checked out again, nothing stopped"
    exit 1
  fi
fi
took

step "1. snapshots -> $B"
# The shared deployment is stopped outside acceptance windows (handbook §6): start the two databases the snapshots
# read (their existing containers, i.e. the deployed release) and wait until they accept connections.
for pg in kailo-postgres-1 kailo-platform-postgres-1; do
  [ "$(docker inspect -f "{{.State.Running}}" $pg)" = true ] || { docker start $pg >/dev/null; log "started $pg for the snapshot"; }
  for _ in $(seq 60); do docker exec $pg pg_isready -q && break; sleep 2; done
  docker exec $pg pg_isready -q || { echo "$pg not ready" >&2; exit 1; }
done
docker exec kailo-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -Fc macrodb' > "$B/macrodb.dump"
for db in $PLATFORM_DBS; do
  docker exec kailo-platform-postgres-1 sh -c "pg_dump -U \"\$POSTGRES_USER\" -Fc $db" > "$B/$db.dump"
done
cp -a "$st/models/catalog.json" "$B/catalog.json"
ls -la "$B" | awk 'NR>1 {print "  "$5" "$9}'
took

if $rehearse; then
  step "1r. [rehearse] restore every snapshot as the rollback does (create database owned by its role, pg_restore)"
  net=b02r-net; docker network create --internal $net >/dev/null 2>&1 || true
  for src in kailo-postgres-1 kailo-platform-postgres-1; do
    img=$(docker inspect -f '{{.Config.Image}}' $src); name=b02r-${src%-1}
    docker rm -f $name >/dev/null 2>&1 || true
    docker run -d --name $name --network $net --cpus 2 --memory 3g --tmpfs /var/lib/postgresql:size=4g \
      -e POSTGRES_PASSWORD=rehearsal "$img" >/dev/null
    for i in $(seq 120); do [ "$(docker logs $name 2>&1 | grep -c 'ready to accept connections')" -ge 2 ] && break; sleep 1; done; sleep 2
    dbs=$([ $src = kailo-postgres-1 ] && echo macrodb || echo $PLATFORM_DBS)
    for db in $dbs; do
      owner=$(docker exec $src sh -c "psql -U \"\$POSTGRES_USER\" -d postgres -Atc \"select r.rolname from pg_database d join pg_roles r on r.oid=d.datdba where datname='$db'\"")
      s=$(date +%s%N)
      docker exec $name psql -U postgres -q -c "do \$\$ begin if not exists (select from pg_roles where rolname='$owner') then create role \"$owner\" login; end if; end \$\$" >/dev/null
      docker exec $name createdb -U postgres -O "$owner" $db
      docker cp "$B/$db.dump" $name:/tmp/$db.dump
      docker exec $name pg_restore -U postgres -d $db --exit-on-error /tmp/$db.dump 2>&1 | tail -2
      log "  $db (owner $owner) restored in $(( ($(date +%s%N) - s) / 1000000 )) ms"
    done
  done
  took
fi

step "2. $($rehearse && echo '[rehearse] read queue depths; list the services the window stops' || echo 'stop user traffic; drain the queues; stop the application services')"
if $rehearse; then  # the commit's service list, from a scratch checkout of it with a scratch state directory
  apps=$(KAILO_STATE_DIR=${REHEARSE_STATE:?} ${REHEARSE_CHECKOUT:?}/kailo/deploy/up.sh compose config --services 2>/dev/null | grep -vxE "$infra" | tr '\n' ' ')
else
  apps=$($up compose config --services 2>/dev/null | grep -vxE "$infra" | tr '\n' ' ')
fi
if $rehearse; then
  log "  queued messages now: $(queue_depth)"; log "  would stop: $apps"
else
  $up compose stop edge
  for i in $(seq 60); do left=$(queue_depth); [ "$left" = 0 ] && break; log "  $left message(s) left"; sleep 5; done
  [ "$left" = 0 ] || { log "queues did not drain in 5 minutes"; exit 1; }
  $up compose stop $apps
fi
took

step "3. window: model catalog (E-00), ElasticMQ with the commit's queues (A-22)"
if $rehearse; then
  cp "$B/catalog.json" "$B/catalog.rehearse.json"; catalog_sync "$B/catalog.rehearse.json" "$B/catalog.default.json"
  set -a; . "$st/kailo.env"; set +a; catalog_check "$B/catalog.rehearse.json"
  log "  would run: up.sh compose up -d --no-deps --force-recreate elasticmq (queues per $c elasticmq.conf: $(git -C $repo show "$c:kailo/deploy/elasticmq.conf" | grep -c '^  \"'))"
else
  catalog_sync "$st/models/catalog.json" "$B/catalog.default.json"
  set -a; . "$st/kailo.env"; set +a; catalog_check "$st/models/catalog.json"
  $up compose up -d --no-deps --force-recreate --wait elasticmq
fi
took

step "4. $($rehearse && echo "[rehearse] the commit's migrations on the macrodb copy ($init)" || echo "deploy $c (images already built)")"
if $rehearse; then
  docker run --rm --network $net --cpus 2 --memory 1g -e DATABASE_URL=postgres://postgres:rehearsal@b02r-kailo-postgres:5432/macrodb \
    --entrypoint sqlx "$init" migrate run --source /init/migrations 2>&1 | tail -25 | sed 's/^/  /'
  docker exec b02r-kailo-postgres psql -U postgres -d macrodb -Atc "select 'legacy-format user ids: '||count(*) from \"User\" where id !~ '^macro\|[0-9a-f-]{36}\$'" | sed 's/^/  /'
  docker exec b02r-kailo-postgres psql -U postgres -d macrodb -Atc "select 'authz_outbox rows: '||count(*) from authz_outbox" | sed 's/^/  /'
  docker rm -f b02r-kailo-postgres b02r-kailo-platform-postgres >/dev/null; docker network rm $net >/dev/null
else
  $up up --no-build
fi
took

if $rehearse; then log "rehearsal done: $B"; exit 0; fi
step "5. checks"
$up compose logs --no-log-prefix principal-rekey | tail -n 1 | tee "$B/principal-rekey.json"
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); bad={k:v for k,v in d.items() if isinstance(v,dict) and v.get("failed")}; sys.exit("failed: %s" % bad if bad else 0)' "$B/principal-rekey.json"
$up compose run --rm principal-rekey /app/out/kailo_principal_rekey status | tee "$B/principal-rekey-status.json"
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); bad={k:v for k,v in d.items() if k.endswith("_old") and v}; sys.exit("old ids left: %s" % bad if bad else 0)' "$B/principal-rekey-status.json"
n=$(docker exec kailo-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d macrodb -At -c "select count(*) from \"User\" where id !~ '"'"'^macro\|[0-9a-f-]{36}\$'"'"'"')
[ "$n" = 0 ] || { log "$n legacy-format user IDs left"; exit 1; }
KAILO_STATE_DIR=$KAILO_STATE_DIR $repo/kailo/deploy/probe.sh
took
step "6. probe timer (G-10)"
probe_assert
took
log "done. Next: trial-account login with its original password, official.sh, spicedb/verify.sh, authz/verify.sh. Snapshots: $B"
