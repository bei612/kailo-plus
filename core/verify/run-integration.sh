#!/usr/bin/env bash
# 跑全部集成核验：Buzz roster、SecretRef、SpiceDB 关系、成员生命周期整条链。
# 这些用例默认跳过；环境与开关见 integration-env.sh。
set -euo pipefail
cd "$(dirname "$0")/../.."
. core/verify/integration-env.sh

# 本机集成套件会开通真实 Tenant namespace；只有本次运行登记的 UUID 能
# 进入离线清理。互斥避免两次全套核验在对方仍用 Core 时停服。
exec 9< core/verify/run-integration.sh
flock -n 9 || { echo "另一轮全套集成核验仍在运行" >&2; exit 2; }
: "${BUILDX_BUILDER:?全套核验须指定受 cgroup 限制的 BuildKit，供结束时安全重启 Core}"
fixture_tenant_absent() {
  local tenant=$1 counts
  counts="$(PGPASSWORD="$(cat "$local_dir/secrets/core_db_password")" \
    psql -h 127.0.0.1 -p "$CORE_DB_PORT" -U "$CORE_DB_USER" -d "$CORE_DB_NAME" \
      -v ON_ERROR_STOP=1 -tA -c \
      "select (select count(*) from identity.tenant where id = '$tenant'),
              (select count(*) from identity.principal where tenant_id = '$tenant'),
              (select count(*) from identity.buzz_identity_binding where tenant_id = '$tenant'),
              (select count(*) from admission.secret_ref_rehome where tenant_id = '$tenant')" \
      | tr -d '[:space:]')" || return 1
  [ "$counts" = '0|0|0|0' ]
}

bao_tenant_parent() {
  local root_token
  root_token="$(jq -er '.root_token | select(type == "string" and length > 0)' \
    "$local_dir/secrets/openbao_init.json")" || return 1
  printf '%s\n' "$root_token" | sudo -n docker compose --env-file "$local_dir/.env" \
    -f "$local_dir/compose.yaml" exec -T \
    -e BAO_NAMESPACE="$OPENBAO_TENANT_PARENT_NAMESPACE" openbao \
    sh -c 'IFS= read -r BAO_TOKEN; export BAO_TOKEN; exec bao "$@"' bao "$@"
}

namespace_list() {
  local listing
  listing="$(bao_tenant_parent namespace list -format=json 2>&1)" || {
    [ "$listing" = '{}' ] || return 1
  }
  printf '%s\n' "$listing" | jq -e \
    'type == "array" or (type == "object" and length == 0)' >/dev/null || return 1
  printf '%s\n' "$listing"
}

namespace_path_matches() {
  local tenant=$1 lookup
  lookup="$(bao_tenant_parent namespace lookup -format=json "$tenant")" || return 1
  printf '%s\n' "$lookup" | jq -e \
    --arg path "${OPENBAO_TENANT_PARENT_NAMESPACE%/}/$tenant/" \
    '.path == $path' >/dev/null
}

