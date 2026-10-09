#!/usr/bin/env bash
# Independent native Cells service. Does not create Kailo resources or identities.
set -euo pipefail
check_only=false
platform_adapter=false
while [[ ${1:-} == --* ]]; do
  case "$1" in
    --check) check_only=true ;;
    --platform-adapter) platform_adapter=true ;;
    *) printf 'unknown deployment option\n' >&2; exit 2 ;;
  esac
  shift
done
[[ $# == 1 && -f $1 ]] || { printf 'usage: bash start.sh [--check] [--platform-adapter] CONTROLLED_ENV_FILE\n' >&2; exit 2; }
config=$(realpath -e -- "$1")
[[ $(stat -c '%a' -- "$config") == 600 ]] || { printf 'deployment env must be mode 0600\n' >&2; exit 2; }
here=$(cd -- "$(dirname -- "$0")" && pwd)
root=$(cd -- "$here/../.." && pwd)
set -a
# Same trusted, operator-delivered shell environment convention as deploy/local.
source "$config"
set +a
python3 - <<'PY'
import ipaddress, json, os, pathlib, re, stat, sys, uuid
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
    oauth_secret = json.loads(secret_file('CELLS_OAUTH_SECRET_FILE'))
    require(isinstance(oauth_secret, str) and oauth_secret.strip() and oauth_secret != 'a-very-insecure-secret-for-checking-out-the-demo', 'non-default independent native OAuth secret required')
    require(oauth_secret != secret_file('CELLS_OIDC_CLIENT_SECRET_FILE').strip(), 'native OAuth and external OIDC credentials must be independent')
    require(len([c for c in connectors if c.get('type') == 'pydio']) == 1, 'preserve the native password connector alongside federation')
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
    native_delivery = env.get('CELLS_NATIVE_ACTION_DELIVERY_DIR', '')
    native_config = env.get('CELLS_NATIVE_ACTION_CONFIG_FILE', '')
    require(bool(native_delivery) == bool(native_config), 'native actor directory and config must be delivered together')
    if native_config:
        directory = pathlib.Path(native_delivery)
        require(directory.is_absolute() and directory.is_dir() and directory == directory.resolve(), 'native action delivery must use a real absolute directory')
        owner = directory.stat().st_uid
        require(stat.S_IMODE(directory.stat().st_mode) == 0o700 and all(directory != p and directory not in p.parents and p not in directory.parents for p in directories), 'native action delivery must be owner-only and separate from data')
        if env.get('CELLS_ADAPTER_DELIVERY_DIR'):
            adapter_directory = pathlib.Path(env['CELLS_ADAPTER_DELIVERY_DIR']).resolve()
            require(directory != adapter_directory and directory not in adapter_directory.parents and adapter_directory not in directory.parents, 'native and adapter delivery mounts must be separate')
        def native_file(value):
            path = pathlib.Path(value)
            require(path.is_absolute() and path == path.resolve() and directory in path.parents and path.is_file(), 'native action file is outside its delivery')
            entry = path.stat()
            require(entry.st_uid == owner and stat.S_IMODE(entry.st_mode) in (0o400, 0o600), 'native action file must be owner-readable only')
            return path
        delivery = json.loads(native_file(native_config).read_text())
        required = {'bindingId', 'tenantId', 'nativeInstanceRef', 'nativeScopeRef', 'nativeRootRef', 'actors',
                    'corePepUrl', 'oidcTokenUrl', 'clientId', 'clientSecretFile', 'instanceServiceUuid',
                    'requestTimeout', 'maxResponseBytes', 'clientSecretMaxBytes'}
        require(isinstance(delivery, dict) and required <= set(delivery) <= required | {'workspaceId', 'write', 'draftUploads'}, 'native actor delivery fields must match the existing consumer')
        def canonical_uuid(value):
            require(isinstance(value, str) and str(uuid.UUID(value)) == value and uuid.UUID(value).int != 0, 'native actor UUID is invalid')
        for key in ('bindingId', 'tenantId', 'nativeScopeRef', 'nativeRootRef', 'instanceServiceUuid'):
            canonical_uuid(delivery[key])
        if 'workspaceId' in delivery:
            canonical_uuid(delivery['workspaceId'])
        if 'draftUploads' in delivery:
            upload = delivery['draftUploads']
            require(isinstance(upload, dict) and set(upload) == {'timeout', 'sweepInterval', 'sweepBatchSize'}, 'native draft lifetime and cleanup fields must match the Version consumer')
            require(all(isinstance(upload[k], str) and upload[k].strip() == upload[k] != '' for k in ('timeout', 'sweepInterval')), 'native draft timeout and sweep interval must be explicitly delivered')
            require(type(upload['sweepBatchSize']) is int and upload['sweepBatchSize'] > 0, 'native draft cleanup batch must be explicitly bounded')
        if 'write' in delivery:
            write = delivery['write']
            require(isinstance(write, dict) and {'actionVersion', 'nativeType', 'resultExposurePolicyId', 'resultExposurePolicyVersion'} <= set(write) <= {'actionVersion', 'nativeType', 'resultExposurePolicyId', 'resultExposurePolicyVersion', 'nativeJobId'}, 'native write metadata must match the original ActionCommand consumer')
            if 'nativeJobId' in write:
                require(isinstance(write['nativeJobId'], str) and write['nativeJobId'].strip() == write['nativeJobId'] != '', 'native write job must be delivered')
            canonical_uuid(write['resultExposurePolicyId'])
            for key in ('actionVersion', 'resultExposurePolicyVersion'):
                require(type(write[key]) is int and write[key] > 0, 'native write versions must be delivered')
            require(isinstance(write['nativeType'], str) and write['nativeType'].strip() == write['nativeType'] != '', 'native write resource kind must be delivered')
        for key in ('nativeInstanceRef', 'clientId', 'requestTimeout'):
            require(isinstance(delivery[key], str) and delivery[key].strip() == delivery[key] != '', 'native actor delivery is incomplete')
        for key in ('maxResponseBytes', 'clientSecretMaxBytes'):
            require(type(delivery[key]) is int and delivery[key] > 0, 'native action bounds must be delivered')
        for key in ('corePepUrl', 'oidcTokenUrl'):
            endpoint = urlsplit(delivery[key])
            require(endpoint.scheme in ('http', 'https') and endpoint.hostname and not endpoint.username and not endpoint.password and not endpoint.query and not endpoint.fragment and (key != 'corePepUrl' or endpoint.path == '/service/v1/adapter/pep_check'), 'native action authority endpoint is invalid')
        secret = native_file(delivery['clientSecretFile']).read_bytes()
        require(0 < len(secret) <= delivery['clientSecretMaxBytes'] and secret.strip(), 'native action callback credential is unavailable')
        require(isinstance(delivery['actors'], list) and delivery['actors'], 'native current actors must be explicitly linked')
        principals, users = set(), set()
        for actor in delivery['actors']:
            require(isinstance(actor, dict) and set(actor) == {'principalId', 'kind', 'userUuid'}, 'native actor link fields are invalid')
            canonical_uuid(actor['principalId'])
            canonical_uuid(actor['userUuid'])
            require(actor['kind'] in ('HUMAN', 'AGENT') and actor['principalId'] not in principals and actor['userUuid'] not in users and actor['userUuid'] != delivery['instanceServiceUuid'], 'native actor links must be unique and cannot borrow SERVICE')
            principals.add(actor['principalId'])
            users.add(actor['userUuid'])
    data_subnet = ipaddress.ip_network(env['CELLS_DATA_SUBNET'])
    ui_subnet = ipaddress.ip_network(env['CELLS_UI_SUBNET'])
    require(data_subnet.version == ui_subnet.version == 4 and not data_subnet.overlaps(ui_subnet), 'independent, disjoint IPv4 data/UI subnets required')
    require(env['CELLS_NO_TLS'] in ('0', '1'), 'explicit native TLS choice required')
    require(int(env['CELLS_START_TIMEOUT_SECONDS']) > 0, 'positive deployment wait deadline required')
    origin = urlsplit(env['CELLS_EXTERNAL'])
    for ancestor in env.get('KAILO_FRAME_ANCESTORS', '').split():
        parent = urlsplit(ancestor)
        require(parent.scheme in ('http', 'https', 'tauri') and parent.hostname and not parent.netloc.endswith(':') and not parent.username and not parent.password and not parent.path and not parent.query and not parent.fragment and not any(c in ancestor for c in "*;'\"\\") and ancestor == parent.scheme + '://' + parent.netloc and (parent.port is None or 0 < parent.port <= 65535), 'frame ancestors must be explicit HTTP(S) or native host origins')
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
if [[ -n ${CELLS_NATIVE_ACTION_CONFIG_FILE:-} ]]; then
  compose+=(-f "$here/compose.native-actions.yaml")
fi
if "$platform_adapter"; then
  # Validate actual mounted paths/ownership, not a second binding schema. The
  # existing Node configuration parser and Core validation remain authoritative.
  python3 - <<'PY'
import json, os, pathlib, re, stat, sys
def require(condition):
    if not condition:
        raise ValueError('invalid delivery')
try:
    env = os.environ
    require(re.fullmatch(r'[^\s@]+@sha256:[a-f0-9]{64}', env['CELLS_ADAPTER_IMAGE']))
    uid, gid = int(env['CELLS_ADAPTER_UID']), int(env['CELLS_ADAPTER_GID'])
    require(uid > 0 and gid > 0)
    directory = pathlib.Path(env['CELLS_ADAPTER_DELIVERY_DIR'])
    require(directory.is_absolute() and directory.is_dir() and directory == directory.resolve())
    directory = directory.resolve()
    ds = directory.stat()
    require(ds.st_uid == uid and ds.st_gid == gid and stat.S_IMODE(ds.st_mode) == 0o700)
    native_dirs = [pathlib.Path(env[k]).resolve() for k in ('CELLS_DATA_DIR', 'CELLS_DB_DATA_DIR')]
    require(all(directory != p and directory not in p.parents and p not in directory.parents for p in native_dirs))
    def delivered(value, socket=False):
        path = pathlib.Path(value)
        require(path.is_absolute() and path == path.resolve() and directory in path.parents)
        entry = path.stat()
        require(entry.st_uid == uid and entry.st_gid == gid)
        require(stat.S_IMODE(entry.st_mode) in ((0o600,) if socket else (0o400, 0o600)))
        require(stat.S_ISSOCK(entry.st_mode) if socket else stat.S_ISREG(entry.st_mode))
        return path
    conf = json.loads(delivered(env['CELLS_ADAPTER_CONFIG_FILE']).read_text())
    if 'write' in conf:
        native = json.loads(pathlib.Path(env['CELLS_NATIVE_ACTION_CONFIG_FILE']).read_text())
        require(conf['write']['nativeJobId'] == native['write']['nativeJobId'])
        require(all(conf[key] == native[key] for key in ('bindingId', 'tenantId', 'nativeRootRef')))
        require(conf.get('workspaceId') == native.get('workspaceId'))
        require(conf['nativeWorkspaceId'] == native['nativeScopeRef'])
        require(conf['management']['validation']['nativeInstanceRef'] == native['nativeInstanceRef'])
        require(any(action['actionKey'] == 'file_storage.write@v1' and action['actionVersion'] == native['write']['actionVersion'] for action in conf['management']['validation']['actionVersions']))
    for key in ('cellsBearerFile', 'actionTokenJwksFile', 'oidcClientSecretFile'):
        delivered(conf[key])
    for item in conf['management']['validation']['secretDeliveries']:
        delivered(item['secretFile'])
        delivered(item['secretSocket'], socket=True)
except (KeyError, TypeError, ValueError, OSError):
    print('Cells adapter delivery refused; no services started', file=sys.stderr)
    sys.exit(2)
print('Cells adapter mount delivery validated; binding activation is not asserted')
PY
  compose+=(-f "$here/compose.adapter.yaml")
fi
"${compose[@]}" config --quiet
if "$check_only"; then exit 0; fi
container_resource_preflight
if "$platform_adapter"; then
  # Start only the optional consumer; never recreate Cells or its database.
  "${CONTAINER_DOCKER[@]}" image inspect "$CELLS_ADAPTER_IMAGE" >/dev/null
  "${compose[@]}" create --no-build --pull never cells-adapter
  mapfile -t containers < <("${compose[@]}" ps --all --quiet cells-adapter)
  [[ ${#containers[@]} == 1 ]] || { printf 'unexpected Cells adapter service set\n' >&2; exit 2; }
  container_verify_limits "${containers[0]}"
  "${compose[@]}" up --detach --no-build --no-deps --no-recreate --pull never cells-adapter
  printf 'Cells adapter started; release validation, binding activation and business acceptance remain separate\n'
  exit 0
fi
# All images are digest-pinned. No build, initializer outside this project, or shared DB.
"${compose[@]}" pull
"${compose[@]}" create --no-build --pull never
mapfile -t containers < <("${compose[@]}" ps --all --quiet cells cells-db)
[[ ${#containers[@]} == 2 ]] || { printf 'unexpected independent Cells service set\n' >&2; exit 2; }
for container in "${containers[@]}"; do container_verify_limits "$container"; done
"${compose[@]}" up --detach --no-build --no-recreate --pull never --wait --wait-timeout "${CELLS_START_TIMEOUT_SECONDS:?required}"
printf 'Independent Cells service started; Kailo SSO, bindings and tools are not asserted by this command\n'
