#!/usr/bin/env bash
# Isolated conformance inputs for one built-in REMOTE_ADAPTER release
# (.design/07 §8A, DD-76/102; Core component_release.rs + Worker
# component_conformance.go consume the result). CI node only; every Node step
# runs in the constrained, digest-pinned SDK image (AGENTS.md rule 22), never on
# the host toolchain. Nothing here touches production Core, its database,
# production OpenBao or a production binding: the native instance, adapter and
# PEP provider live in a dedicated Compose project on a dedicated network.
#
#   conformance-run.sh <file-storage|knowledge|data-query> /abs/run.env [--stage <0-6>]
#
# Without --stage every stage runs in order. With --stage <n> only stage n runs,
# so operator-minted native facts can be supplied between stages without
# inventing them: the Cells admin/actor PATs (`cells admin user token` of the
# isolated instance) after stage 1 for the stage-2 seed file, and the observed
# nativeRootRef / nativeWorkspaceId (stage-2 native-facts.json) for the stage-3
# delivery env and the isolated adapter plan (conformance/isolated-plan.py: fresh
# simulated tenant/binding/actor/result-policy ids; never component-bind.mjs,
# whose production identities Core's authorize_probe refuses as ScopeGuardFailed).
# run.env is re-read by every invocation and only the variables of the
# requested stage are required. Stage 0 needs an empty RUN_DIR; stage n>0
# needs RUN_DIR/stage-<n-1>.done and refuses when RUN_DIR/stage-<n>.done
# already exists (a failed stage is investigated, not silently repeated; a new
# run uses a fresh RUN_DIR).
#
# Stages (each refuses to continue on failure):
#   0 gate      vector-requirements.mjs: frozen vectors vs. native mintability
#               (exit 3 = release blocked by the contract, nothing started)
#   1 native    the component's own start.sh with the isolated env (Cells; the
#               knowledge pipeline continues in receiver-run.sh after stage 0)
#   2 seed      native-API fixture (Cells: seed-cells.mjs) -> native-facts.json;
#               for V2 vectors (DD-124) it records each case precondition as the
#               identity the native entry returned (never a vector value)
#   3 delivery  isolated OpenBao + Agent (CONFORMANCE_OPENBAO_ENV), then the isolated
#               native-action delivery + adapter (start.sh --check, --platform-adapter)
#   4 observe   observe.mjs (ephemeral signer + in-process provider) -> facts.json;
#               observe.json nativeFactsFile=<seed out> carries those precondition
#               values unchanged (CAPTURE values exist only in Core's own run)
#   5 inputs    conformance-inputs.mjs -> fixture.json (incl. preconditions)
#               identity.json environment.json
#   6 provider  publish Core's isolated identity JWKS to the adapter and keep the
#               suite PEP provider running for component_release.register
#
# run.env (mode 0600, operator-delivered, no secret values inline; per stage):
#   CONFORMANCE_SOURCE        fixed release tree (/volumes/kailo/ci/sources/<commit>/apps)
#   CONFORMANCE_RUN_DIR       new empty 0700 directory on /volumes/data
#   CONFORMANCE_NODE_IMAGE    <repo>@sha256:<digest> constrained Node SDK image
#   CONFORMANCE_NETWORK       dedicated docker network (internal; not platform-local_*)
#   CONFORMANCE_NATIVE_ENV    component start.sh env for the dedicated project
#   CONFORMANCE_DELIVERY_ENV  same project + native action/adapter delivery (stage 3)
#   CONFORMANCE_OPENBAO_ENV   (stage 3, optional) conformance/isolated-openbao.sh env: the run's
#                             isolated OpenBao + component Agent for the adapter SecretRefs
#                             (remove afterwards with isolated-openbao.sh down)
#   CONFORMANCE_SEED_FILE     seed-cells.mjs input (stage 2, Cells)
#   CONFORMANCE_OBSERVE_FILE  observe.mjs input (stage 4)
#   CONFORMANCE_PROVIDER_FILE suite provider config (identityFile = RUN_DIR/inputs/identity.json)
#                             plus releaseManifestFile = CONFORMANCE_MANIFEST and nativeTaskTypes
#                             {"file_storage.delete@v2":"job"} when the release declares native
#                             task deadlines (DD-124(7); also in observe.json "provider")
#   CONFORMANCE_MANIFEST      render.mjs output manifest.json for this candidate
#   CONFORMANCE_CORE_JWKS     public JWKS of Core's isolated conformance identity
#   CONFORMANCE_ADAPTER_JWKS  the isolated adapter's actionTokenJwksFile
#
# data-query (Wren on data_query@2, DD-124(3); data-query/docker/conformance/README.md).
# Wren has no start.sh and no separate native-action delivery; its PEP provider is
# the Wren precedent data-query/docker/conformance/provider.mjs (it re-reads the
# native PostgreSQL and answers the query consumers' sourceResources). Stages:
#   1 native    dedicated Compose project (WREN_COMPOSE_PROJECT_NAME=kailo-wren-conformance*)
#               from data-query/docker/docker-compose.yaml only; the operator then does the
#               original Wren onboarding (connect the isolated PostgreSQL source, select the
#               table the vectors' describe/query expect as the model) and mints the native
#               HUMAN token of the preparation file
#   2 seed      the same project with the query-governance.yaml overlay (wren-ui joins
#               CONFORMANCE_NETWORK as WREN_QUERY_PLATFORM_NETWORK), then `provider.mjs prepare`:
#               the original GraphQL deploy; the deployment id/hash Wren generates are only
#               recorded in the owner-only nativeFixtureFile, never vector values
#   3 delivery  `provider.mjs observe`: idempotent re-observation of that same SUCCESS deployment
#   4 observe   observe.mjs with the Wren query/binding deliveries and the Wren provider
#   6 provider  the Wren provider for Core's identity (CONFORMANCE_PROVIDER_FILE is its
#               WREN_CONFORMANCE_CONFIG_FILE: identityFile/environmentFile = RUN_DIR/inputs/*)
# Additional run.env keys:
#   CONFORMANCE_WREN_NODE_MODULES       installed data-query/wren-ui node_modules of the same
#                                       yarn.lock (knex, pg), mounted read-only at /node_modules
#   CONFORMANCE_WREN_IDENTITY_JSON_FILE owner-only file with the instance's WREN_NATIVE_IDENTITY_JSON
#   CONFORMANCE_SEED_FILE               the provider config with preparationFile (stages 2-3)
# The Wren delivery files (query.json, binding.json, environment, database URL, native
# fixture output) live under RUN_DIR or are listed in CONFORMANCE_MOUNTS.
set -euo pipefail
component=${1:-}
run_env=${2:-}
only=
usage='usage: conformance-run.sh <file-storage|knowledge|data-query> /abs/run.env [--stage <0-6>]'
case "$#:${3:-}" in
  2:) ;;
  4:--stage) only=${4:-} ;;
  *) echo "$usage" >&2; exit 2 ;;
