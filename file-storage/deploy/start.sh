#!/usr/bin/env bash
# Independent native Cells service. Does not create Kailo resources or identities.
set -euo pipefail
check_only=false
if [[ ${1:-} == --check ]]; then check_only=true; shift; fi
[[ $# == 1 && -f $1 ]] || { printf 'usage: bash start.sh [--check] CONTROLLED_ENV_FILE\n' >&2; exit 2; }
config=$(realpath -e -- "$1")
[[ $(stat -c '%a' -- "$config") == 600 ]] || { printf 'deployment env must be mode 0600\n' >&2; exit 2; }
here=$(cd -- "$(dirname -- "$0")" && pwd)
root=$(cd -- "$here/../.." && pwd)
set -a
# Same trusted, operator-delivered shell environment convention as deploy/local.
source "$config"
set +a
python3 - <<'PY'
import ipaddress, json, os, pathlib, re, stat, sys
from urllib.parse import unquote, urlsplit

def require(condition, reason):
    if not condition:
        raise ValueError(reason)

def secret_file(key):
    path = pathlib.Path(os.environ[key])
    require(path.is_absolute() and path.is_file(), key + ': existing absolute file required')
    require(stat.S_IMODE(path.stat().st_mode) == 0o600, key + ': mode 0600 required')
    return path.read_text()

try:
    env = os.environ
    require(re.fullmatch(r'kailo-cells-[a-z0-9][a-z0-9_-]*', env['CELLS_COMPOSE_PROJECT']), 'independent kailo-cells project required')
    require(re.fullmatch(r'[^\s@]+@sha256:[a-f0-9]{64}', env['CELLS_IMAGE']), 'recorded immutable native fork image required')
    connectors = json.loads(env['CELLS_OAUTH_CONNECTORS'])
    require(isinstance(connectors, list) and all(isinstance(c, dict) for c in connectors), 'native connector list required')
    oidc = [c for c in connectors if c.get('type') == 'kailo-oidc']
    require(len(oidc) == 1 and isinstance(oidc[0].get('config'), dict), 'one native OIDC connector required')
    require(oidc[0]['config'].get('clientSecretFile') == '/run/secrets/cells_oidc_client_secret', 'native connector credential must match the Compose secret mount')
    require(secret_file('CELLS_OIDC_CLIENT_SECRET_FILE').strip(), 'nonempty native OIDC client secret required')
    install = json.loads(secret_file('CELLS_INSTALL_FILE'))
    require(isinstance(install, dict), 'native install JSON object required')
    require(isinstance(install.get('frontendLogin'), str) and install['frontendLogin'].strip(), 'native admin login required; browser installer is not enabled')
    password = install.get('frontendPassword')
    require(isinstance(password, str) and password and password != 'admin', 'non-default delivered native admin credential required')
    require(not any(k in install for k in ('ProxyConfig', 'ProxyConfigs')), 'native proxy must use the sole deployment binding configuration')
    require(install.get('dbConnectionType') == 'manual', 'native manual database connection required')
    dsn = urlsplit(install['dbManualDSN'])
    require(dsn.scheme == 'postgres' and dsn.hostname == 'cells-db' and dsn.port == int(env['CELLS_DB_PORT']), 'native DSN must target this independent cells-db service')
    require(unquote(dsn.path.removeprefix('/')) == env['CELLS_DB_NAME'] and unquote(dsn.username or '') == env['CELLS_DB_USER'], 'native database name/user mismatch')
    require(unquote(dsn.password or '') == secret_file('CELLS_DB_PASSWORD_FILE').rstrip('\n') != '', 'native database password delivery mismatch')
    directories = []
    for key in ('CELLS_DATA_DIR', 'CELLS_DB_DATA_DIR'):
        path = pathlib.Path(env[key])
        require(path.is_absolute() and path.is_dir(), key + ': existing absolute directory required')
        real = path.resolve()
        require(str(real).startswith('/volumes/data/'), key + ': dedicated Data directory required')
        directories.append(real)
    require(not any(a == b or a in b.parents or b in a.parents for a, b in [directories]), 'Cells and database state directories must be disjoint')
    require(env['CELLS_NO_TLS'] in ('0', '1'), 'explicit native TLS choice required')
    require(int(env['CELLS_START_TIMEOUT_SECONDS']) > 0, 'positive deployment wait deadline required')
    origin = urlsplit(env['CELLS_EXTERNAL'])
    require(origin.scheme == ('http' if env['CELLS_NO_TLS'] == '1' else 'https') and origin.hostname and not origin.username and not origin.password and not origin.query and not origin.fragment and origin.path in ('', '/'), 'external origin must match explicit native TLS choice')
    ipaddress.ip_address(env['CELLS_PUBLIC_ADDRESS'])
    for key in ('CELLS_PUBLIC_PORT', 'CELLS_CONTAINER_PORT', 'CELLS_DB_PORT'):
        require(0 < int(env[key]) <= 65535, key + ': invalid port')
    require(env['CELLS_BIND'].endswith(':' + env['CELLS_CONTAINER_PORT']), 'native binding/container port mismatch')
    health = urlsplit(env['CELLS_HEALTH_URL'])
    require(health.hostname and ipaddress.ip_address(health.hostname).is_loopback and health.port == int(env['CELLS_CONTAINER_PORT']) and health.scheme == origin.scheme and health.path == '/a/frontend/bootconf' and not health.query and not health.fragment and not health.username, 'readiness must address the native loopback bootconf endpoint')
except (KeyError, ValueError, TypeError, AttributeError, OSError):
    # JSON/URI parser errors can contain secrets. Never print raw parser exceptions.
    print('Cells configuration refused: missing, unsafe, or inconsistent native delivery; no services started', file=sys.stderr)
    sys.exit(2)
print('Cells native delivery validated; no credential values emitted')
PY
source "$root/tools/container-safety.sh"
container_safety_init
compose=("${CONTAINER_DOCKER[@]}" compose --project-name "$CELLS_COMPOSE_PROJECT" --env-file "$config" -f "$here/compose.yaml")
"${compose[@]}" config --quiet
if "$check_only"; then exit 0; fi
container_resource_preflight
# All images are digest-pinned. No build, initializer outside this project, or shared DB.
"${compose[@]}" pull
"${compose[@]}" create --no-build --pull never
mapfile -t containers < <("${compose[@]}" ps --all --quiet)
[[ ${#containers[@]} == 2 ]] || { printf 'unexpected independent Cells service set\n' >&2; exit 2; }
for container in "${containers[@]}"; do container_verify_limits "$container"; done
"${compose[@]}" up --detach --no-build --no-recreate --pull never --wait --wait-timeout "${CELLS_START_TIMEOUT_SECONDS:?required}"
printf 'Independent Cells service started; Kailo SSO, bindings and tools are not asserted by this command\n'
