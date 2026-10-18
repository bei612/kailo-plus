#!/usr/bin/env bash
# Isolated conformance inputs for one built-in REMOTE_ADAPTER release
# (.design/07 §8A, DD-76/102; Core component_release.rs + Worker
# component_conformance.go consume the result). CI node only; every Node step
# runs in the constrained, digest-pinned SDK image (AGENTS.md rule 22), never on
# the host toolchain. Nothing here touches production Core, its database,
# production OpenBao or a production binding: the native instance, adapter and
# PEP provider live in a dedicated Compose project on a dedicated network.
#
#   conformance-run.sh <file-storage|knowledge> /abs/run.env
#
# Stages (each refuses to continue on failure; re-runs need a fresh RUN_DIR):
#   0 gate      vector-requirements.mjs: frozen vectors vs. native mintability
#               (exit 3 = release blocked by the contract, nothing started)
#   1 native    the component's own start.sh with the isolated env (Cells; the
#               knowledge pipeline continues in receiver-run.sh after stage 0)
#   2 seed      native-API fixture (Cells: seed-cells.mjs) -> native-facts.json;
#               for V2 vectors (DD-124) it records each case precondition as the
#               identity the native entry returned (never a vector value)
#   3 delivery  isolated native-action delivery + adapter (start.sh --platform-adapter)
#   4 observe   observe.mjs (ephemeral signer + in-process provider) -> facts.json;
#               observe.json nativeFactsFile=<seed out> carries those precondition
#               values unchanged (CAPTURE values exist only in Core's own run)
#   5 inputs    conformance-inputs.mjs -> fixture.json (incl. preconditions)
#               identity.json environment.json
#   6 provider  publish Core's isolated identity JWKS to the adapter and keep the
#               suite PEP provider running for component_release.register
#
# run.env (mode 0600, operator-delivered, no secret values inline):
#   CONFORMANCE_SOURCE        fixed release tree (/volumes/kailo/ci/sources/<commit>/apps)
#   CONFORMANCE_RUN_DIR       new empty 0700 directory on /volumes/data
#   CONFORMANCE_NODE_IMAGE    <repo>@sha256:<digest> constrained Node SDK image
#   CONFORMANCE_NETWORK       dedicated docker network (internal; not platform-local_*)
#   CONFORMANCE_NATIVE_ENV    component start.sh env for the dedicated project
#   CONFORMANCE_DELIVERY_ENV  same project + native action/adapter delivery (stage 3)
#   CONFORMANCE_SEED_FILE     seed-cells.mjs input (stage 2, Cells)
#   CONFORMANCE_OBSERVE_FILE  observe.mjs input (stage 4)
#   CONFORMANCE_PROVIDER_FILE suite provider config (identityFile = RUN_DIR/inputs/identity.json)
#   CONFORMANCE_MANIFEST      render.mjs output manifest.json for this candidate
#   CONFORMANCE_CORE_JWKS     public JWKS of Core's isolated conformance identity
#   CONFORMANCE_ADAPTER_JWKS  the isolated adapter's actionTokenJwksFile
set -euo pipefail
component=${1:-}
run_env=${2:-}
case "$component" in file-storage|knowledge) ;; *) echo 'usage: conformance-run.sh <file-storage|knowledge> /abs/run.env' >&2; exit 2 ;; esac
[[ $run_env == /* && -f $run_env && ! -L $run_env && $(stat -c '%a' -- "$run_env") == 600 ]] || { echo 'run.env must be an absolute 0600 regular file' >&2; exit 2; }
set -a
# shellcheck disable=SC1090
source "$run_env"
set +a
for name in CONFORMANCE_SOURCE CONFORMANCE_RUN_DIR CONFORMANCE_NODE_IMAGE CONFORMANCE_NETWORK CONFORMANCE_NATIVE_ENV \
  CONFORMANCE_DELIVERY_ENV CONFORMANCE_OBSERVE_FILE CONFORMANCE_PROVIDER_FILE CONFORMANCE_MANIFEST CONFORMANCE_CORE_JWKS \
  CONFORMANCE_ADAPTER_JWKS; do
  [[ -n ${!name:-} ]] || { echo "run.env: $name required" >&2; exit 2; }
done
[[ $CONFORMANCE_NODE_IMAGE =~ ^[^[:space:]@]+@sha256:[0-9a-f]{64}$ ]] || { echo 'Node SDK image must be digest-pinned' >&2; exit 2; }
[[ $CONFORMANCE_NETWORK =~ ^kailo-conformance-[a-z0-9-]+$ ]] || { echo 'dedicated kailo-conformance-* network required' >&2; exit 2; }
[[ $CONFORMANCE_RUN_DIR == /volumes/data/* && -d $CONFORMANCE_RUN_DIR && $(stat -c '%a' -- "$CONFORMANCE_RUN_DIR") == 700 ]] \
  || { echo 'RUN_DIR must be an existing 0700 directory under /volumes/data' >&2; exit 2; }
[[ -z $(ls -A -- "$CONFORMANCE_RUN_DIR") ]] || { echo 'RUN_DIR must be empty: every run re-seeds a fresh isolated instance' >&2; exit 2; }
src=$CONFORMANCE_SOURCE
run=$CONFORMANCE_RUN_DIR
read -r -a docker <<<"${CONFORMANCE_DOCKER:-sudo -n docker}"
start=$src/file-storage/deploy/start.sh

# Operator inputs outside RUN_DIR are bind-mounted at the same absolute path;
# CONFORMANCE_MOUNTS adds further absolute input paths (space separated).
mounts=()
for file in "$CONFORMANCE_OBSERVE_FILE" "$CONFORMANCE_PROVIDER_FILE" "$CONFORMANCE_MANIFEST" "$CONFORMANCE_CORE_JWKS" \
  "$(dirname -- "$CONFORMANCE_ADAPTER_JWKS")" ${CONFORMANCE_SEED_FILE:+"$CONFORMANCE_SEED_FILE"} ${CONFORMANCE_MOUNTS:-}; do
  [[ $file == /* ]] || { echo "input path must be absolute: $file" >&2; exit 2; }
  [[ $file == "$run"/* ]] || mounts+=(-v "$file:$file")
done
# Dedicated Compose project of the isolated native instance (never platform-local).
project_of() {
  python3 -I - "$1" <<'PY'
import re, sys
for line in open(sys.argv[1], encoding='utf-8'):
    m = re.match(r'^CELLS_COMPOSE_PROJECT=(kailo-cells-conformance[a-z0-9_-]*)\s*$', line.strip())
    if m:
        print(m.group(1)); break
else:
    sys.exit('dedicated kailo-cells-conformance* Compose project required')
PY
}

node_step() { # node_step <network|none> <alias|-> <script> [args...]
  local network=$1 alias=$2
  shift 2
  local args=(run --rm --read-only --cap-drop ALL --security-opt no-new-privileges --cpus 1 --memory 768m --memory-swap 768m
    --pids-limit 256 --tmpfs /tmp:rw,nosuid,nodev,size=64m -u "$(id -u):$(id -g)" -e HOME=/tmp
    -v "$src:/src:ro" -v "$run:$run" "${mounts[@]}" -w /src --network "$network")
  [[ $alias == - ]] || args+=(--network-alias "$alias")
  "${docker[@]}" "${args[@]}" "$CONFORMANCE_NODE_IMAGE" node "$@"
}

echo "[0/6] vector requirements ($component)"
set +e
node_step none - tools/component-release/conformance/vector-requirements.mjs --component "$component" --out "$run/requirements.json" >/dev/null
gate=$?
set -e
if [[ $gate == 3 ]]; then
  echo "BLOCKED: the frozen $component capability vectors reference native identities the native API cannot create;" >&2
  echo "see $run/requirements.json (.blocked). No isolated service was started. Register an implementation-neutral" >&2
  echo "contract version (capability_contract.register/approve, DD-102) instead of inventing fixtures." >&2
  exit 3
fi
[[ $gate == 0 ]] || { echo 'vector requirement analysis failed' >&2; exit 1; }
if [[ $component == knowledge ]]; then
  # DD-124(4): knowledge@3 cases depend on the service read edge; they run only
  # in the isolated receiver deployment (own Core/Worker/SpiceDB/Temporal/OpenBao).
  echo 'knowledge: vectors pass stage 0; continue with tools/component-release/receiver-run.sh (07 §8A receiver deployment)' >&2
  exit 3
fi

"${docker[@]}" network inspect "$CONFORMANCE_NETWORK" >/dev/null 2>&1 \
  || "${docker[@]}" network create --internal --label kailo.conformance="$component" "$CONFORMANCE_NETWORK" >/dev/null

echo "[1/6] isolated native instance"
bash "$start" "$CONFORMANCE_NATIVE_ENV"

echo "[2/6] native seed"
[[ -n ${CONFORMANCE_SEED_FILE:-} ]] || { echo 'CONFORMANCE_SEED_FILE required for Cells' >&2; exit 2; }
# Seeding happens before the platform delivery joins Cells to the conformance
# network; reach it on its own project UI network.
node_step "$(project_of "$CONFORMANCE_NATIVE_ENV")_cells-ui" - tools/component-release/conformance/seed-cells.mjs --seed "$CONFORMANCE_SEED_FILE"

echo "[3/6] isolated native-action delivery and adapter"
bash "$start" --check "$CONFORMANCE_DELIVERY_ENV"
# Same dedicated project, now with the platform native-action delivery that
# makes Cells accept only governed native writes (seeding is over).
project=$(project_of "$CONFORMANCE_DELIVERY_ENV")
[[ $project == "$(project_of "$CONFORMANCE_NATIVE_ENV")" ]] || { echo 'delivery env must target the same isolated project' >&2; exit 2; }
"${docker[@]}" compose --project-name "$project" --env-file "$CONFORMANCE_DELIVERY_ENV" \
  -f "$src/file-storage/deploy/compose.yaml" -f "$src/file-storage/deploy/compose.native-actions.yaml" \
  up --detach --no-build --pull never --force-recreate --no-deps --wait cells
bash "$start" --platform-adapter "$CONFORMANCE_DELIVERY_ENV"

echo "[4/6] observe the candidate adapter"
node_step "$CONFORMANCE_NETWORK" conformance-provider tools/component-release/conformance/observe.mjs --run "$CONFORMANCE_OBSERVE_FILE"

echo "[5/6] assemble Core conformance inputs"
install -d -m 0700 "$run/inputs"
node_step none - tools/component-release/conformance-inputs.mjs --facts "$run/facts.json" --manifest "$CONFORMANCE_MANIFEST" --out "$run/inputs"

echo "[6/6] suite PEP provider"
install -m 0600 "$CONFORMANCE_CORE_JWKS" "$CONFORMANCE_ADAPTER_JWKS.next"
mv -f "$CONFORMANCE_ADAPTER_JWKS.next" "$CONFORMANCE_ADAPTER_JWKS"
name=kailo-conformance-provider-$component
"${docker[@]}" rm -f "$name" >/dev/null 2>&1 || true
"${docker[@]}" run -d --name "$name" --restart no --read-only --cap-drop ALL --security-opt no-new-privileges --cpus 0.5 --memory 256m \
  --memory-swap 256m -u "$(id -u):$(id -g)" -e HOME=/tmp -e CONFORMANCE_PROVIDER_CONFIG_FILE="$CONFORMANCE_PROVIDER_FILE" \
  -v "$src:/src:ro" -v "$run:$run:ro" "${mounts[@]}" -w /src --network "$CONFORMANCE_NETWORK" --network-alias conformance-provider \
  "$CONFORMANCE_NODE_IMAGE" node tools/component-release/conformance-provider.mjs >/dev/null
cat <<EOF
Isolated conformance inputs ready (no production state changed):
  COMPONENT_CONFORMANCE_FIXTURE_FILE=$run/inputs/fixture.json
  COMPONENT_CONFORMANCE_IDENTITY_FILE=$run/inputs/identity.json
  COMPONENT_CONFORMANCE_ENVIRONMENT_FILE=$run/inputs/environment.json
Deliver them read-only to core-bff/worker (deploy/local start-core.sh --no-build) and attach the Worker
to $CONFORMANCE_NETWORK only for the registration window; this script does neither.
EOF
