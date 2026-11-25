#!/bin/bash
# kd30.sh <out-dir>: B-01 cutover acceptance (kailo/deploy/keycloak/acceptance.mjs from the deployed checkout) against
# the kailo deployment: login hand-off, Kailo-themed Keycloak in zh-CN and en (KD-30), tokens, refresh, logout, revocation.
# The two secrets reach the container through a 0600 env file only.
set -eu
cd /volumes/kailo/acceptance/m0
out=$PWD/${1:?out dir}; mkdir -p "$out"
export DOCKER_HOST=unix:///run/kailo-docker/docker.sock
s=/volumes/kailo/deploy/kailo/secrets
envf=$(mktemp); trap "rm -f $envf" EXIT
{ grep "^KAILO_INTERNAL_API_KEY=" $s/secrets.env; grep "^KAILO_KEYCLOAK_SERVICE_CLIENT_SECRET=" $s/keycloak.env; } > "$envf"
docker run --rm --name m0-kd30-$$ --cpus 2 --memory 4g --network kailo_internal --user $(id -u):$(id -g) -e HOME=/tmp \
  --env-file "$envf" -e KAILO_ORIGIN=https://192.168.0.149 -e KAILO_AUTH_INTERNAL_URL=http://authentication-service:8080 \
  -e KAILO_KEYCLOAK_INTERNAL_URL=http://keycloak:8080/idp -e OUT=/out \
  -v /volumes/kailo/kailo-macro/kailo/deploy/keycloak/acceptance.mjs:/work/acceptance.mjs:ro \
  -v /home/ubuntu/b01-accept/deps/node_modules:/work/node_modules:ro -v "$out":/out -w /work \
  mcr.microsoft.com/playwright:v1.62.0-noble node acceptance.mjs
