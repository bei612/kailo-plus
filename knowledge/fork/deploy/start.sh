#!/usr/bin/env bash
# Native Compose delivery; never build, bootstrap identities, or create a network.
set -euo pipefail
deployment_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
native_env="$deployment_dir/.env"
platform_env=
platform_adapter=false
file_storage_sync=false
validate=false
while (($#)); do
  case "$1" in
    --platform-model)
      [[ $# -ge 2 && "$2" = /* && -f "$2" ]] || {
        echo 'platform model requires the absolute existing sole platform env file' >&2
        exit 64
      }
      platform_env=$2
      shift 2
      ;;
    --validate) validate=true; shift ;;
    --platform-adapter) platform_adapter=true; shift ;;
    --file-storage-sync) file_storage_sync=true; shift ;;
    *) echo 'usage: start.sh [--platform-model /absolute/deploy/local/.env] [--platform-adapter] [--file-storage-sync] [--validate]' >&2; exit 64 ;;
  esac
done
[[ -f "$native_env" ]] || { echo 'native deployment .env is required' >&2; exit 78; }
# Neither ambient variables nor the native .env are another model endpoint
# authority. The platform env is last, so its derived values win in Compose.
unset PLATFORM_EDGE_NETWORK AGENTGATEWAY_MODEL_HOST AGENTGATEWAY_MODEL_PORT AGENTGATEWAY_MODEL_BASE_URL
args=(compose --project-directory "$deployment_dir" --env-file "$native_env")
if [[ -n "$platform_env" ]]; then
  for field in PLATFORM_EDGE_NETWORK AGENTGATEWAY_MODEL_HOST AGENTGATEWAY_MODEL_PORT AGENTGATEWAY_MODEL_BASE_URL; do
    grep -Eq "^${field}=.+$" "$platform_env" || {
      echo "sole platform configuration is missing $field" >&2
      exit 78
    }
  done
  args+=(--env-file "$platform_env")
fi
args+=(-f "$deployment_dir/compose.yaml")
if [[ -n "$platform_env" ]]; then
  args+=(-f "$deployment_dir/compose.model-gateway.yaml")
fi
if [[ "$platform_adapter" == true ]]; then
  args+=(-f "$deployment_dir/compose.adapter.yaml")
fi
if [[ "$file_storage_sync" == true ]]; then
  args+=(-f "$deployment_dir/compose.file-storage-sync.yaml")
fi
docker "${args[@]}" config --quiet
if [[ "$validate" == false ]]; then
  if [[ "$platform_adapter" == true ]]; then
    targets=(adapter-agent adapter)
    if [[ -n "$platform_env" || "$file_storage_sync" == true ]]; then targets+=(app); fi
    docker "${args[@]}" up -d --no-build --pull never --wait --no-deps "${targets[@]}"
  elif [[ -n "$platform_env" || "$file_storage_sync" == true ]]; then
    # Integration is applied to an already running independent service. Do not
    # recreate its frontend, reader, databases, or the platform Gateway.
    docker "${args[@]}" up -d --no-build --pull never --wait --no-deps app
  else
    docker "${args[@]}" up -d --no-build --pull never --wait
  fi
fi
