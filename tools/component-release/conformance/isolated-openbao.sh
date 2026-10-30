#!/usr/bin/env bash
# 07 §8A, DD-70/94: the isolated OpenBao and component OpenBao Agent of one
# conformance candidate adapter. The adapter's validate_binding reads each
# binding SecretRef through the Agent api_proxy socket
# (client-kit/adapter/protocol.mjs readSecretDeliveryReceipt) and Core compares
# the read evidence (component_release.rs binding_comparison); without an
# OpenBao the protocol_binding case cannot pass. CI node only.
#
# Nothing here touches platform-local-openbao, a production namespace or a
# production credential. The server runs as its own container with raft
# storage in a fresh named volume and the same invariants as
# deploy/local/secret-store-config.hcl (no -dev mode, declarative file audit
# device); it holds only the simulated binding's SecretRefs at the exact
# locators/versions of the rendered adapter configuration, with values the
# operator delivers as owner-only files (the isolated Cells service PAT, the
# suite provider's binding client secret). Root token and unseal key enter
# containers only on stdin and stay in the owner-only state directory.
# adapter-delivery.py reader then writes the reader policy/AppRole and Agent
# HCL exactly as for a real binding; the Agent itself is the original
# deploy/components/compose.adapter-agent.yaml on the run's network.
#
#   isolated-openbao.sh up   /abs/openbao.env
#   isolated-openbao.sh down /abs/openbao.env
#
# openbao.env (absolute 0600 regular file):
#   OPENBAO_CONFORMANCE_SOURCE        fixed release tree (/volumes/kailo/ci/sources/<commit>/apps)
#   OPENBAO_CONFORMANCE_NAME          kailo-openbao-conformance-<id> (container, volume, setup network)
#   OPENBAO_CONFORMANCE_IMAGE         <repo>@sha256:<digest>, the platform OpenBao digest
#   OPENBAO_CONFORMANCE_PORT          free 127.0.0.1 port for the operator-side setup API
#   OPENBAO_CONFORMANCE_STATE_DIR     empty 0700 directory under /var/lib/kailo-ci (NVMe) or /volumes/data before `up`
#   OPENBAO_CONFORMANCE_NETWORK       the run's kailo-conformance-* network (alias conformance-openbao)
#   OPENBAO_CONFORMANCE_ADAPTER_CONFIG rendered adapter configuration (adapter-delivery.py config)
#   OPENBAO_CONFORMANCE_SECRETS       space-separated secretKey=/abs/owner-only-value-file, one per SecretRef
#   OPENBAO_CONFORMANCE_ROLE          AppRole name of the adapter reader
#   OPENBAO_CONFORMANCE_EXTRA_SECRETS (optional) secretKeys also rendered into ADAPTER_AGENT_EXTRA_DIR
#   ADAPTER_AGENT_PROJECT ADAPTER_AGENT_UID ADAPTER_AGENT_GID ADAPTER_AGENT_BOOTSTRAP_DIR
#   ADAPTER_AGENT_DELIVERY_DIR [ADAPTER_AGENT_EXTRA_DIR]  (compose.adapter-agent.yaml; the Agent
#                                     image is OPENBAO_CONFORMANCE_IMAGE, its network the run's)
set -euo pipefail
action=${1:-}
env_file=${2:-}
case "$action" in up|down) ;; *) echo 'usage: isolated-openbao.sh up|down /abs/openbao.env' >&2; exit 2 ;; esac
[[ $env_file == /* && -f $env_file && ! -L $env_file && $(stat -c '%a' -- "$env_file") == 600 ]] \
  || { echo 'openbao.env must be an absolute 0600 regular file' >&2; exit 2; }
set -a
# shellcheck disable=SC1090
source "$env_file"
set +a
for name in OPENBAO_CONFORMANCE_SOURCE OPENBAO_CONFORMANCE_NAME OPENBAO_CONFORMANCE_IMAGE OPENBAO_CONFORMANCE_STATE_DIR \
  OPENBAO_CONFORMANCE_NETWORK ADAPTER_AGENT_PROJECT; do
  [[ -n ${!name:-} ]] || { echo "openbao.env: $name required" >&2; exit 2; }
done
name=$OPENBAO_CONFORMANCE_NAME
state=$OPENBAO_CONFORMANCE_STATE_DIR
[[ $name =~ ^kailo-openbao-conformance-[a-z0-9-]+$ ]] || { echo 'OPENBAO_CONFORMANCE_NAME must be kailo-openbao-conformance-*' >&2; exit 2; }
[[ $OPENBAO_CONFORMANCE_NETWORK =~ ^kailo-conformance-[a-z0-9-]+$ ]] || { echo 'dedicated kailo-conformance-* network required' >&2; exit 2; }
[[ $OPENBAO_CONFORMANCE_IMAGE =~ ^[^[:space:]@]+@sha256:[0-9a-f]{64}$ ]] || { echo 'OpenBao image must be digest-pinned' >&2; exit 2; }
[[ ( $state == /var/lib/kailo-ci/* || $state == /volumes/data/* ) && -d $state && ! -L $state && $(stat -c '%a' -- "$state") == 700 ]] \
  || { echo 'OPENBAO_CONFORMANCE_STATE_DIR must be an existing 0700 directory under /var/lib/kailo-ci or /volumes/data' >&2; exit 2; }
read -r -a docker <<<"${OPENBAO_CONFORMANCE_DOCKER:-sudo -n docker}"
ADAPTER_AGENT_IMAGE=$OPENBAO_CONFORMANCE_IMAGE
ADAPTER_AGENT_PLATFORM_NETWORK=$OPENBAO_CONFORMANCE_NETWORK
# The Agent Compose file only interpolates ADAPTER_AGENT_*. `sudo` resets the
# environment (env_reset), so exported values never reach `sudo -n docker
# compose`; pass them explicitly as `<wrapper...> env NAME=VALUE... <docker>
# compose`. The last word of OPENBAO_CONFORMANCE_DOCKER is the docker binary,
# anything before it (e.g. `sudo -n`) its wrapper, so an override such as plain
# `docker` keeps working. Values are non-secret paths, ids and a digest.
agent_env=()
for variable in ADAPTER_AGENT_PROJECT ADAPTER_AGENT_IMAGE ADAPTER_AGENT_UID ADAPTER_AGENT_GID \
  ADAPTER_AGENT_BOOTSTRAP_DIR ADAPTER_AGENT_DELIVERY_DIR ADAPTER_AGENT_PLATFORM_NETWORK ADAPTER_AGENT_EXTRA_DIR \
  ADAPTER_AGENT_CPUS ADAPTER_AGENT_MEMORY; do
  [[ -z ${!variable:-} ]] || agent_env+=("$variable=${!variable}")
done
agent=("${docker[@]:0:${#docker[@]}-1}" env "${agent_env[@]}" "${docker[-1]}"
  compose -f "$OPENBAO_CONFORMANCE_SOURCE/deploy/components/compose.adapter-agent.yaml")
[[ -z ${ADAPTER_AGENT_EXTRA_DIR:-} ]] \
  || agent+=(-f "$OPENBAO_CONFORMANCE_SOURCE/deploy/components/compose.adapter-agent.native.yaml")

if [[ $action == down ]]; then
  "${agent[@]}" down --remove-orphans >/dev/null 2>&1 || true
  "${docker[@]}" rm -f "$name" >/dev/null 2>&1 || true
  "${docker[@]}" volume rm "$name-data" >/dev/null 2>&1 || true
  "${docker[@]}" network rm "$name-setup" >/dev/null 2>&1 || true
  echo "isolated OpenBao $name and its Agent removed; $state is kept for inspection"
  exit 0
fi

for name_ in OPENBAO_CONFORMANCE_PORT OPENBAO_CONFORMANCE_ADAPTER_CONFIG OPENBAO_CONFORMANCE_SECRETS OPENBAO_CONFORMANCE_ROLE \
  ADAPTER_AGENT_UID ADAPTER_AGENT_GID ADAPTER_AGENT_BOOTSTRAP_DIR ADAPTER_AGENT_DELIVERY_DIR; do
  [[ -n ${!name_:-} ]] || { echo "openbao.env: $name_ required for up" >&2; exit 2; }
done
[[ $OPENBAO_CONFORMANCE_PORT =~ ^[0-9]{2,5}$ ]] || { echo 'OPENBAO_CONFORMANCE_PORT must be a port' >&2; exit 2; }
[[ -z $(ls -A -- "$state") ]] || { echo 'OPENBAO_CONFORMANCE_STATE_DIR must be empty: every run starts a fresh isolated OpenBao' >&2; exit 2; }
for existing in container volume network; do
  for object in "$name" "$name-data" "$name-setup"; do
    if "${docker[@]}" "$existing" inspect "$object" >/dev/null 2>&1; then
      echo "$existing $object already exists; run down first" >&2; exit 2
    fi
  done
done

# Exact SecretRefs of the rendered adapter configuration and their delivered
# values: one owner-only file per secretKey, nothing defaulted or generated.
plan=$(python3 -I - "$OPENBAO_CONFORMANCE_ADAPTER_CONFIG" "$OPENBAO_CONFORMANCE_SECRETS" <<'PY'
import json, os, re, stat, sys
config_path, secrets = sys.argv[1:3]
config = json.load(open(config_path, encoding='utf-8'))
tenant = config['tenantId']
if not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', tenant):
    sys.exit('adapter configuration tenantId must be a canonical UUID')
files = {}
for item in secrets.split():
    key, sep, path = item.partition('=')
    if not sep or not re.fullmatch(r'[A-Za-z0-9_-]+', key) or key in files or not os.path.isabs(path):
        sys.exit('OPENBAO_CONFORMANCE_SECRETS needs unique secretKey=/abs/file entries')
    info = os.lstat(path)
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
        sys.exit(f'{path}: owner-only regular file required')
    files[key] = path
entries = []
for entry in config['management']['validation']['secretDeliveries']:
    locator = entry['locator']
    parts = locator.split('/')
    if (len(parts) < 4 or parts[0] != 'tenants' or parts[1] != tenant or entry['version'] != 1
            or not all(re.fullmatch(r'[A-Za-z0-9_-]+', p) for p in parts[2:])
            or entry['secretValueKey'] != 'value' or entry['secretKey'] not in files):
        sys.exit(f"SecretRef {entry.get('secretKey')}: tenants/<tenantId>/<mount>/<path> version 1 with a delivered value required")
    entries.append([entry['secretKey'], parts[2], '/'.join(parts[3:]), files.pop(entry['secretKey'])])
if files:
    sys.exit('OPENBAO_CONFORMANCE_SECRETS names a key that is not a SecretRef of this binding: ' + ','.join(sorted(files)))
print(json.dumps({'tenant': tenant, 'entries': entries}))
PY
)

umask 077
cat > "$state/config.hcl" <<EOF
ui = false
storage "raft" {
  path    = "/openbao/data"
  node_id = "$name"
}
listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = true
}
api_addr     = "http://conformance-openbao:8200"
cluster_addr = "http://conformance-openbao:8201"
audit "file" "file/" {
  options = {
    file_path = "/openbao/data/audit.log"
  }
}
EOF
# The server user (openbao) reads this single mounted file; it holds no secret.
chmod 0644 "$state/config.hcl"
"${docker[@]}" network create --label kailo.conformance.openbao="$name" "$name-setup" >/dev/null
"${docker[@]}" volume create --label kailo.conformance.openbao="$name" "$name-data" >/dev/null
# A fresh named volume is root-owned; the server runs as the image's openbao user
# (uid 100), as the platform service does (deploy/local/compose.yaml user 100).
"${docker[@]}" run --rm --network none --user 0 --entrypoint chown --mount "type=volume,src=$name-data,dst=/openbao/data" \
  "$OPENBAO_CONFORMANCE_IMAGE" 100:1000 /openbao/data
"${docker[@]}" run -d --name "$name" --restart no --cap-add IPC_LOCK --cpus 0.5 --memory 256m --memory-swap 256m \
  --security-opt no-new-privileges --user 100:1000 -e BAO_ADDR=http://127.0.0.1:8200 \
  --mount "type=bind,src=$state/config.hcl,dst=/openbao/config/config.hcl,readonly" \
  --mount "type=volume,src=$name-data,dst=/openbao/data" \
  --network "$name-setup" -p "127.0.0.1:$OPENBAO_CONFORMANCE_PORT:8200" \
  "$OPENBAO_CONFORMANCE_IMAGE" server -config=/openbao/config/config.hcl >/dev/null
"${docker[@]}" network connect --alias conformance-openbao "$OPENBAO_CONFORMANCE_NETWORK" "$name"

bao() { "${docker[@]}" exec "$name" bao "$@" </dev/null; }
bao_stdin() { "${docker[@]}" exec -i "$name" bao "$@"; }
# Token on stdin only (deploy/local/secret-store-init.sh run_bao convention).
as_root() { # as_root <namespace|""> args...; extra stdin after the token is passed through
  local namespace=$1
  shift
  local env=()
  [[ -z $namespace ]] || env=(-e "BAO_NAMESPACE=$namespace")
  { printf '%s\n' "$root_token"; cat; } | "${docker[@]}" exec -i "${env[@]}" "$name" \
    sh -c 'IFS= read -r BAO_TOKEN; export BAO_TOKEN; exec bao "$@"' bao "$@"
}
# A fresh server answers status (sealed, exit 2) before it is initialized.
initialized=
for _ in $(seq 60); do
  initialized=$(bao status -format=json 2>/dev/null | python3 -I -c 'import json,sys
try:
    print(json.load(sys.stdin)["initialized"])
except Exception:
    pass' || true)
  [[ -n $initialized ]] && break
  sleep 2
done
[[ $initialized == False ]] || { echo 'isolated OpenBao is not a fresh, uninitialized server' >&2; exit 1; }
bao operator init -key-shares=1 -key-threshold=1 -format=json > "$state/openbao_init.json.next"
[[ -s $state/openbao_init.json.next ]] || { echo 'isolated OpenBao init returned nothing' >&2; exit 1; }
mv "$state/openbao_init.json.next" "$state/openbao_init.json"
python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["unseal_keys_b64"][0])' "$state/openbao_init.json" \
  | tr -d '\n' | bao_stdin write sys/unseal key=- >/dev/null
root_token=$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["root_token"])' "$state/openbao_init.json")
ready=no
for _ in $(seq 60); do
  ready=$(bao status -format=json 2>/dev/null | python3 -I -c 'import json,sys
try:
    d = json.load(sys.stdin)
except Exception:
    print("no"); raise SystemExit
print("yes" if not d.get("sealed", True) and d.get("ha_mode") != "standby" else "no")' || echo no)
  [[ $ready == yes ]] && break
  sleep 2
done
[[ $ready == yes ]] || { echo 'isolated OpenBao did not become writable' >&2; exit 1; }
as_root "" audit list </dev/null | grep -q '^file/' || { echo 'isolated OpenBao audit device is not active' >&2; exit 1; }

tenant=$(python3 -I -c 'import json,sys; print(json.loads(sys.argv[1])["tenant"])' "$plan")
as_root "" namespace create tenants </dev/null >/dev/null
as_root tenants namespace create "$tenant" </dev/null >/dev/null
as_root "tenants/$tenant" auth enable approle </dev/null >/dev/null
mapfile -t mounts < <(python3 -I -c 'import json,sys; print("\n".join(sorted({e[1] for e in json.loads(sys.argv[1])["entries"]})))' "$plan")
for mount in "${mounts[@]}"; do
  as_root "tenants/$tenant" secrets enable -path="$mount" -version=2 kv </dev/null >/dev/null
done
# Each simulated binding SecretRef is written exactly once (version 1), the
# value read from its owner-only file and passed on stdin, never as an argument.
while IFS=$'\t' read -r key mount path file; do
  python3 -I -c 'import sys; sys.stdout.write(open(sys.argv[1], encoding="utf-8").read().strip())' "$file" \
    | as_root "tenants/$tenant" kv put -mount="$mount" -cas=0 "$path" value=- >/dev/null
  version=$(as_root "tenants/$tenant" kv metadata get -format=json -mount="$mount" "$path" </dev/null \
    | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["data"]["current_version"])')
  [[ $version == 1 ]] || { echo "SecretRef $key was not written as version 1" >&2; exit 1; }
done < <(python3 -I -c 'import json,sys
for key, mount, path, file in json.loads(sys.argv[1])["entries"]:
    print("\t".join((key, mount, path, file)))' "$plan")

reader=(python3 -I "$OPENBAO_CONFORMANCE_SOURCE/deploy/components/adapter-delivery.py" reader
  --config "$OPENBAO_CONFORMANCE_ADAPTER_CONFIG" --role "$OPENBAO_CONFORMANCE_ROLE"
  --bootstrap-dir "$ADAPTER_AGENT_BOOTSTRAP_DIR" --bao-url "http://127.0.0.1:$OPENBAO_CONFORMANCE_PORT"
  --agent-bao-url http://conformance-openbao:8200 --root-token-file "$state/openbao_init.json")
if [[ -n ${ADAPTER_AGENT_EXTRA_DIR:-} ]]; then
  reader+=(--extra-delivery-dir "$ADAPTER_AGENT_EXTRA_DIR")
  for key in ${OPENBAO_CONFORMANCE_EXTRA_SECRETS:-}; do reader+=(--extra-secret "$key"); done
fi
"${reader[@]}"
"${agent[@]}" config --quiet
"${agent[@]}" up -d --no-build --pull never adapter-agent
socket=$(python3 -I -c 'import json,sys
d = json.load(open(sys.argv[1], encoding="utf-8"))["management"]["validation"]["secretDeliveries"]
print(d[0]["secretSocket"])' "$OPENBAO_CONFORMANCE_ADAPTER_CONFIG")
for _ in $(seq 60); do [[ -S $socket ]] && break; sleep 2; done
[[ -S $socket ]] || { echo 'Agent socket did not appear; inspect the Agent log (it carries no secret)' >&2; exit 1; }
echo "isolated OpenBao $name ready for the candidate adapter (tenants/$tenant; Agent socket $socket); no platform state changed"
