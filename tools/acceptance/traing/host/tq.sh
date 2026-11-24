#!/bin/bash
# tq.sh <outfile> <temporal args...>: one read-only Temporal CLI call through the deployment's admin image.
: "${KAILO_SRC:=/volumes/kailo/kailo-macro}"
export DOCKER_HOST=${KAILO_DOCKER_HOST:-unix:///run/kailo-docker/docker.sock} KAILO_STATE_DIR=${KAILO_STATE_DIR:-/volumes/kailo/deploy/kailo}
out=$(realpath -m "$1"); shift
cd "$KAILO_SRC" && timeout 120 kailo/deploy/up.sh compose run --rm -T --entrypoint temporal temporal-namespace "$@" --namespace kailo > "$out" 2>&1 < /dev/null
echo "rc=$?" >> "$out"
