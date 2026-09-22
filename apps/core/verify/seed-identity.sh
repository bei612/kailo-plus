#!/usr/bin/env bash
# 为 SS-AGW-OIDC → BFF 这条链的正向核验登记一个身份。
#
# 这是核验用夹具，不是产品路径：真实的 Tenant/成员建立走 Stage 1 的
# TENANT_LIFECYCLE / MEMBERSHIP_PROJECTION Workflow。夹具只写 .design/03
# 已定义的字段，不引入任何新语义，也不绕过 BFF 的任何判定——
# BFF 仍然按 issuer/subject 查库，查不到照样拒绝。
set -euo pipefail
cd "$(dirname "$0")/../../deploy/local"
. ./.env

: "${1:?用法: seed-identity.sh <oidc-subject>}"
subject="$1"
issuer="${OIDC_ISSUER:?}"

PGPASSWORD="$(cat secrets/core_db_password)" psql \
  -h 127.0.0.1 -p "${CORE_DB_PORT}" -U "${CORE_DB_USER}" -d "${CORE_DB_NAME}" \
  -v ON_ERROR_STOP=1 -q <<SQL
begin;

insert into identity.identity_provider (id, issuer, client_id, claim_mapping_version, status)
values (gen_random_uuid(), '${issuer}', '${OIDC_BROWSER_CLIENT_ID}', 1, 'ACTIVE')
on conflict (issuer, client_id) do nothing;

insert into identity.human_identity (id, display_name, status)
values ('11111111-0000-0000-0000-000000000001', 'Seam Verifier', 'ACTIVE')
on conflict (id) do nothing;

insert into identity.external_identity (id, provider_id, issuer, subject, human_identity_id, status)
select '11111111-0000-0000-0000-000000000002', ip.id, '${issuer}', '${subject}',
       '11111111-0000-0000-0000-000000000001', 'ACTIVE'
from identity.identity_provider ip
where ip.issuer = '${issuer}' and ip.client_id = '${OIDC_BROWSER_CLIENT_ID}'
on conflict (issuer, subject) do nothing;

insert into identity.tenant (id, slug, name, state)
values ('11111111-0000-0000-0000-000000000003', 'verify', 'Verification Tenant', 'ACTIVE')
on conflict (id) do nothing;

insert into identity.principal (id, tenant_id, kind, status)
values ('11111111-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000003', 'HUMAN', 'ACTIVE')
on conflict (id) do nothing;

insert into identity.tenant_membership
  (id, tenant_id, human_identity_id, tenant_principal_id, state)
values ('11111111-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000003',
        '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000004', 'ACTIVE')
on conflict (tenant_id, human_identity_id) do nothing;

commit;
SQL
printf '已登记 subject=%s\n' "$subject"
