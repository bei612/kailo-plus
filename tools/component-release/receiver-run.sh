#!/usr/bin/env bash
# DD-124(4), .design/07 §8A: the isolated receiver deployment of one built-in
# REMOTE_ADAPTER release whose capability vectors carry RECEIVER cases (the
# WeKnora release on knowledge@3). CI node only. Nothing here connects to the
# production database, production OpenBao, production keys or a production
# binding; production containers are only inspected read-only (image digests).
#
#   receiver-run.sh /abs/receiver.env <stage>
#
# Stages, in order (each refuses unless the previous one left its record):
#   platform   copy deploy/local of the fixed release tree into RUN_DIR as the Compose project
#              RECEIVER_PROJECT (own .env with loopback ports, own edge network, own secrets, keys,
#              data and volumes) and start it with init-local.sh --isolated-receiver. No image is
#              built: Core/Worker must be the image digests the running production containers use,
#              and the release provenance of that Core digest gives isolatedCoreBuildId.
#   contracts  second Catalog admin, then capability-contract-activate.mjs for file_storage@2 and
#              every contract the candidate implements, in the isolated Catalog only
#   admit      original HUMAN application_binding.create admission, then its original management
#              page's PENDING generation humanActionPolicies -> bindings-admitted.json. These
#              references permit deployment configuration, never business execution or a PASS.
#   native     vector-requirements gate; the APPROVED source release's Cells instance; source files
#              through its native entry (seed-knowledge --phase native) before its native-action
#              delivery; its delivered adapter; the WeKnora candidate (native + receiver adapter for
#              the isolated Core) and the forward adapter the production Worker calls
#   bootstrap  core/verify/receiver-environment-bootstrap.rs (ignored Core test) against the
#              isolated database, SpiceDB and gateway: real bindings, resource.create (the returned
#              Resource ids are the Resource preconditions, DD-124(4)) and resource.grant_read
#              -> bootstrap.json, receiver-environment.json
#   seed       seed-knowledge --phase governed -> native-facts.json (preconditions)
#   inputs     observe.mjs (forward adapter; receiver block) -> facts.json; conformance-inputs.mjs
#              -> inputs/{fixture,identity,environment}.json
#   driver     core/verify/receiver-action-driver.rs (ignored Core test) serving APPLICATION
#              receiver steps (every step of a RECEIVER case: ingest, read, export, delete) inside
#              the isolated Core's network namespace, plus the session refresher; the driver
#              configuration lists each step's frozen input (preconditions substituted, earlier
#              captures still as placeholders), its captures and a capturesFile in RUN_DIR
#   down       stop the driver and remove every isolated project, volume and network of this run
#
# receiver.env (absolute 0600 regular file, operator-delivered, no secret values inline):
#   RECEIVER_SOURCE            fixed release tree of the production commit (/volumes/kailo/ci/sources/<commit>/apps)
#   RECEIVER_RUN_DIR           0700 directory under /var/lib/kailo-ci (NVMe) or /volumes/data (empty before `platform`)
#   RECEIVER_PROJECT           kailo-receiver-<id>
#   RECEIVER_NETWORK           kailo-conformance-<id> internal network shared with the production Worker
#                              for the registration window only
#   RECEIVER_PLATFORM_ENV      .env of the staged deploy/local (PUBLIC_BIND_ADDR=127.0.0.1,
#                              PLATFORM_EDGE_NETWORK=<RECEIVER_PROJECT>-edge, free ports)
#   RECEIVER_PRODUCTION_PROJECT running production Compose project (platform-local)
#   RECEIVER_CORE_PROVENANCE   tools/release.sh provenance of the production core image
#   RECEIVER_NODE_IMAGE        <repo>@sha256:<digest> constrained Node SDK image
#   RECEIVER_FLOW_NODE         absolute node binary for the browser flows; RECEIVER_PLAYWRIGHT_PACKAGE,
#                              RECEIVER_ACCOUNTS_DIR (isolated kailo-platform-approver.env)
#   RECEIVER_CELLS_ENV         source Cells start.sh env (dedicated kailo-cells-conformance* project,
#                              APPROVED release digests); RECEIVER_CELLS_DELIVERY_ENV its delivery env
#   RECEIVER_KNOWLEDGE_ENV     WeKnora native env (dedicated project; receiver adapter for the isolated Core)
#   RECEIVER_FORWARD_ADAPTER_CONFIG  adapter config of the forward adapter (conformance identity issuer)
#   RECEIVER_FORWARD_ADAPTER_JWKS    its actionTokenJwksFile (Core's isolated conformance JWKS)
#   RECEIVER_MANIFEST          render.mjs manifest of the candidate
#   RECEIVER_BOOTSTRAP_FILE    bootstrap input (core/verify/receiver-environment-bootstrap.rs prepare()):
#                              each Resource lists the vector preconditions its real resource.create
#                              id satisfies; bootstrap.json carries those ids as fixture values
#   RECEIVER_SEED_FILE         seed-knowledge.mjs input
#   RECEIVER_OBSERVE_FILE      observe.mjs input with "receiver" (receiverEnvironmentFile=RUN_DIR/receiver-environment.json)
#   RECEIVER_DRIVER_FILE       driver configuration (core/verify/receiver-action-driver.rs prepare())
#   RECEIVER_SESSION_COMMAND   absolute executable that refreshes the isolated session token files
#                              named by the bootstrap and driver inputs (keeps no other state)
#   RECEIVER_ADAPTER_DIRECTORY_FILE  the isolated Core's APPLICATION_ADAPTER_DIRECTORY_FILE (same delivery)
#   RECEIVER_MOUNTS            space-separated absolute input files outside RUN_DIR that the Node and
#                              Core test containers read at the same path (inputs, token files, JWKS)
#   RECEIVER_CACHE_DIR         Cargo cache for the Core test binary (optional, default RUN_DIR/cache);
#                              CHECK_CPUS/CHECK_MEMORY bound that container
# Node steps see the release tree at /src: seed/observe inputs name registrations there.
set -euo pipefail
run_env=${1:-}
stage=${2:-}
case "$stage" in platform|contracts|admit|native|bootstrap|seed|inputs|driver|down) ;; *)
  echo 'usage: receiver-run.sh /abs/receiver.env platform|contracts|admit|native|bootstrap|seed|inputs|driver|down' >&2; exit 2 ;; esac
