#!/bin/bash
# sql.sh: read-only query against macrodb (stdin = SQL), for acceptance cross-checks only.
export DOCKER_HOST=${KAILO_DOCKER_HOST:-unix:///run/kailo-docker/docker.sock}
docker exec -i kailo-postgres-1 sh -c 'PGOPTIONS="-c default_transaction_read_only=on" psql -U "$POSTGRES_USER" -d macrodb -P pager=off -F " | " -A'