esac
[[ -z $only || $only =~ ^[0-6]$ ]] || { echo "$usage" >&2; exit 2; }
case "$component" in file-storage|knowledge|data-query) ;; *) echo "$usage" >&2; exit 2 ;; esac
[[ $run_env == /* && -f $run_env && ! -L $run_env && $(stat -c '%a' -- "$run_env") == 600 ]] || { echo 'run.env must be an absolute 0600 regular file' >&2; exit 2; }
set -a
# shellcheck disable=SC1090
source "$run_env"
set +a
need() { local name; for name in "$@"; do [[ -n ${!name:-} ]] || { echo "run.env: $name required for this stage" >&2; exit 2; }; done; }
need CONFORMANCE_SOURCE CONFORMANCE_RUN_DIR CONFORMANCE_NODE_IMAGE
[[ $CONFORMANCE_NODE_IMAGE =~ ^[^[:space:]@]+@sha256:[0-9a-f]{64}$ ]] || { echo 'Node SDK image must be digest-pinned' >&2; exit 2; }
[[ -z ${CONFORMANCE_NETWORK:-} || $CONFORMANCE_NETWORK =~ ^kailo-conformance-[a-z0-9-]+$ ]] || { echo 'dedicated kailo-conformance-* network required' >&2; exit 2; }
[[ $CONFORMANCE_RUN_DIR == /volumes/data/* && -d $CONFORMANCE_RUN_DIR && $(stat -c '%a' -- "$CONFORMANCE_RUN_DIR") == 700 ]] \
  || { echo 'RUN_DIR must be an existing 0700 directory under /volumes/data' >&2; exit 2; }
src=$CONFORMANCE_SOURCE
run=$CONFORMANCE_RUN_DIR
read -r -a docker <<<"${CONFORMANCE_DOCKER:-sudo -n docker}"
start=$src/file-storage/deploy/start.sh

# Stage bookkeeping: one marker per completed stage, written only after the
# stage succeeded. Markers carry no facts; the facts stay in their own files.
first=${only:-0}
last=${only:-6}
if [[ $first == 0 ]]; then
  [[ -z $(ls -A -- "$run") ]] || { echo 'RUN_DIR must be empty for stage 0: every run re-seeds a fresh isolated instance' >&2; exit 2; }
else
  [[ -f $run/stage-$((first - 1)).done ]] || { echo "stage $((first - 1)) has not completed in $run" >&2; exit 2; }
  [[ ! -e $run/stage-$first.done ]] || { echo "stage $first already completed in $run; use a fresh RUN_DIR for a new run" >&2; exit 2; }
fi
done_stage() { : > "$run/stage-$1.done"; }
wanted() { (( $1 >= first && $1 <= last )); }

# Operator inputs outside RUN_DIR are bind-mounted at the same absolute path;
# CONFORMANCE_MOUNTS adds further absolute input paths (space separated).
mounts=()
for file in "${CONFORMANCE_OBSERVE_FILE:-}" "${CONFORMANCE_PROVIDER_FILE:-}" "${CONFORMANCE_MANIFEST:-}" "${CONFORMANCE_CORE_JWKS:-}" \
  "${CONFORMANCE_ADAPTER_JWKS:+$(dirname -- "$CONFORMANCE_ADAPTER_JWKS")}" "${CONFORMANCE_SEED_FILE:-}" ${CONFORMANCE_MOUNTS:-}; do
  [[ -n $file ]] || continue
  [[ $file == /* ]] || { echo "input path must be absolute: $file" >&2; exit 2; }
  [[ $file == "$run"/* ]] || mounts+=(-v "$file:$file")
done
# Wren's provider resolves knex/pg from an installed wren-ui dependency tree.
wren_args=()
if [[ $component == data-query && -n ${CONFORMANCE_WREN_NODE_MODULES:-} ]]; then
  [[ $CONFORMANCE_WREN_NODE_MODULES == /* && -d $CONFORMANCE_WREN_NODE_MODULES/knex && -d $CONFORMANCE_WREN_NODE_MODULES/pg ]] \
    || { echo 'CONFORMANCE_WREN_NODE_MODULES must be an installed wren-ui node_modules (knex, pg)' >&2; exit 2; }
  wren_args+=(-v "$CONFORMANCE_WREN_NODE_MODULES:/node_modules:ro")
fi
# Dedicated Compose project of the isolated native instance (never platform-local).
project_of() {
  local key=CELLS_COMPOSE_PROJECT prefix=kailo-cells-conformance
  [[ $component != data-query ]] || { key=WREN_COMPOSE_PROJECT_NAME; prefix=kailo-wren-conformance; }
  python3 -I - "$1" "$key" "$prefix" <<'PY'
import re, sys
for line in open(sys.argv[1], encoding='utf-8'):
    m = re.match(r'^' + sys.argv[2] + r'=(' + sys.argv[3] + r'[a-z0-9_-]*)\s*$', line.strip())
    if m:
        print(m.group(1)); break
else:
    sys.exit(f'dedicated {sys.argv[3]}* Compose project required')
PY
}

node_env=() # extra -e NAME=value (non-secret configuration only)
node_step() { # node_step <network|none> <alias|-> <script> [args...]
  local network=$1 alias=$2
  shift 2
  local args=(run --rm --read-only --cap-drop ALL --security-opt no-new-privileges --cpus 1 --memory 768m --memory-swap 768m
    --pids-limit 256 --tmpfs /tmp:rw,nosuid,nodev,size=64m -u "$(id -u):$(id -g)" -e HOME=/tmp "${node_env[@]}"
    -v "$src:/src:ro" -v "$run:$run" "${mounts[@]}" "${wren_args[@]}" -w /src --network "$network")
  [[ $alias == - ]] || args+=(--network-alias "$alias")
  "${docker[@]}" "${args[@]}" "$CONFORMANCE_NODE_IMAGE" node "$@"
}

if wanted 0; then
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
  done_stage 0
fi

if [[ $component == data-query ]]; then
  # Wren (data_query@2): see the data-query section of the header.
  compose_files=(-f "$src/data-query/docker/docker-compose.yaml")
  governed_files=("${compose_files[@]}" -f "$src/data-query/docker/query-governance.yaml")
  wren_compose() { # wren_compose <env file> <compose files...> -- <compose args...>
    local env=$1 files=()
    shift
    while [[ $1 != -- ]]; do files+=("$1"); shift; done
    shift
    "${docker[@]}" compose --project-name "$(project_of "$env")" --env-file "$env" "${files[@]}" "$@"
  }
  wren_native() { # the project's own network: wren-ui, the native PostgreSQL and the provider alias
    printf '%s_wren' "$(project_of "$CONFORMANCE_NATIVE_ENV")"
  }
  wren_identity() {
    need CONFORMANCE_WREN_IDENTITY_JSON_FILE CONFORMANCE_WREN_NODE_MODULES
    local file=$CONFORMANCE_WREN_IDENTITY_JSON_FILE
    [[ $file == /* && -f $file && ! -L $file && $(stat -c '%a' -- "$file") == 600 ]] \
      || { echo 'CONFORMANCE_WREN_IDENTITY_JSON_FILE must be an absolute 0600 regular file' >&2; exit 2; }
    node_env=(-e "WREN_NATIVE_IDENTITY_JSON=$(<"$file")")
  }
  if wanted 1; then
    need CONFORMANCE_NETWORK CONFORMANCE_NATIVE_ENV
    "${docker[@]}" network inspect "$CONFORMANCE_NETWORK" >/dev/null 2>&1 \
      || "${docker[@]}" network create --internal --label kailo.conformance="$component" "$CONFORMANCE_NETWORK" >/dev/null
    echo "[1/6] isolated native Wren instance"
    wren_compose "$CONFORMANCE_NATIVE_ENV" "${compose_files[@]}" -- up --detach --no-build --pull never --wait
    done_stage 1
    if [[ -n $only ]]; then
      cat <<NEXT
Stage 1 done. In this isolated instance only, do the original Wren onboarding: connect the isolated PostgreSQL
source holding the table the frozen describe/query vectors expect, select it as the model, and mint the native
HUMAN token named by the preparation file. Then deliver the query/binding files of the governance overlay
(serviceTokenUrl/corePepUrl at the provider alias conformance-provider, WREN_QUERY_PLATFORM_NETWORK=$CONFORMANCE_NETWORK)
in CONFORMANCE_NATIVE_ENV, set CONFORMANCE_SEED_FILE, CONFORMANCE_WREN_IDENTITY_JSON_FILE and
CONFORMANCE_WREN_NODE_MODULES in $run_env and run --stage 2.
NEXT
    fi
  fi
  if wanted 2; then
    need CONFORMANCE_NETWORK CONFORMANCE_NATIVE_ENV CONFORMANCE_SEED_FILE
    wren_identity
    echo "[2/6] governance overlay and native seed (original GraphQL deploy)"
    wren_compose "$CONFORMANCE_NATIVE_ENV" "${governed_files[@]}" -- up --detach --no-build --pull never --force-recreate --no-deps --wait \
      wren-query-secret-agent wren-ui
    node_env+=(-e "WREN_CONFORMANCE_CONFIG_FILE=$CONFORMANCE_SEED_FILE")
    node_step "$(wren_native)" conformance-provider data-query/docker/conformance/provider.mjs prepare
    done_stage 2
  fi
  if wanted 3; then
    need CONFORMANCE_NATIVE_ENV CONFORMANCE_SEED_FILE
    wren_identity
    echo "[3/6] re-observe the seeded native deployment"
    node_env+=(-e "WREN_CONFORMANCE_CONFIG_FILE=$CONFORMANCE_SEED_FILE")
    node_step "$(wren_native)" conformance-provider data-query/docker/conformance/provider.mjs observe
    done_stage 3
  fi
  if wanted 4; then
    need CONFORMANCE_NATIVE_ENV CONFORMANCE_OBSERVE_FILE CONFORMANCE_WREN_NODE_MODULES
    echo "[4/6] observe the candidate adapter"
    node_step "$(wren_native)" conformance-provider tools/component-release/conformance/observe.mjs --run "$CONFORMANCE_OBSERVE_FILE"
    done_stage 4
  fi
  if wanted 5; then
    need CONFORMANCE_MANIFEST
    echo "[5/6] assemble Core conformance inputs"
    install -d -m 0700 "$run/inputs"
    node_step none - tools/component-release/conformance-inputs.mjs --facts "$run/facts.json" --manifest "$CONFORMANCE_MANIFEST" --out "$run/inputs"
    done_stage 5
  fi
  if wanted 6; then
    need CONFORMANCE_NATIVE_ENV CONFORMANCE_PROVIDER_FILE CONFORMANCE_CORE_JWKS CONFORMANCE_ADAPTER_JWKS CONFORMANCE_WREN_NODE_MODULES
    echo "[6/6] Wren suite PEP provider"
    install -m 0600 "$CONFORMANCE_CORE_JWKS" "$CONFORMANCE_ADAPTER_JWKS.next"
    mv -f "$CONFORMANCE_ADAPTER_JWKS.next" "$CONFORMANCE_ADAPTER_JWKS"
    name=kailo-conformance-provider-$component
    "${docker[@]}" rm -f "$name" >/dev/null 2>&1 || true
    "${docker[@]}" run -d --name "$name" --restart no --read-only --cap-drop ALL --security-opt no-new-privileges --cpus 0.5 --memory 384m \
      --memory-swap 384m -u "$(id -u):$(id -g)" -e HOME=/tmp -e WREN_CONFORMANCE_CONFIG_FILE="$CONFORMANCE_PROVIDER_FILE" \
      -v "$src:/src:ro" -v "$run:$run:ro" "${mounts[@]}" "${wren_args[@]}" -w /src --network "$(wren_native)" \
      --network-alias conformance-provider "$CONFORMANCE_NODE_IMAGE" node data-query/docker/conformance/provider.mjs >/dev/null
    done_stage 6
    cat <<NEXT
Isolated conformance inputs ready (no production state changed):
  COMPONENT_CONFORMANCE_FIXTURE_FILE=$run/inputs/fixture.json
  COMPONENT_CONFORMANCE_IDENTITY_FILE=$run/inputs/identity.json
  COMPONENT_CONFORMANCE_ENVIRONMENT_FILE=$run/inputs/environment.json
Deliver them read-only to core-bff/worker (deploy/local start-core.sh --no-build) and attach the Worker
to $CONFORMANCE_NETWORK (wren-ui joins it through the query overlay) only for the registration window.
NEXT
  fi
  exit 0
fi
[[ $component == file-storage ]] || { echo 'knowledge continues in receiver-run.sh after stage 0' >&2; exit 3; }

if wanted 1; then
  need CONFORMANCE_NETWORK CONFORMANCE_NATIVE_ENV
  "${docker[@]}" network inspect "$CONFORMANCE_NETWORK" >/dev/null 2>&1 \
    || "${docker[@]}" network create --internal --label kailo.conformance="$component" "$CONFORMANCE_NETWORK" >/dev/null
  echo "[1/6] isolated native instance"
  bash "$start" "$CONFORMANCE_NATIVE_ENV"
  done_stage 1
  if [[ -n $only ]]; then
    cat <<EOF
Stage 1 done. Mint, with the isolated instance's own 'cells admin user token', the native admin PAT and the
PAT of the native user linked to the conformance actor; store them owner-only, name them in the seed file
(adminTokenFile / actorTokenFile) and set CONFORMANCE_SEED_FILE in $run_env before --stage 2.
EOF
  fi
fi

if wanted 2; then
  need CONFORMANCE_NATIVE_ENV CONFORMANCE_SEED_FILE
  echo "[2/6] native seed"
  # Seeding happens before the platform delivery joins Cells to the conformance
  # network; reach it on its own project UI network.
  node_step "$(project_of "$CONFORMANCE_NATIVE_ENV")_cells-ui" - tools/component-release/conformance/seed-cells.mjs --seed "$CONFORMANCE_SEED_FILE"
  done_stage 2
  if [[ -n $only ]]; then
    cat <<EOF
Stage 2 done. Write the isolated bind plan from the seed output with fresh simulated identities (not
component-bind.mjs --plan-only: its production tenant/actor make Core refuse every probe, ScopeGuardFailed):
  python3 -I $src/tools/component-release/conformance/isolated-plan.py --release-dir <render.mjs output> \\
    --native-facts <seed out native-facts.json> --native-page-url <url> --native-instance-ref <ref> \\
    --kv-mount <isolated KV mount> [--actor-native-user <isolated native user uuid>] \\
    --plan-out $run/isolated-plan.json --context-out $run/isolated-context.json
Render the adapter and native action deliveries from that plan (adapter-delivery.py config --plan ...
--core-pep-url --oidc-token-url --action-token-audience; --set from isolated-context.json nativeActionSets,
--set-json actors), copy its principals / bindingManagement / resultExposurePolicy into observe.json and
providerBinding into the provider bindingFile, then set CONFORMANCE_DELIVERY_ENV (and CONFORMANCE_OPENBAO_ENV)
in $run_env and run --stage 3.
EOF
  fi
fi

if wanted 3; then
  need CONFORMANCE_NATIVE_ENV CONFORMANCE_DELIVERY_ENV
  echo "[3/6] isolated native-action delivery and adapter"
  # The adapter's validate_binding reads the simulated binding SecretRefs
  # through an OpenBao Agent; they live in the run's own isolated OpenBao
  # (never platform-local-openbao). The Agent also renders the callback
  # credential the native action delivery consumes, so it comes up before
  # start.sh --check verifies that delivery (a failed check leaves it for
  # inspection; remove it with isolated-openbao.sh down).
  if [[ -n ${CONFORMANCE_OPENBAO_ENV:-} ]]; then
    bash "$src/tools/component-release/conformance/isolated-openbao.sh" up "$CONFORMANCE_OPENBAO_ENV"
  fi
  bash "$start" --check "$CONFORMANCE_DELIVERY_ENV"
  # Same dedicated project, now with the platform native-action delivery that
  # makes Cells accept only governed native writes (seeding is over).
  project=$(project_of "$CONFORMANCE_DELIVERY_ENV")
  [[ $project == "$(project_of "$CONFORMANCE_NATIVE_ENV")" ]] || { echo 'delivery env must target the same isolated project' >&2; exit 2; }
  "${docker[@]}" compose --project-name "$project" --env-file "$CONFORMANCE_DELIVERY_ENV" \
    -f "$src/file-storage/deploy/compose.yaml" -f "$src/file-storage/deploy/compose.native-actions.yaml" \
    up --detach --no-build --pull never --force-recreate --no-deps --wait cells
  bash "$start" --platform-adapter "$CONFORMANCE_DELIVERY_ENV"
  done_stage 3
fi

if wanted 4; then
  need CONFORMANCE_NETWORK CONFORMANCE_OBSERVE_FILE
  echo "[4/6] observe the candidate adapter"
  node_step "$CONFORMANCE_NETWORK" conformance-provider tools/component-release/conformance/observe.mjs --run "$CONFORMANCE_OBSERVE_FILE"
  done_stage 4
fi

if wanted 5; then
  need CONFORMANCE_MANIFEST
  echo "[5/6] assemble Core conformance inputs"
  install -d -m 0700 "$run/inputs"
  node_step none - tools/component-release/conformance-inputs.mjs --facts "$run/facts.json" --manifest "$CONFORMANCE_MANIFEST" --out "$run/inputs"
  done_stage 5
fi

if wanted 6; then
  need CONFORMANCE_NETWORK CONFORMANCE_PROVIDER_FILE CONFORMANCE_CORE_JWKS CONFORMANCE_ADAPTER_JWKS
  echo "[6/6] suite PEP provider"
  install -m 0600 "$CONFORMANCE_CORE_JWKS" "$CONFORMANCE_ADAPTER_JWKS.next"
  mv -f "$CONFORMANCE_ADAPTER_JWKS.next" "$CONFORMANCE_ADAPTER_JWKS"
  name=kailo-conformance-provider-$component
  "${docker[@]}" rm -f "$name" >/dev/null 2>&1 || true
  "${docker[@]}" run -d --name "$name" --restart no --read-only --cap-drop ALL --security-opt no-new-privileges --cpus 0.5 --memory 256m \
    --memory-swap 256m -u "$(id -u):$(id -g)" -e HOME=/tmp -e CONFORMANCE_PROVIDER_CONFIG_FILE="$CONFORMANCE_PROVIDER_FILE" \
    -v "$src:/src:ro" -v "$run:$run:ro" "${mounts[@]}" -w /src --network "$CONFORMANCE_NETWORK" --network-alias conformance-provider \
    "$CONFORMANCE_NODE_IMAGE" node tools/component-release/conformance-provider.mjs >/dev/null
  done_stage 6
  cat <<EOF
Isolated conformance inputs ready (no production state changed):
  COMPONENT_CONFORMANCE_FIXTURE_FILE=$run/inputs/fixture.json
  COMPONENT_CONFORMANCE_IDENTITY_FILE=$run/inputs/identity.json
  COMPONENT_CONFORMANCE_ENVIRONMENT_FILE=$run/inputs/environment.json
Deliver them read-only to core-bff/worker (deploy/local start-core.sh --no-build) and attach the Worker
to $CONFORMANCE_NETWORK only for the registration window; this script does neither.
EOF
fi