[[ $run_env == /* && -f $run_env && ! -L $run_env && $(stat -c '%a' -- "$run_env") == 600 ]] \
  || { echo 'receiver.env must be an absolute 0600 regular file' >&2; exit 2; }
set -a
# shellcheck disable=SC1090
source "$run_env"
set +a
for name in RECEIVER_SOURCE RECEIVER_RUN_DIR RECEIVER_PROJECT RECEIVER_NETWORK RECEIVER_NODE_IMAGE; do
  [[ -n ${!name:-} ]] || { echo "receiver.env: $name required" >&2; exit 2; }
done
[[ $RECEIVER_PROJECT =~ ^kailo-receiver-[a-z0-9-]+$ ]] || { echo 'RECEIVER_PROJECT must be kailo-receiver-*' >&2; exit 2; }
[[ $RECEIVER_NETWORK =~ ^kailo-conformance-[a-z0-9-]+$ ]] || { echo 'dedicated kailo-conformance-* network required' >&2; exit 2; }
[[ $RECEIVER_NODE_IMAGE =~ ^[^[:space:]@]+@sha256:[0-9a-f]{64}$ ]] || { echo 'Node SDK image must be digest-pinned' >&2; exit 2; }
[[ ( $RECEIVER_RUN_DIR == /var/lib/kailo-ci/* || $RECEIVER_RUN_DIR == /volumes/data/* ) && -d $RECEIVER_RUN_DIR \
   && $(stat -c '%a' -- "$RECEIVER_RUN_DIR") == 700 ]] \
  || { echo 'RUN_DIR must be an existing 0700 directory under /var/lib/kailo-ci or /volumes/data' >&2; exit 2; }
src=$RECEIVER_SOURCE
run=$RECEIVER_RUN_DIR
platform=$run/apps/deploy/local
# The staged deploy/local is this run's own runtime directory (ADR-20 §3): every nested
# deploy/local entry (init-local.sh, start-core.sh, bootstrap.sh) resolves .env, secrets/ and
# data/ there, never an inherited KAILO_RUNTIME_DIR such as the production one.
export KAILO_RUNTIME_DIR=$platform
read -r -a docker <<<"${RECEIVER_DOCKER:-sudo -n docker}"
need() { for name in "$@"; do [[ -n ${!name:-} ]] || { echo "receiver.env: $name required for $stage" >&2; exit 2; }; done; }
record() { [[ -f $run/$1 && ! -L $run/$1 && ( $1 == *.done || -s $run/$1 ) ]] || { echo "missing $run/$1: run the earlier stage first" >&2; exit 2; }; }
private() { [[ $1 == /* && -f $1 && ! -L $1 && $(stat -c '%a' -- "$1") =~ ^[46]00$ ]] || { echo "$1 must be an absolute owner-only file" >&2; exit 2; }; }
compose() { (cd "$platform" && "${docker[@]}" compose --env-file .env -f compose.yaml "$@"); }
container_of() { compose ps -q "$1" | head -n 1; }
# Last JSON line a Core test entry printed on stdout (cargo output stays on stderr/log).
json_line() { python3 -I -c 'import json,sys
lines=[l for l in sys.stdin.read().splitlines() if l.startswith("{\"") and "\"CONFORMANCE_ONLY\"" in l]
if not lines: sys.exit("the Core test entry printed no CONFORMANCE_ONLY record")
print(json.dumps(json.loads(lines[-1])))'; }

node_step() { # node_step <network> <script> [args...]; inputs are mounted at their absolute paths
  local network=$1
  shift
  local mounts=() aliases=() file
  [[ ${1:-} != tools/component-release/conformance/observe.mjs ]] || aliases+=(--network-alias knowledge-forward-provider)
  for file in ${RECEIVER_MOUNTS:-}; do mounts+=(-v "$file:$file:ro"); done
  "${docker[@]}" run --rm --read-only --cap-drop ALL --security-opt no-new-privileges --cpus 1 --memory 768m --memory-swap 768m \
    --pids-limit 256 --tmpfs /tmp:rw,nosuid,nodev,size=64m -u "$(id -u):$(id -g)" -e HOME=/tmp \
    -v "$src:/src:ro" -v "$run:$run" "${mounts[@]}" -w /src --network "$network" "${aliases[@]}" "$RECEIVER_NODE_IMAGE" node "$@"
}

# One ignored Core test entry in the fixed check image, inside the isolated
# core-bff network namespace (exactly what that Core reaches, nothing else).
# Secret delivery goes through stdin env-file only, never argv or logs.
core_test() { # core_test <test name> <detach:true|false> <NAME=value lines on stdin>
  local name=$1 detach=$2 core recipe image cache=${RECEIVER_CACHE_DIR:-$run/cache}
  core=$(container_of core-bff)
  [[ -n $core ]] || { echo 'isolated core-bff is not running' >&2; exit 2; }
  recipe=$(sha256sum "$src/tools/check.Dockerfile" | cut -d' ' -f1)
  image=$("${docker[@]}" image inspect --format '{{.Id}}' "local/kailo-check:$recipe") \
    || { echo 'fixed check image of this release tree is missing; prepare it through the existing check entry' >&2; exit 2; }
  install -d -m 0700 "$cache" "$cache/home" "$cache/cargo-registry" "$cache/cargo-git"
  local args=(run --pull=never --read-only --cap-drop ALL --security-opt no-new-privileges
    --pids-limit 512 --tmpfs /tmp:rw,nosuid,nodev,size=128m --cpus "${CHECK_CPUS:-4}" --memory "${CHECK_MEMORY:-8g}" --memory-swap "${CHECK_MEMORY:-8g}"
    --user "$(id -u):$(id -g)" --network "container:$core" --workdir /workspace/apps
    --mount "type=bind,src=$src,dst=/workspace/apps,readonly" --mount "type=bind,src=$cache,dst=/cache"
    --mount "type=bind,src=$cache/cargo-registry,dst=/usr/local/cargo/registry"
    --mount "type=bind,src=$cache/cargo-git,dst=/usr/local/cargo/git" --mount "type=bind,src=$run,dst=$run"
    --env HOME=/cache/home --env CARGO_TARGET_DIR=/cache/rust-target --env SQLX_OFFLINE=true --env-file /dev/stdin)
  local file
  for file in ${RECEIVER_MOUNTS:-}; do args+=(--mount "type=bind,src=$file,dst=$file,readonly"); done
  if [[ $detach == true ]]; then args+=(--detach --name "$RECEIVER_PROJECT-driver"); else args+=(--rm); fi
  "${docker[@]}" "${args[@]}" "$image" bash -ec \
    "exec cargo test --locked --manifest-path core/Cargo.toml -p platform-core $name -- --ignored --exact --nocapture --test-threads 1"
}

# The isolated Core's own delivery: database URL, SpiceDB key and adapter directory.
core_env() {
  local line
  IFS= read -r line < "$platform/secrets/core-db-url.env"
  [[ $line == DATABASE_URL=?* ]] || { echo 'isolated Core database delivery missing' >&2; exit 2; }
  printf 'APPLICATION_EXECUTION_TEST_DATABASE_URL=%s\n' "${line#DATABASE_URL=}"
  printf 'SPICEDB_HTTP_URL=%s\n' "$(sed -n 's/^SPICEDB_HTTP_URL=//p' "$platform/.env")"
  printf 'SPICEDB_PRESHARED_KEY=%s\n' "$(cat "$platform/secrets/spicedb_preshared_key")"
  printf 'APPLICATION_ADAPTER_DIRECTORY_FILE=%s\n' "$RECEIVER_ADAPTER_DIRECTORY_FILE"
}

refresh_sessions() {
  need RECEIVER_SESSION_COMMAND
  [[ $RECEIVER_SESSION_COMMAND == /* && -x $RECEIVER_SESSION_COMMAND ]] || { echo 'RECEIVER_SESSION_COMMAND must be an absolute executable' >&2; exit 2; }
  flock "$run/session-refresh.lock" "$RECEIVER_SESSION_COMMAND"
}

session_refresh_loop() {
  local elapsed=0 interval=${RECEIVER_SESSION_SECONDS:-120}
  [[ $interval =~ ^[1-9][0-9]*$ ]] || { echo 'invalid isolated session renewal interval' >&2; return 2; }
  trap 'exit 0' TERM INT
  # Short sleeps let the scoped stage drain promptly without orphaning a refresh.
  while sleep 1; do
    elapsed=$((elapsed + 1))
    if ((elapsed >= interval)); then refresh_sessions || return 1; elapsed=0; fi
  done
}

scoped_session_refresh() {
  session_refresh_loop &
  stage_refresher=$!
  trap 'kill "$stage_refresher" 2>/dev/null || true; wait "$stage_refresher" 2>/dev/null || true' EXIT
}


case "$stage" in
platform)
  need RECEIVER_PLATFORM_ENV RECEIVER_PRODUCTION_PROJECT RECEIVER_CORE_PROVENANCE
  private "$RECEIVER_PLATFORM_ENV"
  [[ -z $(ls -A -- "$run") ]] || { echo 'RUN_DIR must be empty: every run starts a fresh isolated deployment' >&2; exit 2; }
  [[ $RECEIVER_PRODUCTION_PROJECT != "$RECEIVER_PROJECT" ]] || { echo 'isolated project must differ from production' >&2; exit 2; }
  # Staged tree: the release tree read-only through symlinks, deploy/local copied
  # so that its .env, secrets/ and data/ belong to this run only.
  install -d -m 0700 "$run/apps" "$run/apps/deploy"
  for entry in "$src"/* "$src"/.[!.]*; do
    [[ -e $entry ]] || continue
    [[ $(basename -- "$entry") == deploy ]] || ln -s "$entry" "$run/apps/$(basename -- "$entry")"
  done
  for entry in "$src"/deploy/*; do
    [[ $(basename -- "$entry") == local ]] || ln -s "$entry" "$run/apps/deploy/$(basename -- "$entry")"
  done
  cp -a "$src/deploy/local" "$platform"
  # The release tree's design snapshot sits beside apps/ (CI fetch); start-core.sh's registry
  # check reads it at ../.design from the staged apps/.
  [[ ! -d $src/../.design ]] || ln -s "$(realpath -e -- "$src/../.design")" "$run/.design"
  rm -rf -- "$platform/.env" "$platform/secrets" "$platform/data"
  install -m 0600 "$RECEIVER_PLATFORM_ENV" "$platform/.env"
  python3 -I - "$platform/compose.yaml" "$RECEIVER_PROJECT" <<'PY'
import sys
path, project = sys.argv[1:3]
text = open(path, encoding='utf-8').read()
if text.count('\nname: platform-local\n') != 1:
    sys.exit('staged compose.yaml has no single platform-local project name')
text = text.replace('\nname: platform-local\n', f'\nname: {project}\n')
# The isolated IdP is published on loopback only, and its issuer
# http://<OIDC_HOST>:<KEYCLOAK_PORT> must be the same address for the host browser
# flows (OIDC_HOST *.localhost resolves to loopback) and for containers (the
# compose network alias OIDC_HOST). Production publishes the container port
# itself (8080); the isolated copy cannot, so Keycloak listens on KEYCLOAK_PORT.
published = '${KEYCLOAK_PORT:?必须显式提供，禁止硬编码}:8080"'
listen = '      KC_HTTP_ENABLED: "true"\n'
if text.count(published) != 1 or text.count(listen) != 1:
    sys.exit('staged compose.yaml keycloak listener is not the expected shape')
text = text.replace(published, '${KEYCLOAK_PORT:?必须显式提供，禁止硬编码}:${KEYCLOAK_PORT}"')
text = text.replace(listen, listen + '      KC_HTTP_PORT: ${KEYCLOAK_PORT}\n')
open(path, 'w', encoding='utf-8').write(text)
PY
  python3 -I - "$platform/.env" "$RECEIVER_PROJECT" <<'PY'
import re, socket, sys
path, project = sys.argv[1:3]
env = {}
for line in open(path, encoding='utf-8'):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        key, value = line.split('=', 1)
        env[key] = value.strip().strip('"\'')
if env.get('PUBLIC_BIND_ADDR') != '127.0.0.1':
    sys.exit('isolated PUBLIC_BIND_ADDR must be 127.0.0.1')
if env.get('PLATFORM_EDGE_NETWORK') != f'{project}-edge':
    sys.exit(f'isolated PLATFORM_EDGE_NETWORK must be {project}-edge')
for key, value in env.items():
    if key.endswith('_PORT') and not key.endswith('_CONTAINER_PORT') and value:
        if not re.fullmatch(r'[0-9]{2,5}', value):
            sys.exit(f'{key} is not a port')
        with socket.socket() as probe:
            if probe.connect_ex(('127.0.0.1', int(value))) == 0:
                sys.exit(f'{key}={value} is already in use on this host')
PY
  # Same Core/Worker build as production (PlatformBuildInfo, DD-124(4)).
  core_pin=$(sed -n 's#^ *image: .*/core@\(sha256:[0-9a-f]\{64\}\)$#\1#p' "$platform/compose.yaml")
  worker_pin=$(sed -n 's#^ *image: .*/worker@\(sha256:[0-9a-f]\{64\}\)$#\1#p' "$platform/compose.yaml")
  for pair in "core-bff:$core_pin" "worker:$worker_pin"; do
    service=${pair%%:*}
    pin=${pair#*:}
    running=$("${docker[@]}" ps -q --filter "label=com.docker.compose.project=$RECEIVER_PRODUCTION_PROJECT" \
      --filter "label=com.docker.compose.service=$service" | head -n 1)
    [[ -n $running && -n $pin ]] || { echo "production $service or its pin is unknown" >&2; exit 2; }
    "${docker[@]}" inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' \
      "$("${docker[@]}" inspect --format '{{.Image}}' "$running")" | grep -q "@$pin\$" \
      || { echo "production $service does not run the pinned $pin of this release tree" >&2; exit 2; }
  done
  python3 -I - "$RECEIVER_CORE_PROVENANCE" "$core_pin" "$run/core-build.json" <<'PY'
import json, re, sys
path, pin, out = sys.argv[1:4]
statement = json.load(open(path, encoding='utf-8'))
subjects = [s for s in statement.get('subject', []) if s.get('name') == 'platform/core']
build = statement['predicate']['buildDefinition']['externalParameters']['buildArgs'].get('PLATFORM_BUILD_ID', '')
if len(subjects) != 1 or 'sha256:' + subjects[0]['digest']['sha256'] != pin or not re.fullmatch(r'[0-9a-f]{40}', build):
    sys.exit('core provenance does not name the pinned production Core image and its build id')
json.dump({'isolatedCoreBuildId': build, 'coreImage': pin}, open(out, 'x', encoding='utf-8'))
PY
  # The edge network ($RECEIVER_PROJECT-edge) is created by the staged compose project itself.
  "${docker[@]}" network inspect "$RECEIVER_NETWORK" >/dev/null 2>&1 \
    || "${docker[@]}" network create --internal --label kailo.receiver="$RECEIVER_PROJECT" "$RECEIVER_NETWORK" >/dev/null
  # The core-observed/ OpenBao audit device writes into data/secret-store-audit (owner 100,
  # reader group, setgid); without it no audit device comes up and secret-store-init.sh
  # refuses (production prepares it once with the same command).
  install -d -m 0700 "$platform/data"
  (cd "$platform" && ./secret-store-audit-dir.sh --prepare)
  (cd "$platform" && ./init-local.sh --isolated-receiver="$RECEIVER_PROJECT")
  # The production Worker reaches the isolated Core service API, its IdP and
  # (later) the driver only through the dedicated network.
  "${docker[@]}" network connect --alias receiver-core --alias receiver-driver "$RECEIVER_NETWORK" "$(container_of core-bff)"
  "${docker[@]}" network connect --alias receiver-idp "$RECEIVER_NETWORK" "$(container_of keycloak)"
  "${docker[@]}" network connect --alias receiver-gateway "$RECEIVER_NETWORK" "$(container_of agentgateway)"
  touch "$run/platform.done"
  echo "isolated platform $RECEIVER_PROJECT ready (CONFORMANCE_ONLY; not production)"
  ;;
contracts)
  need RECEIVER_FLOW_NODE RECEIVER_PLAYWRIGHT_PACKAGE RECEIVER_ACCOUNTS_DIR RECEIVER_MANIFEST
  record platform.done
  record core-build.json
  port=$(sed -n 's/^AGENTGATEWAY_PORT=//p' "$platform/.env")
  flow=(env KAILO_WEB="http://127.0.0.1:$port" KAILO_DEPLOY_DIR="$platform" KAILO_FLOW_ACCOUNTS_DIR="$RECEIVER_ACCOUNTS_DIR"
    KAILO_PLAYWRIGHT_PACKAGE="$RECEIVER_PLAYWRIGHT_PACKAGE" KAILO_FLOW_OUT="$run/flow-out" "$RECEIVER_FLOW_NODE")
  "${flow[@]}" "$src/tools/component-release/flow/catalog-approver.mjs"
  mapfile -t registrations < <(python3 -I - "$RECEIVER_MANIFEST" "$src" <<'PY'
import json, sys
manifest, src = sys.argv[1:3]
wanted = [('file_storage', 2)] + [(c['categoryKey'], c['contractVersion']) for c in json.load(open(manifest))['implements']]
for category, version in dict.fromkeys(wanted):
    print(f'{src}/contracts/adapter/{category}.v{version}/registration.json')
PY
)
  for registration in "${registrations[@]}"; do
    "${flow[@]}" "$src/tools/component-release/flow/capability-contract-activate.mjs" --registration "$registration"
  done
  touch "$run/contracts.done"
  ;;
native)
  record bindings-admitted.json
  need RECEIVER_CELLS_ENV RECEIVER_CELLS_DELIVERY_ENV RECEIVER_KNOWLEDGE_ENV RECEIVER_SEED_FILE
  record contracts.done
  set +e
  node_step none tools/component-release/conformance/vector-requirements.mjs --component knowledge --out "$run/requirements.json" >/dev/null
  gate=$?
  set -e
  [[ $gate == 0 ]] || { echo "vector requirements refused the knowledge vectors (exit $gate); see $run/requirements.json" >&2; exit 3; }
  project_of() { sed -n 's/^CELLS_COMPOSE_PROJECT=\(kailo-cells-conformance[a-z0-9_-]*\)$/\1/p' "$1"; }
  cells=$(project_of "$RECEIVER_CELLS_ENV")
  [[ -n $cells && $cells == "$(project_of "$RECEIVER_CELLS_DELIVERY_ENV")" ]] \
    || { echo 'Cells envs must name the same dedicated kailo-cells-conformance* project' >&2; exit 2; }
  start=$src/file-storage/deploy/start.sh
  if [[ -z $("${docker[@]}" ps -q --filter "label=com.docker.compose.project=$cells" --filter 'label=com.docker.compose.service=cells') ]]; then
    bash "$start" "$RECEIVER_CELLS_ENV"
  fi
  node_step "${cells}_cells-ui" tools/component-release/conformance/seed-knowledge.mjs --phase native --seed "$RECEIVER_SEED_FILE"
  bash "$start" --check "$RECEIVER_CELLS_DELIVERY_ENV"
  "${docker[@]}" compose --project-name "$cells" --env-file "$RECEIVER_CELLS_DELIVERY_ENV" \
    -f "$src/file-storage/deploy/compose.yaml" -f "$src/file-storage/deploy/compose.native-actions.yaml" \
    up --detach --no-build --pull never --force-recreate --no-deps --wait cells
  bash "$start" --platform-adapter "$RECEIVER_CELLS_DELIVERY_ENV"
  knowledge=$(sed -n 's/^COMPOSE_PROJECT_NAME=\(kailo-knowledge-receiver[a-z0-9_-]*\)$/\1/p' "$RECEIVER_KNOWLEDGE_ENV")
  [[ -n $knowledge ]] || { echo 'WeKnora env must name a dedicated kailo-knowledge-receiver* project' >&2; exit 2; }
  bash "$src/knowledge/fork/deploy/start.sh" --native-env "$RECEIVER_KNOWLEDGE_ENV" --platform-model "$platform/.env" \
    --platform-adapter
  app=$("${docker[@]}" ps -q --filter "label=com.docker.compose.project=$knowledge" \
    --filter "label=com.docker.compose.service=app" | head -n 1)
  [[ -n $app ]] || { echo 'WeKnora app of the candidate is not running' >&2; exit 2; }
  # The governed seed creates data sources through WeKnora's own API.
  if ! "${docker[@]}" inspect --format '{{json .NetworkSettings.Networks}}' "$app" | python3 -c 'import json,sys; n=json.load(sys.stdin); sys.exit(0 if sys.argv[1] in n else 1)' "$RECEIVER_NETWORK"; then
    "${docker[@]}" network connect --alias receiver-weknora "$RECEIVER_NETWORK" "$app"
  fi
  touch "$run/native.done"
  ;;
admit|bootstrap)
  need RECEIVER_BOOTSTRAP_FILE RECEIVER_ADAPTER_DIRECTORY_FILE
  if [[ $stage == admit ]]; then record contracts.done; phase=admit; output=bindings-admitted; expected=BINDINGS_ADMITTED
  else record native.done; phase=ready; output=bootstrap; expected=READY; fi
  private "$RECEIVER_BOOTSTRAP_FILE"
  refresh_sessions
  scoped_session_refresh
  # The bootstrap accepts only the database whose comment fixes this exact input.
  marker=$(python3 -I - "$RECEIVER_BOOTSTRAP_FILE" <<'PY'
import hashlib, json, re, sys
value = json.load(open(sys.argv[1], encoding='utf-8'))
environment = value.get('environmentId', '')
if not re.fullmatch(r'[0-9a-f-]{36}', environment):
    sys.exit('bootstrap input has no environmentId')
canonical = json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
print(f"KAILO_CONFORMANCE_ONLY:{environment}:{hashlib.sha256(canonical.encode()).hexdigest()}")
PY
)
  IFS= read -r url < "$platform/secrets/core-db-url.env"
  python3 -I - "$marker" 3<<<"${url#DATABASE_URL=}" <<'PY' | "${docker[@]}" exec -i "$(container_of core-db)" sh -ec 'IFS= read -r user; IFS= read -r db; exec psql -v ON_ERROR_STOP=1 -U "$user" -d "$db" -q'
