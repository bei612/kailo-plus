#!/usr/bin/env bash
# DD-149 protocol acceptance (V-SCN-240/241/242/246) against independent test peers.
#
# Usage: acceptance.sh <apps-tree> <check-image> <cargo-target-dir> <cache-dir>
#   apps-tree      an apps source tree checked out from GitHub (contains this file)
#   check-image    the fixed check image (local/kailo-check:<recipe>)
# Creates an isolated Docker network with an API-key peer and an OAuth peer (server.py,
# non-root, read-only), runs the ignored `mcp_connection::acceptance` tests inside the
# check image on that network with only that network as KAILO_EXTERNAL_MCP_DEV_CIDRS,
# and always removes the containers and the network. Secrets are generated per run and
# never printed.
set -euo pipefail
tree=$(cd "$1" && pwd); image=$2; target=$3; cache=$4
run=$(head -c 6 /dev/urandom | od -An -tx1 | tr -d ' \n')
net="dd149-acc-$run"
subnet="172.31.149.0/24"
key=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
peers=()
cleanup() {
  for c in "${peers[@]}"; do docker rm -f "$c" >/dev/null 2>&1 || true; done
  docker network rm "$net" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker network create --internal --subnet "$subnet" "$net" >/dev/null
start() { # name alias auth public-url
  local name="dd149-$1-$run"
  peers+=("$name")
  docker run -d --name "$name" --network "$net" --network-alias "$2" \
    --user 65534:65534 --read-only --tmpfs /tmp:size=1m --cap-drop ALL --security-opt no-new-privileges \
    --memory 128m --cpus 0.5 \
    --mount "type=bind,src=$tree/deploy/local/mcp-connector-test,dst=/srv,readonly" \
    -e MCP_TEST_AUTH="$3" -e MCP_TEST_API_KEY="$key" -e MCP_TEST_PUBLIC_URL="$4" \
    --entrypoint python3 "$image" /srv/server.py >/dev/null
}
start apikey peer.mcp-acceptance.test apikey http://peer.mcp-acceptance.test:8080
start oauth oauth.mcp-acceptance.test oauth http://oauth.mcp-acceptance.test:8080
for c in "${peers[@]}"; do
  for _ in $(seq 1 30); do
    docker logs "$c" 2>&1 | grep -q listening && break
    sleep 1
  done
done
docker run --rm --pull=never --network "$net" --cpus 8 --memory 16g --memory-swap 16g \
  --user "$(id -u):$(id -g)" \
  --mount "type=bind,src=$tree,dst=/workspace/apps" --mount "type=bind,src=$cache,dst=/cache" \
  --mount "type=bind,src=$target,dst=/target" \
  --mount "type=bind,src=$cache/cargo-registry,dst=/usr/local/cargo/registry" \
  --mount "type=bind,src=$cache/cargo-git,dst=/usr/local/cargo/git" \
  --workdir /workspace/apps/core --env HOME=/cache/home --env CARGO_TARGET_DIR=/target \
  --env SQLX_OFFLINE=true --env CARGO_NET_OFFLINE=true \
  --env KAILO_EXTERNAL_MCP_DEV_CIDRS="$subnet" \
  --env MCP_ACCEPTANCE_APIKEY_URL=http://peer.mcp-acceptance.test:8080/mcp \
  --env MCP_ACCEPTANCE_SSE_URL=http://peer.mcp-acceptance.test:8080/sse \
  --env MCP_ACCEPTANCE_OAUTH_URL=http://oauth.mcp-acceptance.test:8080/mcp \
  --env MCP_ACCEPTANCE_API_KEY="$key" \
  "$image" bash -c 'export PATH=/usr/local/cargo/bin:$PATH; cargo test -p platform-core --bin platform-core mcp_connection::acceptance -- --ignored --test-threads 1 2>&1 | grep -E "^test |test result|panicked|assert" '
