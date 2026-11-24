#!/bin/bash
# az.sh <resource> <permission> <subject>: one fully consistent SpiceDB check through the deployment's authz.py.
: "${KAILO_SRC:=/volumes/kailo/kailo-macro}"
export DOCKER_HOST=${KAILO_DOCKER_HOST:-unix:///run/kailo-docker/docker.sock} KAILO_STATE_DIR=${KAILO_STATE_DIR:-/volumes/kailo/deploy/kailo}
cd "$KAILO_SRC" && kailo/deploy/up.sh compose run --rm --no-deps -T spicedb-schema python3 -I /kailo/spicedb/authz.py check "$@" 2>&1 </dev/null | grep -v "^ Container\|^up.sh"