import os, sys
from urllib.parse import unquote, urlsplit
url, marker = os.fdopen(3).read().strip(), sys.argv[1]
parts = urlsplit(url)
user, db = unquote(parts.username or ''), parts.path.lstrip('/')
if not user or not db or "'" in marker:
    sys.exit('isolated database URL incomplete')
print(user)
print(db)
quoted = db.replace('"', '""')
print("BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('receiver-marker:'||current_database(),0));")
print("DO $$ DECLARE old text; BEGIN SELECT shobj_description(oid,'pg_database') INTO old "
      "FROM pg_database WHERE datname=current_database(); "
      f"IF old IS NOT NULL AND old<>'{marker}' THEN RAISE EXCEPTION 'receiver input marker differs'; END IF; END $$;")
print(f'COMMENT ON DATABASE "{quoted}" IS \'{marker}\'; COMMIT;')
PY
  { core_env; printf 'APPLICATION_RECEIVER_BOOTSTRAP_FILE=%s\nAPPLICATION_RECEIVER_BOOTSTRAP_PHASE=%s\n' "$RECEIVER_BOOTSTRAP_FILE" "$phase"; } \
    | core_test application_binding::read_grant::receiver_environment_bootstrap::bootstrap_native_receiver_environment false \
    > "$run/$output.log"
  kill -0 "$stage_refresher" || { echo 'isolated session renewal stopped during bootstrap' >&2; exit 2; }
  json_line < "$run/$output.log" > "$run/$output.json.next"
  chmod 0600 "$run/$output.json.next"
  python3 -I - "$run/$output.json.next" "$run/$output.json" "$expected" <<'PYRECORD'
