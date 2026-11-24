#!/bin/bash
# run.sh <command> [args] — train-g acceptance on the CI node (see README.md).
#   dry-run               no stack: node --check of every script, bash -n, runner --dry-run, selftest.mjs (node in .tools/)
#   post-deploy           host checks after the deploy → results/$RUN_ID/00-post-deploy.json
#   steps [runner args]   the browser suite in a playwright container on kailo_internal → results/$RUN_ID/<step>.json
#                         (steps run concurrently, ACC_CONCURRENCY or --concurrency at once; --serial: one at a time)
#   all [runner args]     post-deploy, then steps
#   evidence              read-only Temporal / DB / SpiceDB evidence → results/$RUN_ID/evidence/
# Secrets (internal API key, bootstrap token) reach the container through a 0600 env file, never a command line.
set -euo pipefail
D=$(cd "$(dirname "$0")" && pwd)
: "${RUN_ID:=$(date -u +%Y%m%d-%H%M%S)}"; export RUN_ID
: "${KAILO_URL:=https://192.168.0.149}"
: "${KAILO_DOCKER_HOST:=unix:///run/kailo-docker/docker.sock}"
: "${KAILO_SECRETS:=/volumes/kailo/deploy/kailo/secrets/secrets.env}"
: "${PW_IMAGE:=mcr.microsoft.com/playwright:v1.62.0-noble}"
: "${PW_NODE_MODULES:=/volumes/kailo/acceptance/m0/node_modules}"
: "${KAILO_NET:=kailo_internal}"
: "${NODE_BIN:=$D/.tools/node/bin/node}"
export RUN_ID KAILO_URL KAILO_DOCKER_HOST
umask 077
mkdir -p "$D/results/$RUN_ID" "$D/logs" "$D/state"; chmod 700 "$D/state"

steps() {
  local envf=$D/state/.env-$RUN_ID-$$
  grep -E "^(KAILO_INTERNAL_API_KEY|KAILO_PLATFORM_BOOTSTRAP_TOKEN)=" "$KAILO_SECRETS" > "$envf" || true
  chmod 600 "$envf"
  local admin=()
  if [ -n "${ADMIN_ACCOUNT_FILE:-}" ]; then admin=(-v "$ADMIN_ACCOUNT_FILE:/run/acc-admin.json:ro" -e ADMIN_ACCOUNT_FILE=/run/acc-admin.json); fi
  set +e
  DOCKER_HOST=$KAILO_DOCKER_HOST docker run --rm --name "traing-acc-$RUN_ID" --network "$KAILO_NET" --cpus 3 --memory 6g \
    --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$PW_NODE_MODULES:/w/node_modules:ro" -v "$D:/w" -w /w --env-file "$envf" \
    -e SUITE_DIR=/w -e RUN_ID -e KAILO_URL="$KAILO_URL" -e MAILPIT_URL="${MAILPIT_URL:-http://mailpit:8025}" \
    -e AUTH_INTERNAL_URL="${AUTH_INTERNAL_URL:-http://authentication-service:8080}" -e OPENMETER_URL="${OPENMETER_URL:-http://openmeter:8888/api/v1}" \
    -e ACC_DOMAIN="${ACC_DOMAIN:-}" -e ASK_TIMEOUT_S="${ASK_TIMEOUT_S:-600}" -e ACC_CONCURRENCY="${ACC_CONCURRENCY:-4}" "${admin[@]}" \
    "$PW_IMAGE" node run-all.mjs "$@" 2>&1 | tee -a "$D/logs/steps-$RUN_ID.log"
  local rc=${PIPESTATUS[0]}
  set -e
  : > "$envf"; unlink "$envf"
  return "$rc"
}

dry_run() {
  if [ ! -x "$NODE_BIN" ] && command -v node >/dev/null; then NODE_BIN=$(command -v node); fi
  if [ ! -x "$NODE_BIN" ]; then
    # No node on the host: the same checks inside the playwright image, offline (--network none), suite read-only.
    echo "no host node; running the dry run in $PW_IMAGE (--network none)"
    DOCKER_HOST=$KAILO_DOCKER_HOST docker run --rm --network none --user "$(id -u):$(id -g)" -e HOME=/tmp \
      -v "$PW_NODE_MODULES:/w/node_modules:ro" -v "$D:/w:ro" -w /w -e NODE_BIN=node -e PW_NODE_MODULES=/w/node_modules \
      "$PW_IMAGE" bash -c 'D=/w; rc=0; for f in $(find /w -path /w/node_modules -prune -o -name "*.mjs" -print | sort); do node --check "$f" || rc=1; done;
        node run-all.mjs --dry-run || rc=1; node selftest.mjs || rc=1;
        node --input-type=module -e "const m = await import(\"/w/node_modules/playwright-core/index.mjs\"); if (!m.chromium) throw 1; console.log(\"playwright-core ok\")" || rc=1; echo DRY_RUN rc=$rc; exit $rc'
    return
  fi
  local rc=0 f
  while IFS= read -r f; do "$NODE_BIN" --check "$f" || { echo "SYNTAX $f"; rc=1; }; done \
    < <(find "$D" \( -path "$D/.tools" -o -path "$D/node_modules" -o -path "$D/results" -o -path "$D/shots" \) -prune -o -name '*.mjs' -print | sort)
  for f in "$D"/run.sh "$D"/post-deploy.sh "$D"/host/*.sh; do bash -n "$f" || { echo "SYNTAX $f"; rc=1; }; done
  "$NODE_BIN" "$D/run-all.mjs" --dry-run || rc=1
  "$NODE_BIN" "$D/selftest.mjs" || rc=1
  "$NODE_BIN" --input-type=module -e "const m = await import('$PW_NODE_MODULES/playwright-core/index.mjs'); if (!m.chromium || !m.request) throw new Error('playwright-core exports'); console.log('playwright-core resolves from $PW_NODE_MODULES')" || rc=1
  echo "DRY_RUN rc=$rc"; return $rc
}

cmd=${1:-}; shift || true
case "$cmd" in
  dry-run) dry_run ;;
  post-deploy) bash "$D/post-deploy.sh" ;;
  steps) steps "$@" ;;
  all) bash "$D/post-deploy.sh" || echo "post-deploy had failures (see results/$RUN_ID/00-post-deploy.json); continuing with the browser suite"; steps "$@" ;;
  evidence) bash "$D/host/evidence.sh" ;;
  *) sed -n '2,9p' "$0"; exit 2 ;;
esac