cleanup_fixture_namespaces() {
  local marker tenant listing deadline retained=0
  local -a markers=() targets=() cleared=()
  shopt -s nullglob
  markers=("$namespace_ledger"/*)
  [ "${#markers[@]}" -gt 0 ] || return 0
  listing="$(namespace_list)" || return 1
  for marker in "${markers[@]}"; do
    [ -f "$marker" ] && [ ! -L "$marker" ] || return 1
    tenant="${marker##*/}"
    [[ "$tenant" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || return 1
    if printf '%s\n' "$namespace_before" | jq -e --arg tenant "$tenant" \
      'index($tenant) != null' >/dev/null; then
      echo "测试 Tenant $tenant 在运行前已存在，拒绝删除 namespace" >&2
      return 1
    fi
    # 失败用例按约定保留夹具供排查；只保留它自己的 namespace 与登记，
    # 不连带阻断本轮其他已拆除夹具的清理。
    fixture_tenant_absent "$tenant" || {
      echo "测试 Tenant $tenant 仍有 Core 引用，保留其 namespace 与登记" >&2
      retained=1
      continue
    }
    cleared+=("$marker")
    if printf '%s\n' "$listing" | jq -e --arg tenant "$tenant" \
      'type == "array" and any(.[]; rtrimstr("/") == $tenant)' >/dev/null; then
      namespace_path_matches "$tenant" || return 1
      targets+=("$tenant")
    fi
  done
  if [ "${#targets[@]}" -eq 0 ]; then
    for marker in "${cleared[@]}"; do rm -- "$marker" || return 1; done
    return "$retained"
  fi

  core_stopped_for_cleanup=1
  sudo -n docker compose -f "$local_dir/compose.yaml" stop core-bff >/dev/null || return 1
  [ -z "$(sudo -n docker compose -f "$local_dir/compose.yaml" ps --status running -q core-bff)" ] || return 1
  for tenant in "${targets[@]}"; do
    fixture_tenant_absent "$tenant" || return 1
    namespace_path_matches "$tenant" || return 1
    bao_tenant_parent namespace delete "$tenant" >/dev/null || return 1
    deadline=$((SECONDS + VERIFY_CONVERGE_BOUND_SECS))
    while [ "$SECONDS" -lt "$deadline" ]; do
      listing="$(namespace_list)" || return 1
      if ! printf '%s\n' "$listing" | jq -e --arg tenant "$tenant" \
        'type == "array" and any(.[]; rtrimstr("/") == $tenant)' >/dev/null; then
        break
      fi
      sleep 1
    done
    [ "$SECONDS" -lt "$deadline" ] || return 1
  done
  for marker in "${cleared[@]}"; do rm -- "$marker" || return 1; done
  echo "本轮 ${#targets[@]} 个测试 Tenant OpenBao namespace 已离线收敛"
  return "$retained"
}

finish() {
  local status=$? namespace_after
  trap - EXIT
  core_stopped_for_cleanup=0
  cleanup_fixture_namespaces || status=1
  if [ "$core_stopped_for_cleanup" -eq 1 ]; then
    bash "$local_dir/start-core.sh" >/dev/null || status=1
    deadline=$((SECONDS + VERIFY_CONVERGE_BOUND_SECS))
    until curl -fsS -o /dev/null "$VERIFY_BFF_URL/healthz"; do
      [ "$SECONDS" -lt "$deadline" ] || { status=1; break; }
      sleep 1
    done
  fi
  namespace_after="$(namespace_list | jq -ce 'if type == "array" then map(rtrimstr("/")) | sort else [] end')" || status=1
  if [ "$namespace_after" != "$namespace_before" ]; then
    echo "OpenBao Tenant namespace 集合在全套核验后未恢复：本轮存在未登记的残留或外部变更" >&2
    echo "核验前：$namespace_before" >&2
    echo "核验后：$namespace_after" >&2
    status=1
  fi
  if [ "$status" -eq 0 ]; then
    rmdir "$namespace_ledger" || status=1
  else
    echo "核验或清理未完成；本次 namespace 清单保留于 $namespace_ledger" >&2
  fi
  exit "$status"
}
namespace_before="$(namespace_list | jq -ce 'if type == "array" then map(rtrimstr("/")) | sort else [] end')"
namespace_ledger="$(mktemp -d)"
export PLATFORM_INTEGRATION_NAMESPACE_LEDGER="$namespace_ledger"
trap finish EXIT

# 先编译：夹具投递的 wrapping token 只在 OPENBAO_SECRET_ID_WRAP_TTL 内有效，
# 不能把编译时间算进去。
(cd core && cargo test --workspace --no-run -q)
# 夹具回传本次写入的两个版本号；不假设它们是 1 和 2（KV v2 会裁旧版本）
eval "$(./core/verify/seed-secret-ref.sh)"
export VERIFY_SECRET_VERSION_V1 VERIFY_SECRET_VERSION_V2 \
  OPENBAO_ROLE_ID OPENBAO_ROLE_NAME OPENBAO_WRAPPED_SECRET_ID \
  OPENBAO_TENANT_ROLE_ID OPENBAO_TENANT_ROLE_NAME OPENBAO_TENANT_WRAPPED_SECRET_ID
# 消费 wrapping token 的核验紧接着投递跑，其余用例在后
(cd core && cargo test -p secret-store)
(cd core && cargo test --workspace --exclude secret-store)
# Go 侧同理
# -count=1 关掉缓存：集成核验的结论取决于外部系统当下的状态，缓存命中等于没跑
(cd worker && PLATFORM_INTEGRATION=1 go test -count=1 ./...)