import json, os, stat, sys
from pathlib import Path
pending, final, expected = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
value = json.loads(pending.read_text())
if value.get('mode') != 'CONFORMANCE_ONLY' or value.get('setup') != expected or value.get('conformanceExecuted') is not False:
    sys.exit('original bootstrap did not emit the required deployment checkpoint')
def frozen(record):
    record = json.loads(json.dumps(record))
    if expected == 'BINDINGS_ADMITTED':
        for binding in record['bindings']:
            # Runtime progress can advance; identities, action intents and all
            # fixed policy references can never be replaced during recovery.
            binding.pop('state', None)
            binding.pop('dispatchState', None)
    return record
if final.exists() or final.is_symlink():
    mode = final.lstat().st_mode
    if not stat.S_ISREG(mode) or mode & 0o077 or frozen(json.loads(final.read_text())) != frozen(value):
        sys.exit('retained bootstrap checkpoint differs; inspect original intents, never replace them')
os.replace(pending, final)
PYRECORD
  if [[ $stage == admit ]]; then
    echo "binding admission checkpoint ready: $run/bindings-admitted.json (not ACTIVE or conformance PASS)"
    exit 0
  fi
  python3 -I - "$run/bootstrap.json" "$run/core-build.json" "$run/receiver-environment.json" <<'PY'
