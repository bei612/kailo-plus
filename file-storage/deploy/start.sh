#!/usr/bin/env bash
# Independent native Cells service. Does not create Kailo resources or identities.
set -euo pipefail
# Exit 75: only the native readiness wait failed (e.g. the normal restart after
# the first-install configure run); re-running the same command is safe.
check_only=false
platform_adapter=false
reconcile_only=false
# Move a database installed without the upstream per-service SQL table
# template (cells admin config db prefixes): "plan" only reads, "apply" stops
# Cells, backs up the database and the configuration, then moves the tables.
migrate_tables=""
while [[ ${1:-} == --* ]]; do
  case "$1" in
    --check) check_only=true ;;
    --platform-adapter) platform_adapter=true ;;
    # Re-apply the declarative native configuration (reconcile.py) and verify
    # the datasource keys on the running project; nothing is pulled/created.
    --reconcile) reconcile_only=true ;;
    --migrate-tables-plan) migrate_tables=plan ;;
    --migrate-tables) migrate_tables=apply ;;
    *) printf 'unknown deployment option\n' >&2; exit 2 ;;
  esac
  shift
done
usage='usage: bash start.sh [--check] [--platform-adapter | --reconcile | --migrate-tables-plan | --migrate-tables] CONTROLLED_ENV_FILE [table move decisions]'
[[ $# -ge 1 && -f $1 ]] || { printf '%s\n' "$usage" >&2; exit 2; }
! { "$platform_adapter" && "$reconcile_only"; } || { printf -- '--platform-adapter and --reconcile are separate steps\n' >&2; exit 2; }
[[ -z $migrate_tables ]] || ! { "$platform_adapter" || "$reconcile_only" || "$check_only"; } || { printf -- 'the table move is a separate step\n' >&2; exit 2; }
# Operator decisions of the index split, passed to the native command as is;
# the binding root and the personal folders are assigned below.
table_decisions=("${@:2}")
[[ ${#table_decisions[@]} == 0 || -n $migrate_tables ]] || { printf '%s\n' "$usage" >&2; exit 2; }
for decision in "${table_decisions[@]}"; do
  [[ $decision == --index-drop-unbacked || $decision =~ ^--index-assign=[a-z0-9]{1,33}=[A-Za-z0-9][A-Za-z0-9._@\ -]*(,[A-Za-z0-9][A-Za-z0-9._@\ -]*)*$ ]] \
    || { printf 'unknown table move decision\n' >&2; exit 2; }
done
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
from urllib.parse import parse_qs, unquote, urlsplit

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
    # First-login provisioning (DD-127(9)) is an explicit deployment decision:
    # true creates standard native accounts, false keeps explicit links only.
    provision = oidc[0]['config'].get('provisionUsers')
    require(isinstance(provision, bool), 'native OIDC connector must declare provisionUsers as true or false')
    require(oidc[0]['config'].get('provisionProfile') == 'standard' if provision else 'provisionProfile' not in oidc[0]['config'],
            'provisionUsers true requires provisionProfile "standard"; false carries no provisionProfile')
    # 07 §4.7.4: the instance serves one Kailo Tenant (DEDICATED_INSTANCE);
    # provisioned accounts join its native group. Cells re-validates it.
    organization = oidc[0]['config'].get('organization')
    require(not provision or isinstance(organization, dict), 'provisionUsers true requires the bound Kailo Tenant (organization.tenant)')
    if organization is not None:
        tenant = organization.get('tenant')
        require(set(organization) == {'tenant'} and isinstance(tenant, dict) and set(tenant) == {'id', 'name'}
                and isinstance(tenant['id'], str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}', tenant['id'])
                and isinstance(tenant['name'], str) and tenant['name'].strip() == tenant['name'] != '' and tenant['name'].isprintable() and len(tenant['name']) <= 128,
                'organization.tenant needs the bound Tenant id and printable name')
    # 07 §4.7.5: OIDC back-channel logout receiver, explicit bounds.
    backchannel = oidc[0]['config'].get('backchannelLogout')
    require(isinstance(backchannel, dict) and set(backchannel) == {'sessionMaxAgeSeconds', 'logoutTokenMaxAgeSeconds'}
            and all(isinstance(backchannel[k], int) and not isinstance(backchannel[k], bool) and backchannel[k] > 0 for k in backchannel),
            'backchannelLogout needs positive sessionMaxAgeSeconds and logoutTokenMaxAgeSeconds')
    logout = oidc[0]['config'].get('platformLogoutUrl')
    if logout is not None:
        parsed = urlsplit(logout)
        require(parsed.scheme in ('http', 'https') and parsed.hostname and not parsed.username and not parsed.password, 'platformLogoutUrl must be an absolute HTTP(S) Kailo address')
    # DD-133(4), 07 §4.7.4: the member directory read is one complete delivery
    # or none; it needs the provisioning connector of the bound Tenant.
    directory_keys = ('CELLS_DIRECTORY_BINDING_ID', 'CELLS_DIRECTORY_CLIENT_ID', 'CELLS_DIRECTORY_CLIENT_SECRET_FILE',
                      'CELLS_DIRECTORY_TOKEN_URL', 'CELLS_DIRECTORY_CORE_URL')
    directory = [k for k in directory_keys if env.get(k, '').strip()]
    require(not directory or len(directory) == len(directory_keys), 'member directory: set every CELLS_DIRECTORY_* key or none')
    require(not env.get('CELLS_DIRECTORY_INTERVAL_SECONDS', '').strip() or directory, 'CELLS_DIRECTORY_INTERVAL_SECONDS without a member directory delivery')
    if directory:
        require(provision and organization is not None, 'member directory requires provisionUsers and organization.tenant')
        require(re.fullmatch(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', env['CELLS_DIRECTORY_BINDING_ID'])
                and re.fullmatch(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', organization['tenant']['id']),
                'member directory needs the binding UUID and the Kailo Tenant UUID as organization.tenant.id')
        require(re.fullmatch(r'[A-Za-z0-9_-]{1,255}', env['CELLS_DIRECTORY_CLIENT_ID']) and env['CELLS_DIRECTORY_CLIENT_ID'] != oidc[0]['config'].get('clientId'),
                'member directory client must be its own IdP client, not the browser client')
        directory_secret = secret_file('CELLS_DIRECTORY_CLIENT_SECRET_FILE').strip()
        require(directory_secret and directory_secret != secret_file('CELLS_OIDC_CLIENT_SECRET_FILE').strip(), 'independent nonempty directory client secret required')
        token, core = urlsplit(env['CELLS_DIRECTORY_TOKEN_URL']), urlsplit(env['CELLS_DIRECTORY_CORE_URL'])
        require(all(u.scheme in ('http', 'https') and u.hostname and not u.username and not u.password and not u.query and not u.fragment for u in (token, core))
                and core.path in ('', '/') and token.path.endswith('/protocol/openid-connect/token'),
                'member directory needs the IdP token endpoint and the Core service listener origin')
        interval = env.get('CELLS_DIRECTORY_INTERVAL_SECONDS', '').strip() or '60'
        require(re.fullmatch(r'[0-9]{2,4}', interval) and 10 <= int(interval) <= 3600, 'CELLS_DIRECTORY_INTERVAL_SECONDS must be 10..3600')
        require(env.get('CELLS_ADAPTER_PLATFORM_NETWORK', '').strip(), 'member directory reaches Core over CELLS_ADAPTER_PLATFORM_NETWORK')
        # 07 §4.7.4: Workspace roots are <CELLS_BINDING_DATASOURCE>/<CELLS_BINDING_ROOT_FOLDER>/<Workspace id>
        # (the same names reconcile.py accepts for the binding root).
        require(re.fullmatch(r'[a-z0-9]{1,33}', env.get('CELLS_BINDING_DATASOURCE', '')) and
                re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', env.get('CELLS_BINDING_ROOT_FOLDER', '')),
                'member directory roots Kailo Workspaces under CELLS_BINDING_DATASOURCE/CELLS_BINDING_ROOT_FOLDER')
    display = env['PLATFORM_DISPLAY_NAME']
    require(display.strip() == display != '' and len(display) <= 64 and display.isprintable(), 'PLATFORM_DISPLAY_NAME: printable Kailo display name required')
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
    # Upstream appends this template to every SQL DSN it builds
    # (discovery/install/lib/database.go dsnFromInstallConfig; a manual DSN is
    # used verbatim): without it every service gets the same unprefixed table
    # names and node/user metadata, policies and datasource indexes collide.
    template = parse_qs(dsn.query, keep_blank_values=True)
    require(all(template.get(key) == ['{{.Meta.%s}}' % key] for key in ('prefix', 'policies', 'singular')),
            'native DSN must carry the upstream per-service table template prefix={{.Meta.prefix}}&policies={{.Meta.policies}}&singular={{.Meta.singular}}')
    require(unquote(dsn.password or '') == secret_file('CELLS_DB_PASSWORD_FILE').rstrip('\n') != '', 'native database password delivery mismatch')
    # Datasource keys (embedded object service root credential): same rules as
    # data/source/objects ValidDeliveredCredential, applied by the entrypoint.
    ds_key = secret_file('CELLS_DATASOURCE_KEY_FILE').removesuffix('\n')
    ds_secret = secret_file('CELLS_DATASOURCE_SECRET_FILE').removesuffix('\n')
    require(re.fullmatch(r'[A-Za-z0-9]{16,64}', ds_key) and re.fullmatch(r'[!#-&(-~]{24,128}', ds_secret) and ds_key != ds_secret,
            'datasource access/secret key files must hold 16-64 alphanumerics and a 24-128 character secret')
    require(ds_secret not in (secret_file('CELLS_DB_PASSWORD_FILE').rstrip('\n'), secret_file('CELLS_OIDC_CLIENT_SECRET_FILE').strip(), oauth_secret, password),
            'datasource secret must be independent of every other native credential')
    require(len({os.path.realpath(env[k]) for k in ('CELLS_DATASOURCE_KEY_FILE', 'CELLS_DATASOURCE_SECRET_FILE')}) == 2, 'datasource key and secret need separate files')
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
        require(isinstance(delivery, dict) and required <= set(delivery) <= required | {'workspaceId', 'write', 'read', 'draftUploads', 'delete', 'share', 'cellShare'}, 'native actor delivery fields must match the existing consumer')
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
        if 'read' in delivery:
            read = delivery['read']
            require(isinstance(read, dict) and set(read) == {'nativeJobId', 'usageMeasurements'}, 'native read metadata must match the original Task consumer')
            require(isinstance(read['nativeJobId'], str) and read['nativeJobId'].strip() == read['nativeJobId'] != '', 'native read job must be delivered')
            require(isinstance(read['usageMeasurements'], list), 'native read meters must be explicitly delivered, including NONE')
            meters = set()
            for meter in read['usageMeasurements']:
                require(isinstance(meter, dict) and set(meter) == {'meterKey', 'quantitySource'} and isinstance(meter['meterKey'], str) and meter['meterKey'] != '' and meter['meterKey'] not in meters and meter['quantitySource'] in ('COUNT', 'CONTENT_BYTES'), 'native read meters must match the approved mapping')
                meters.add(meter['meterKey'])
        if 'delete' in delivery:
            deletion = delivery['delete']
            require(isinstance(deletion, dict) and set(deletion) == {'nativeJobId', 'bindingGeneration', 'actionVersion', 'nativeType', 'resultExposurePolicyId', 'resultExposurePolicyVersion', 'admissionPollInterval'}, 'native delete metadata must match its original Task/HUMAN consumers')
            require(isinstance(deletion['admissionPollInterval'], str) and deletion['admissionPollInterval'].strip() == deletion['admissionPollInterval'] != '', 'native delete admission polling must be explicitly delivered')
            for key in ('bindingGeneration', 'actionVersion', 'resultExposurePolicyVersion'):
                require(type(deletion[key]) is int and deletion[key] > 0, 'native delete versions must come from the approved binding')
            for key in ('nativeJobId', 'nativeType'):
                require(isinstance(deletion[key], str) and deletion[key].strip() == deletion[key] != '', 'native delete identifiers must be delivered')
            canonical_uuid(deletion['resultExposurePolicyId'])
            require(deletion['nativeJobId'] not in (delivery.get('read', {}).get('nativeJobId'), delivery.get('write', {}).get('nativeJobId')), 'native delete task owner must be distinct')
        if 'share' in delivery:
            # common/auth/native-action.go NativeShareDelivery: the original
            # file_storage.share@v2 link-revocation consumer (idm/share/rest/native-link.go).
            sharing = delivery['share']
            require(isinstance(sharing, dict) and set(sharing) == {'nativeJobId', 'actionVersion', 'nativeType', 'resultExposurePolicyId', 'resultExposurePolicyVersion'}, 'native share metadata must match its original Task/HUMAN consumers')
            for key in ('actionVersion', 'resultExposurePolicyVersion'):
                require(type(sharing[key]) is int and sharing[key] > 0, 'native share versions must come from the approved binding')
            for key in ('nativeJobId', 'nativeType'):
                require(isinstance(sharing[key], str) and sharing[key].strip() == sharing[key] != '', 'native share identifiers must be delivered')
            canonical_uuid(sharing['resultExposurePolicyId'])
            require(sharing['nativeJobId'] not in tuple(delivery.get(kind, {}).get('nativeJobId') for kind in ('read', 'write', 'delete', 'cellShare')), 'native share task owner must be distinct')
        if 'cellShare' in delivery:
            share = delivery['cellShare']
            require(isinstance(share, dict) and set(share) == {'nativeJobId', 'bindingGeneration', 'nativeType', 'grantActionVersion', 'revokeActionVersion'}, 'native Cell metadata must match its original Task/HUMAN consumers')
            for key in ('bindingGeneration', 'grantActionVersion', 'revokeActionVersion'):
                require(type(share[key]) is int and share[key] > 0, 'native Cell versions must come from the approved binding and original platform actions')
            for key in ('nativeJobId', 'nativeType'):
                require(isinstance(share[key], str) and share[key].strip() == share[key] != '', 'native Cell identifiers must be delivered')
            require(share['nativeJobId'] not in tuple(delivery.get(kind, {}).get('nativeJobId') for kind in ('read', 'write', 'delete', 'share')), 'native Cell task owner must be distinct')
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
# Declarative native configuration settings (applied after start by reconcile.py).
python3 -I "$here/reconcile.py" --check
source "$root/tools/container-safety.sh"
container_safety_init
compose=("${CONTAINER_DOCKER[@]}" compose --project-name "$CELLS_COMPOSE_PROJECT" --env-file "$config" -f "$here/compose.yaml")
if [[ -n ${CELLS_NATIVE_ACTION_CONFIG_FILE:-} ]]; then
  compose+=(-f "$here/compose.native-actions.yaml")
fi
# DD-133(4): periodic Kailo member directory read (validated above).
if [[ -n ${CELLS_DIRECTORY_BINDING_ID:-} ]]; then
  compose+=(-f "$here/compose.member-directory.yaml")
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
    # This instance mounts REST v2 at /v2 and the original REST API at /a
    # (common/naming.go; the readiness probe above uses /a/frontend/bootconf).
    from urllib.parse import urlsplit
    rest_v2, rest_v1 = urlsplit(conf['cellsRestBaseUrl']), urlsplit(conf['cellsRestV1BaseUrl'])
    require(rest_v2.scheme in ('http', 'https') and rest_v2.netloc and (rest_v1.scheme, rest_v1.netloc) == (rest_v2.scheme, rest_v2.netloc))
    require(rest_v2.path.rstrip('/') == '/v2' and rest_v1.path.rstrip('/') == '/a')
    require(not any((u.query, u.fragment, u.username, u.password) for u in (rest_v2, rest_v1)))
    if 'cellShare' in conf:
        native = json.loads(pathlib.Path(env['CELLS_NATIVE_ACTION_CONFIG_FILE']).read_text())
        require(conf['cellShare'] == {key: native['cellShare'][key] for key in ('nativeJobId', 'bindingGeneration')})
        require(all(conf[key] == native[key] for key in ('bindingId', 'tenantId', 'nativeRootRef')))
        require(conf.get('workspaceId') == native.get('workspaceId'))
        require(conf['nativeWorkspaceId'] == native['nativeScopeRef'])
        require(conf['management']['validation']['nativeInstanceRef'] == native['nativeInstanceRef'])
    if 'readExecution' in conf:
        native = json.loads(pathlib.Path(env['CELLS_NATIVE_ACTION_CONFIG_FILE']).read_text())
        require(conf['readExecution'] == native['read'])
        require(all(conf[key] == native[key] for key in ('bindingId', 'tenantId', 'nativeRootRef')))
        require(conf.get('workspaceId') == native.get('workspaceId'))
        require(conf['nativeWorkspaceId'] == native['nativeScopeRef'])
        require(conf['management']['validation']['nativeInstanceRef'] == native['nativeInstanceRef'])
    if 'write' in conf:
        native = json.loads(pathlib.Path(env['CELLS_NATIVE_ACTION_CONFIG_FILE']).read_text())
        require(conf['write']['nativeJobId'] == native['write']['nativeJobId'])
        require(all(conf[key] == native[key] for key in ('bindingId', 'tenantId', 'nativeRootRef')))
        require(conf.get('workspaceId') == native.get('workspaceId'))
        require(conf['nativeWorkspaceId'] == native['nativeScopeRef'])
        require(conf['management']['validation']['nativeInstanceRef'] == native['nativeInstanceRef'])
        require(any(action['actionKey'] == 'file_storage.write@v2' and action['actionVersion'] == native['write']['actionVersion'] for action in conf['management']['validation']['actionVersions']))
    if 'delete' in conf:
        native = json.loads(pathlib.Path(env['CELLS_NATIVE_ACTION_CONFIG_FILE']).read_text())
        require(conf['delete']['nativeJobId'] == native['delete']['nativeJobId'])
        require(all(conf[key] == native[key] for key in ('bindingId', 'tenantId', 'nativeRootRef')))
        require(conf.get('workspaceId') == native.get('workspaceId'))
        require(conf['nativeWorkspaceId'] == native['nativeScopeRef'])
        require(conf['management']['validation']['nativeInstanceRef'] == native['nativeInstanceRef'])
        require(any(action['actionKey'] == 'file_storage.delete@v2' and action['actionVersion'] == native['delete']['actionVersion'] for action in conf['management']['validation']['actionVersions']))
    if 'share' in conf:
        native = json.loads(pathlib.Path(env['CELLS_NATIVE_ACTION_CONFIG_FILE']).read_text())
        require(conf['share']['nativeJobId'] == native['share']['nativeJobId'])
        require(all(conf[key] == native[key] for key in ('bindingId', 'tenantId', 'nativeRootRef')))
        require(conf.get('workspaceId') == native.get('workspaceId'))
        require(conf['nativeWorkspaceId'] == native['nativeScopeRef'])
        require(conf['management']['validation']['nativeInstanceRef'] == native['nativeInstanceRef'])
        require(any(action['actionKey'] == 'file_storage.share@v2' and action['actionVersion'] == native['share']['actionVersion'] for action in conf['management']['validation']['actionVersions']))
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

# Per-service SQL tables (cells admin config db prefixes, run in a one-off
# container of this project: same configuration, database and data mounts,
# no published port). Exit 0: in effect or nothing installed yet; 3: a move is
# pending; 2: refused; 4: only datasource indexes lack the table and root
# their service creates on its first run only (additive). The binding root
# and the personal folders (my-files template personal/<login>) are assigned
# to their datasources; any other top-level index entry needs an explicit
# decision.
table_prefixes=("${compose[@]}" run --rm -T cells cells admin config db prefixes
  --index-assign-user-folders=personal "--index-assign=$CELLS_BINDING_DATASOURCE=$CELLS_BINDING_ROOT_FOLDER" "${table_decisions[@]}")
if [[ $migrate_tables == plan ]]; then
  exec "${table_prefixes[@]}"
fi
if [[ $migrate_tables == apply ]]; then
  # Owner-only directory outside the native state, delivered by the operator.
  backup=$(realpath -e -- "${CELLS_MIGRATION_BACKUP_DIR:?CELLS_MIGRATION_BACKUP_DIR required for the table move}")
  [[ -d $backup && $(stat -c '%a' -- "$backup") == 700 && $(stat -c '%u' -- "$backup") == $(id -u) ]] \
    || { printf 'CELLS_MIGRATION_BACKUP_DIR must be an existing owner-only (0700) directory of this user\n' >&2; exit 2; }
  for state in "$CELLS_DATA_DIR" "$CELLS_DB_DATA_DIR"; do
    state=$(realpath -e -- "$state")
    [[ $backup != "$state" && $backup != "$state"/* && $state != "$backup"/* ]] \
      || { printf 'CELLS_MIGRATION_BACKUP_DIR must be outside the native state\n' >&2; exit 2; }
  done
  # No writer while the tables move: stop Cells, keep (or start) its database.
  "${compose[@]}" stop cells
  "${compose[@]}" up --detach --no-build --no-recreate --pull never --wait --wait-timeout "${CELLS_START_TIMEOUT_SECONDS:?required}" cells-db
  code=0
  "${table_prefixes[@]}" || code=$?
  case $code in
    0) printf 'Per-service tables already in effect; nothing moved. Start Cells with: bash start.sh CONTROLLED_ENV_FILE\n'; exit 0 ;;
    3|4) ;;
    *) printf 'Table move refused or failed (exit %s); nothing was changed and Cells stays stopped\n' "$code" >&2; exit 2 ;;
  esac
  mapfile -t databases < <("${compose[@]}" ps --quiet cells-db)
  [[ ${#databases[@]} == 1 && -n ${databases[0]} ]] || { printf 'no running Cells database in this project\n' >&2; exit 2; }
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  umask 077
  # Custom-format dump of the whole database (restore: pg_restore --clean
  # --if-exists into the same database with Cells stopped), checked readable;
  # the configuration whose stored DSN the move changes.
  "${CONTAINER_DOCKER[@]}" exec "${databases[0]}" sh -c 'exec pg_dump -Fc -p "$1" -U "$POSTGRES_USER" -d "$POSTGRES_DB"' sh "$CELLS_DB_PORT" \
    > "$backup/cells-db-$stamp.dump"
  "${CONTAINER_DOCKER[@]}" exec -i "${databases[0]}" pg_restore --list < "$backup/cells-db-$stamp.dump" > /dev/null
  "${compose[@]}" run --rm --no-deps -T --entrypoint cat cells /var/cells/pydio.json > "$backup/pydio-$stamp.json"
  [[ -s $backup/cells-db-$stamp.dump && -s $backup/pydio-$stamp.json ]] || { printf 'backup is empty; nothing moved\n' >&2; exit 2; }
  printf 'Backup written: %s/cells-db-%s.dump and %s/pydio-%s.json\n' "$backup" "$stamp" "$backup" "$stamp"
  "${table_prefixes[@]}" --apply
  printf 'Per-service tables in effect; Cells is stopped. Start it with: bash start.sh CONTROLLED_ENV_FILE\n'
  exit 0
fi

# After the native service is healthy: the delivered datasource keys must be the
# ones the object services accept (a pending previous credential refused), then
# the declarative configuration of the governed actions is applied and read
# back (reconcile.py). Both are idempotent; a refusal fails the deployment.
native_configuration() {
  local cells
  mapfile -t cells < <("${compose[@]}" ps --quiet cells)
  [[ ${#cells[@]} == 1 && -n ${cells[0]} ]] || { printf 'no running Cells service in this project\n' >&2; exit 2; }
  "${CONTAINER_DOCKER[@]}" exec "${cells[0]}" cells admin datasource keys --verify \
    --access-key-file /run/secrets/cells_datasource_key --secret-key-file /run/secrets/cells_datasource_secret
  python3 -I "$here/reconcile.py" --container "${cells[0]}" -- "${CONTAINER_DOCKER[@]}"
}
if "$reconcile_only"; then
  native_configuration
  printf 'Cells declarative configuration reconciled; bindings and tools are not asserted by this command\n'
  exit 0
fi
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
# A database installed without the per-service table template (node and user
# metadata, policies and every datasource index in shared tables) is moved
# first, before any container of this project is replaced; a new install
# receives the template from its validated install DSN.
code=0
"${table_prefixes[@]}" >&2 || code=$?
case $code in
  0) ;;
  4)
    # Datasource indexes without their table and root (e.g. left by the move of
    # an earlier release): created with the index DAO's own migration, in one
    # transaction, while Cells is stopped; it is started again below.
    "${compose[@]}" stop cells
    "${table_prefixes[@]}" --apply >&2 \
      || { printf 'Datasource index tables not created (the transaction changed nothing); Cells is stopped, re-run start.sh\n' >&2; exit 2; }
    ;;
  *)
    printf 'Cells SQL tables are not the per-service tables: run start.sh --migrate-tables-plan, then --migrate-tables (verify/deployment.md); nothing replaced or started\n' >&2
    exit 2
    ;;
esac
"${compose[@]}" create --no-build --pull never
mapfile -t containers < <("${compose[@]}" ps --all --quiet cells cells-db)
[[ ${#containers[@]} == 2 ]] || { printf 'unexpected independent Cells service set\n' >&2; exit 2; }
for container in "${containers[@]}"; do container_verify_limits "$container"; done
if ! "${compose[@]}" up --detach --no-build --no-recreate --pull never --wait --wait-timeout "${CELLS_START_TIMEOUT_SECONDS:?required}"; then
  # A first install exits after the native configure run and is restarted by
  # its restart policy; the wait cannot tell that from a failure.
  printf 'Cells readiness wait failed; containers are left for native inspection (re-run is safe)\n' >&2
  exit 75
fi
native_configuration
printf 'Independent Cells service started and configured; Kailo SSO, bindings and tools are not asserted by this command\n'
