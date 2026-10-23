#!/usr/bin/env bash
# Kailo DD-133: adopt existing native spaces into the Kailo organisation
# mapping. Repeatable; "plan" runs the whole change in a transaction and rolls
# it back, "apply" takes a database backup first and commits.
#
#   kailo-org-adopt.sh plan|apply \
#       --kailo-tenant-id <Kailo tenant id> --kailo-tenant-name <display name> \
#       --adopt-space <native space id> \
#       [--retire-space <id>]... [--attach-space <id>]... \
#       [--backup-dir <private dir>]            (required for apply)
#
# Runs the reviewed SQL (kailo-org-adopt.sql) inside the running native
# Postgres container (KNOWLEDGE_POSTGRES_CONTAINER, default
# kailo-knowledge-postgres-1) with its own credentials. Deploy the knowledge
# service of this release first (migration 000109).
set -euo pipefail
umask 077

die() { echo "kailo-org-adopt: $*" >&2; exit 78; }

here=$(cd "$(dirname "$0")" && pwd)
mode=${1:-}
case "$mode" in plan|apply) shift ;; *) die "usage: $0 plan|apply --kailo-tenant-id ID --kailo-tenant-name NAME --adopt-space N [--retire-space N]... [--attach-space N]... [--backup-dir DIR]" ;; esac

tenant_id= tenant_name= adopt= backup_dir=
retire=() attach=()
while [ $# -gt 0 ]; do
    [ $# -ge 2 ] || die "missing value for $1"
    case "$1" in
        --kailo-tenant-id) tenant_id=$2 ;;
        --kailo-tenant-name) tenant_name=$2 ;;
        --adopt-space) adopt=$2 ;;
        --retire-space) retire+=("$2") ;;
        --attach-space) attach+=("$2") ;;
        --backup-dir) backup_dir=$2 ;;
        *) die "unknown option $1" ;;
    esac
    shift 2
done

[[ $tenant_id =~ ^[A-Za-z0-9._:-]{1,140}$ ]] || die "--kailo-tenant-id is required (letters, digits, . _ : -)"
[[ -n $tenant_name && ! $tenant_name =~ [[:cntrl:]] ]] || die "--kailo-tenant-name is required (no control characters)"
[[ $adopt =~ ^[1-9][0-9]{0,18}$ ]] || die "--adopt-space must be a native space id"
for space in "${retire[@]}" "${attach[@]}"; do
    [[ $space =~ ^[1-9][0-9]{0,18}$ ]] || die "space ids must be positive integers"
done
retire_list=$(IFS=,; echo "${retire[*]}")
attach_list=$(IFS=,; echo "${attach[*]}")
container=${KNOWLEDGE_POSTGRES_CONTAINER:-kailo-knowledge-postgres-1}
docker=${DOCKER:-docker}

if [ "$mode" = apply ]; then
    [ -n "$backup_dir" ] || die "apply requires --backup-dir"
    mkdir -p -- "$backup_dir"
    [ -d "$backup_dir" ] && [ ! -L "$backup_dir" ] || die "backup dir must be a real directory"
    backup="$backup_dir/knowledge-before-kailo-org-adopt-$(date -u +%Y%m%dT%H%M%SZ).dump"
    "$docker" exec "$container" sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$backup"
    [ -s "$backup" ] || die "database backup is empty"
    echo "kailo-org-adopt: backup $backup ($(sha256sum "$backup" | cut -d' ' -f1))"
    apply=true
else
    apply=false
fi

"$docker" exec -i \
    -e KAILO_TENANT_ID="$tenant_id" -e KAILO_TENANT_NAME="$tenant_name" \
    -e KAILO_ADOPT="$adopt" -e KAILO_RETIRE="$retire_list" -e KAILO_ATTACH="$attach_list" \
    -e KAILO_APPLY="$apply" \
    "$container" sh -c 'exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
        -v kailo_tenant_id="$KAILO_TENANT_ID" -v kailo_tenant_name="$KAILO_TENANT_NAME" \
        -v adopt_space="$KAILO_ADOPT" -v retire_spaces="$KAILO_RETIRE" -v attach_spaces="$KAILO_ATTACH" \
        -v apply="$KAILO_APPLY"' < "$here/kailo-org-adopt.sql"