import json, os, sys
bootstrap, build, out = (json.load(open(sys.argv[1])), json.load(open(sys.argv[2])), sys.argv[3])
source = bootstrap['sourceRelease']
environment = {'isolatedCoreBuildId': build['isolatedCoreBuildId'], 'sourceReleaseId': source['releaseId'],
               'sourceArtifactDigest': source['artifactDigest'], 'sourceManifestDigest': source['manifestDigest']}
if os.path.lexists(out):
    import stat
    info = os.lstat(out)
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or json.load(open(out)) != environment:
        sys.exit('retained receiver environment differs')
else:
    fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as handle:
        json.dump(environment, handle, indent=2)
PY
  echo "bootstrap READY: $run/bootstrap.json, receiver environment $run/receiver-environment.json"
  ;;
seed)
  need RECEIVER_SEED_FILE
  record bootstrap.json
  refresh_sessions
  scoped_session_refresh
  node_step "$RECEIVER_NETWORK" tools/component-release/conformance/seed-knowledge.mjs --phase governed --seed "$RECEIVER_SEED_FILE"
  kill -0 "$stage_refresher" || { echo 'isolated session renewal stopped during seed' >&2; exit 2; }
  ;;
inputs)
  need RECEIVER_OBSERVE_FILE RECEIVER_MANIFEST RECEIVER_KNOWLEDGE_ENV RECEIVER_FORWARD_ADAPTER_CONFIG RECEIVER_FORWARD_ADAPTER_JWKS RECEIVER_FORWARD_ADAPTER_DELIVERY_DIR
  record receiver-environment.json
  knowledge=$(sed -n 's/^COMPOSE_PROJECT_NAME=\(kailo-knowledge-receiver[a-z0-9_-]*\)$/\1/p' "$RECEIVER_KNOWLEDGE_ENV")
  [[ -n $knowledge ]] || { echo 'dedicated receiver native project required' >&2; exit 2; }
  # The forward adapter: same artifact and native instance, configured for the
  # isolated conformance identity the production Worker signs with.
  private "$RECEIVER_FORWARD_ADAPTER_CONFIG"
  (
    set -a
    # shellcheck disable=SC1090
    source "$RECEIVER_KNOWLEDGE_ENV"
    set +a
    "${docker[@]}" run -d --name "$RECEIVER_PROJECT-forward-adapter" --restart no --read-only --cap-drop ALL \
      --security-opt no-new-privileges --cpus "$KNOWLEDGE_ADAPTER_CPUS" --memory "$KNOWLEDGE_ADAPTER_MEMORY" \
      --memory-swap "$KNOWLEDGE_ADAPTER_MEMORY" -u "$KNOWLEDGE_ADAPTER_UID:$KNOWLEDGE_ADAPTER_GID" \
      -e ADAPTER_CONFIG_FILE="$RECEIVER_FORWARD_ADAPTER_CONFIG" \
      -v "$RECEIVER_FORWARD_ADAPTER_CONFIG:$RECEIVER_FORWARD_ADAPTER_CONFIG:ro" \
      -v "$RECEIVER_FORWARD_ADAPTER_DELIVERY_DIR:$RECEIVER_FORWARD_ADAPTER_DELIVERY_DIR:ro" \
      --network "${knowledge}_native_ui" "$KNOWLEDGE_ADAPTER_REPOSITORY@sha256:$KNOWLEDGE_ADAPTER_DIGEST" >/dev/null
  )
  "${docker[@]}" network connect --alias knowledge-forward-adapter "$RECEIVER_NETWORK" "$RECEIVER_PROJECT-forward-adapter"
  if [[ ! -f $run/facts.json ]]; then
    node_step "$RECEIVER_NETWORK" tools/component-release/conformance/observe.mjs --run "$RECEIVER_OBSERVE_FILE"
  fi
  install -d -m 0700 "$run/inputs"
  node_step none tools/component-release/conformance-inputs.mjs --facts "$run/facts.json" --manifest "$RECEIVER_MANIFEST" \
    --out "$run/inputs"
  cat <<EOF
