#!/usr/bin/env bash
# Independent ONLYOFFICE DocumentServer of the file-storage component (DD-132).
# Validates the owner-only delivery, starts the recorded image by digest and
# reads back the DD-132(3) invariants. Creates no Kailo resource or identity.
#
#   bash start.sh [--check] [--force-recreate] CONTROLLED_ENV_FILE
#     --check           validate the delivery and the Compose model only
#     --force-recreate  recreate the container (the rendered local.json changed;
#                       a single-file bind mount is read at container start)
# The rendered local.json must already equal the release-tree template plus the
# deployment facts (deploy/components/native-config.py apply document-editor,
# run by component-deploy.sh document-editor).
set -euo pipefail
check_only=false
recreate=()
while [[ ${1:-} == --* ]]; do
  case "$1" in
    --check) check_only=true ;;
    --force-recreate) recreate=(--force-recreate) ;;
    *) printf 'unknown deployment option\n' >&2; exit 2 ;;
  esac
  shift
done
[[ $# -eq 1 && -f $1 ]] || { printf 'usage: bash start.sh [--check] [--force-recreate] CONTROLLED_ENV_FILE\n' >&2; exit 2; }
config=$(realpath -e -- "$1")
[[ $(stat -c '%a' -- "$config") == 600 ]] || { printf 'deployment env must be mode 0600\n' >&2; exit 2; }
here=$(cd -- "$(dirname -- "$0")" && pwd)
root=$(cd -- "$here/../.." && pwd)
set -a
# Same trusted, operator-delivered shell environment convention as the Cells unit.
source "$config"
set +a
python3 -I - <<'PY'
import ipaddress, json, os, pathlib, re, stat, sys
from urllib.parse import urlsplit

def require(condition, reason):
    if not condition:
        raise ValueError(reason)

def origin(value):
    parts = urlsplit(value)
    require(parts.scheme in ('http', 'https') and parts.hostname and not parts.username and not parts.password
            and value == f'{parts.scheme}://{parts.netloc}' and not any(c in value for c in "*;'\"\\ "), 'explicit origin required')
    return parts

# The image runs DocService as ds (uid 101, gid 102) of the official layer.
DS_UID, DS_GID = 101, 102
SECRET = re.compile(r'[A-Za-z0-9._~+/=-]{32,256}')
try:
    env = os.environ
    require(re.fullmatch(r'kailo-document-editor(-[a-z0-9][a-z0-9_-]*)?', env['DOCUMENT_EDITOR_COMPOSE_PROJECT']), 'independent kailo-document-editor project required')
    require(re.fullmatch(r'[^\s@]+/document-editor@sha256:[a-f0-9]{64}', env['DOCUMENT_EDITOR_IMAGE']), 'recorded document-editor image digest required')
    public = origin(env['DOCUMENT_EDITOR_PUBLIC_ORIGIN'])
    cells = env['DOCUMENT_EDITOR_WOPI_SOURCE_ORIGIN']
    origin(cells)
    ancestors = env['DOCUMENT_EDITOR_FRAME_ANCESTORS'].split()
    require(ancestors and len(set(ancestors)) == len(ancestors) and cells in ancestors and env['DOCUMENT_EDITOR_PUBLIC_ORIGIN'] not in ancestors,
            'frame ancestors must list the Cells origin and its hosts exactly once (the editor itself is added as self)')
    for value in ancestors:
        parts = urlsplit(value)
        if parts.scheme == 'tauri':
            require(value == f'tauri://{parts.netloc}' and re.fullmatch(r'[a-z0-9.-]+', parts.netloc or ''), 'native host origin must be tauri://host')
        else:
            origin(value)
    offer = urlsplit(env['DOCUMENT_EDITOR_SOURCE_OFFER_URL'])
    require(offer.scheme in ('http', 'https') and offer.hostname and not offer.username and not offer.password and not offer.fragment
            and not any(c in env['DOCUMENT_EDITOR_SOURCE_OFFER_URL'] for c in " \"'<>`\\") and '<to-fill' not in env['DOCUMENT_EDITOR_SOURCE_OFFER_URL'],
            'DOCUMENT_EDITOR_SOURCE_OFFER_URL: absolute http(s) Corresponding Source offer required (AGPLv3 §13)')
    secrets = []
    for key in ('DOCUMENT_EDITOR_TOKEN_SECRET_FILE', 'DOCUMENT_EDITOR_SECURE_LINK_SECRET_FILE'):
        path = pathlib.Path(env[key])
        require(path.is_absolute() and path.is_file() and not path.is_symlink(), key + ': existing absolute file required')
        require(stat.S_IMODE(path.stat().st_mode) == 0o600 and path.stat().st_uid == os.geteuid(), key + ': owner-only (0600) file of this user required')
        value = path.read_text(encoding='utf-8').strip()
        require(SECRET.fullmatch(value), key + ': 32-256 URL-safe characters required')
        secrets.append(value)
    require(secrets[0] != secrets[1], 'token and cache signing secrets must be independent')
    data = pathlib.Path(env['DOCUMENT_EDITOR_DATA_DIR'])
    require(data.is_absolute() and data.is_dir() and data.resolve() == data and str(data).startswith('/volumes/data/'), 'dedicated Data state directory required')
    info = data.stat()
    require(info.st_uid == DS_UID and info.st_gid == DS_GID and not info.st_mode & 0o007, 'state directory must belong to 101:102 (image ds) and not be world-accessible')
    local = pathlib.Path(env['DOCUMENT_EDITOR_LOCAL_CONFIG_FILE'])
    require(local.is_absolute() and local.is_file() and not local.is_symlink() and not local.stat().st_mode & 0o022, 'rendered local.json required (not writable by others)')
    rendered = json.loads(local.read_text(encoding='utf-8'))
    require(rendered['wopi']['host'] == env['DOCUMENT_EDITOR_PUBLIC_ORIGIN']
            and rendered['externalRequest']['directIfIn']['allowList'] == [cells + '/wopi/files/'], 'rendered local.json does not match the deployment facts; re-render it')
    for key in ('DOCUMENT_EDITOR_TOKEN_SECRET_FILE', 'DOCUMENT_EDITOR_SECURE_LINK_SECRET_FILE', 'DOCUMENT_EDITOR_LOCAL_CONFIG_FILE'):
        require(data not in pathlib.Path(env[key]).parents, key + ' must be outside the state directory')
    ipaddress.ip_network(env['DOCUMENT_EDITOR_SUBNET'])
    ipaddress.ip_address(env['DOCUMENT_EDITOR_PUBLIC_ADDRESS'])
    require(0 < int(env['DOCUMENT_EDITOR_PUBLIC_PORT']) <= 65535 and public.port == int(env['DOCUMENT_EDITOR_PUBLIC_PORT']), 'public port must be the port of the public origin')
    require(int(env['DOCUMENT_EDITOR_START_TIMEOUT_SECONDS']) > 0, 'positive deployment wait deadline required')
except (KeyError, ValueError, TypeError, AttributeError, OSError):
    print('document-editor configuration refused: missing, unsafe or inconsistent delivery; no service started', file=sys.stderr)
    sys.exit(2)
print('document-editor delivery validated; no credential values emitted')
PY
source "$root/tools/container-safety.sh"
container_safety_init
compose=("${CONTAINER_DOCKER[@]}" compose --project-name "$DOCUMENT_EDITOR_COMPOSE_PROJECT" --env-file "$config" -f "$here/compose.yaml")
"${compose[@]}" config --quiet
if "$check_only"; then exit 0; fi
"${compose[@]}" up --detach --no-build --pull never "${recreate[@]}" --wait --wait-timeout "$DOCUMENT_EDITOR_START_TIMEOUT_SECONDS" document-server

# Read back what a browser and Cells see (DD-132(3)); values only, no secret.
python3 -I - <<'PY'
import json, os, re, sys, urllib.error, urllib.request

env = os.environ
base = env['DOCUMENT_EDITOR_PUBLIC_ORIGIN']
want = "frame-ancestors 'self' " + ' '.join(env['DOCUMENT_EDITOR_FRAME_ANCESTORS'].split())

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

opener = urllib.request.build_opener(NoRedirect)

def get(path):
    try:
        with opener.open(base + path, timeout=15) as response:
            return response.status, response.headers, response.read(4 << 20).decode('utf-8', 'replace')
    except urllib.error.HTTPError as error:
        return error.code, error.headers, ''

failures = []
status, headers, body = get('/healthcheck')
if status != 200 or body.strip() != 'true':
    failures.append('healthcheck')
status, headers, body = get('/hosting/discovery')
sources = re.findall(r'urlsrc="([^"]+)"', body)
if status != 200 or not sources or any(not s.startswith(base + '/hosting/') for s in sources):
    failures.append('discovery must list only actions of ' + base)
for path in ('/hosting/discovery', '/web-apps/apps/api/documents/api.js'):
    if get(path)[1].get('Content-Security-Policy') != want:
        failures.append('frame-ancestors of ' + path)
for path in ('/ai-proxy/', '/sdkjs-plugins/', '/'):
    if get(path)[0] != 404:
        failures.append(path + ' must be absent')
status, _, body = get('/kailo-legal/')
if status != 200 or env['DOCUMENT_EDITOR_SOURCE_OFFER_URL'] not in body or 'Additional Terms' not in get('/kailo-legal/LICENSE.txt')[2]:
    failures.append('legal notices with the source offer and license texts')
status, _, body = get('/plugins.json')
if status != 200 or json.loads(body or '{}').get('pluginsData') != []:
    failures.append('plugin list must be empty')
if failures:
    print('document-editor read-back failed: ' + '; '.join(failures), file=sys.stderr)
    sys.exit(1)
print(f'document-editor read back: healthy, {len(sources)} discovery actions on {base}, exact frame-ancestors, no plugin/AI/welcome routes')
PY
