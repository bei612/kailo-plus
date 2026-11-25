#!/bin/bash
# usage: acc.sh <steps.mjs> [state] ; runs a step module against the kailo deployment (playwright on kailo_internal).
# The internal API key reaches the container through a 0600 env file, never on a command line.
cd /volumes/kailo/acceptance/m0
export DOCKER_HOST=unix:///run/kailo-docker/docker.sock
envf=$(mktemp); trap "rm -f $envf" EXIT
grep "^KAILO_INTERNAL_API_KEY=" /volumes/kailo/deploy/kailo/secrets/secrets.env > "$envf"
[ -n "${M0_PASSWORD:-}" ] && printf "M0_PASSWORD=%s\n" "$M0_PASSWORD" >> "$envf"
docker run --rm --name m0-acc-$$ --network kailo_internal --cpus 2 --memory 4g --user $(id -u):$(id -g) -e HOME=/tmp \
  -v $PWD:/w -w /w --env-file "$envf" -e KAILO_URL=https://192.168.0.149 -e MAILPIT_URL=http://mailpit:8025 -e SHOTS=${SHOTS:-/w/shots} \
  -e M0_LOCALE="${M0_LOCALE:-}" -e M0_EMAIL="${M0_EMAIL:-}" -e M0_CHANNEL="${M0_CHANNEL:-}" -e M0_CHANNEL_URL="${M0_CHANNEL_URL:-}" \
  -e M0_DOC_URL="${M0_DOC_URL:-}" -e M0_SHOT="${M0_SHOT:-}" mcr.microsoft.com/playwright:v1.62.0-noble node run.mjs "${2:-state.json}" "./$1"