Isolated receiver conformance inputs ready (no production state changed):
  $run/inputs/fixture.json, identity.json, environment.json
form the candidate <COMPONENT_CONFORMANCE_DIR>/<artifactDigest>/ (DD-136(2)).
EOF
  ;;
driver)
  need RECEIVER_DRIVER_FILE RECEIVER_ADAPTER_DIRECTORY_FILE RECEIVER_FORWARD_PROVIDER_FILE
  record inputs/identity.json
  private "$RECEIVER_DRIVER_FILE"
  private "$RECEIVER_FORWARD_PROVIDER_FILE"
  refresh_sessions
  "${docker[@]}" run --detach --name "$RECEIVER_PROJECT-forward-provider" --restart no --read-only --cap-drop ALL \
    --security-opt no-new-privileges --cpus 0.5 --memory 256m --memory-swap 256m --pids-limit 128 \
    --tmpfs /tmp:rw,nosuid,nodev,size=32m -u "$(id -u):$(id -g)" -e HOME=/tmp \
    -e "CONFORMANCE_PROVIDER_CONFIG_FILE=$RECEIVER_FORWARD_PROVIDER_FILE" -v "$src:/src:ro" -v "$run:$run:ro" \
    -w /src --network "$RECEIVER_NETWORK" --network-alias knowledge-forward-provider \
    "$RECEIVER_NODE_IMAGE" node tools/component-release/conformance-provider.mjs >/dev/null
  { core_env; printf 'APPLICATION_RECEIVER_DRIVER_FILE=%s\n' "$RECEIVER_DRIVER_FILE"; } \
    | core_test application_binding::read_grant::receiver_action_driver::serve_isolated_receiver_actions true >/dev/null
  # Isolated sessions expire; the operator's refresher keeps the same files fresh.
  session_refresh_loop &
  echo $! > "$run/session-refresher.pid"
  cat <<EOF
