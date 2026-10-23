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
    --native-env)
      [[ $# -ge 2 && "$2" = /* && -f "$2" ]] || {
        echo 'native deployment requires an absolute existing env file' >&2
        exit 64
      }
      native_env=$2
      shift 2
      ;;
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
    *) echo 'usage: start.sh [--native-env /absolute/native.env] [--platform-model /absolute/deploy/local/.env] [--platform-adapter] [--file-storage-sync] [--validate]' >&2; exit 64 ;;
  esac
done
[[ -f "$native_env" ]] || { echo 'native deployment .env is required' >&2; exit 78; }
# DD-128(5), SF-WEK-18: knowledge retrieval needs the postgres driver declared
# in this deployment (native_entrypoint.py refuses to start without it).
grep -Eq '^      RETRIEVE_DRIVER: postgres$' "$deployment_dir/compose.yaml" || {
  echo 'compose.yaml must declare app RETRIEVE_DRIVER: postgres' >&2
  exit 78
}
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
  # model-delivery already requires pre-existing nativeModelRef rows. First
  # enable transport and create them through the native UI; only a delivered
  # mapping enables ownership projection, before provisioning any service key.
  if grep -Eq '^KNOWLEDGE_MODEL_DELIVERY_INPUT_FILE=.+$' "$native_env"; then
    args+=(-f "$deployment_dir/compose.model-delivery.yaml")
  fi
  # DD-128(5): a native page entry binding's key, read by the original built-in
  # model declaration. Both files are named together or not at all.
  model_secret=$(grep -Ec '^KNOWLEDGE_MODEL_SECRET_ENV_FILE=.+$' "$native_env" || true)
  model_declaration=$(grep -Ec '^KNOWLEDGE_BUILTIN_MODELS_FILE=.+$' "$native_env" || true)
  if [[ "$model_secret$model_declaration" == 11 ]]; then
    args+=(-f "$deployment_dir/compose.native-model.yaml")
  elif [[ "$model_secret$model_declaration" != 00 ]]; then
    echo 'KNOWLEDGE_MODEL_SECRET_ENV_FILE and KNOWLEDGE_BUILTIN_MODELS_FILE are named together, once each' >&2
    exit 78
  fi
fi
if [[ "$platform_adapter" == true ]]; then
  args+=(-f "$deployment_dir/compose.adapter.yaml")
fi
if [[ "$file_storage_sync" == true ]]; then
  args+=(-f "$deployment_dir/compose.file-storage-sync.yaml")
fi
# DD-133(4): the member directory read follows the native env on every start,
# so later integration starts never drop it. The group is all-or-nothing.
directory_keys=0
for field in KNOWLEDGE_DIRECTORY_BINDING_ID KNOWLEDGE_DIRECTORY_CLIENT_ID KNOWLEDGE_DIRECTORY_CLIENT_SECRET_FILE \
  KNOWLEDGE_DIRECTORY_TOKEN_URL KNOWLEDGE_DIRECTORY_CORE_URL; do
  if grep -Eq "^${field}=.+$" "$native_env"; then directory_keys=$((directory_keys + 1)); fi
done
if [[ "$directory_keys" == 5 ]]; then
  grep -Eq '^KNOWLEDGE_ADAPTER_PLATFORM_NETWORK=.+$' "$native_env" || {
    echo 'the member directory read needs KNOWLEDGE_ADAPTER_PLATFORM_NETWORK (Core service network)' >&2
    exit 78
  }
  args+=(-f "$deployment_dir/compose.member-directory.yaml")
elif [[ "$directory_keys" != 0 ]] || grep -Eq '^KNOWLEDGE_DIRECTORY_INTERVAL_SECONDS=.+$' "$native_env"; then
  echo 'KNOWLEDGE_DIRECTORY_{BINDING_ID,CLIENT_ID,CLIENT_SECRET_FILE,TOKEN_URL,CORE_URL} are named together or not at all' >&2
  exit 78
fi
docker "${args[@]}" config --quiet
if [[ "$validate" == false ]]; then
  if [[ "$platform_adapter" == true ]]; then
    # The native backend consumes the same controlled MCP binding delivery;
    # updating only the adapter would leave a bearer-only native bypass.
    targets=(adapter-agent adapter app)
    docker "${args[@]}" up -d --no-build --pull never --wait --no-deps "${targets[@]}"
  elif [[ -n "$platform_env" || "$file_storage_sync" == true ]]; then
    # Integration is applied to an already running independent service. Do not
    # recreate its frontend, reader, databases, or the platform Gateway.
    docker "${args[@]}" up -d --no-build --pull never --wait --no-deps app
  else
    docker "${args[@]}" up -d --no-build --pull never --wait
  fi
fi