Receiver driver running in $RECEIVER_PROJECT-driver (receiverActionBaseUrl alias receiver-driver on $RECEIVER_NETWORK).
For the registration window only: deliver $run/inputs/*.json read-only to the production core-bff/worker
(deploy/local start-core.sh --no-build) and attach the production Worker to $RECEIVER_NETWORK;
this script does neither. Afterwards: receiver-run.sh $run_env down
EOF
  ;;
down)
  if [[ -s $run/session-refresher.pid ]]; then kill "$(cat "$run/session-refresher.pid")" 2>/dev/null || true; rm -f "$run/session-refresher.pid"; fi
  "${docker[@]}" rm -f "$RECEIVER_PROJECT-driver" "$RECEIVER_PROJECT-forward-adapter" "$RECEIVER_PROJECT-forward-provider" >/dev/null 2>&1 || true
  if [[ -n ${RECEIVER_KNOWLEDGE_ENV:-} ]]; then
    knowledge=$(sed -n 's/^COMPOSE_PROJECT_NAME=\(kailo-knowledge-receiver[a-z0-9_-]*\)$/\1/p' "$RECEIVER_KNOWLEDGE_ENV")
    [[ -z $knowledge ]] || "${docker[@]}" compose --project-name "$knowledge" --env-file "$RECEIVER_KNOWLEDGE_ENV" \
      -f "$src/knowledge/fork/deploy/compose.yaml" down --volumes --remove-orphans
  fi
  if [[ -n ${RECEIVER_CELLS_ENV:-} ]]; then
    cells=$(sed -n 's/^CELLS_COMPOSE_PROJECT=\(kailo-cells-conformance[a-z0-9_-]*\)$/\1/p' "$RECEIVER_CELLS_ENV")
    [[ -z $cells ]] || "${docker[@]}" compose --project-name "$cells" --env-file "$RECEIVER_CELLS_ENV" \
      -f "$src/file-storage/deploy/compose.yaml" down --volumes --remove-orphans
  fi
  if [[ -f $platform/compose.yaml ]]; then
    [[ $(sed -n 's/^name: //p' "$platform/compose.yaml") == "$RECEIVER_PROJECT" ]] \
      || { echo 'staged compose project is not this isolated run; refusing to remove it' >&2; exit 2; }
    compose down --volumes --remove-orphans
  fi
  "${docker[@]}" network rm "$RECEIVER_NETWORK" "$RECEIVER_PROJECT-edge" >/dev/null 2>&1 || true
  echo "isolated receiver deployment $RECEIVER_PROJECT removed; RUN_DIR records are kept"
  ;;
esac
