#!/bin/bash
# official.sh <shots-dir-name> [email]: the whole M0 acceptance on the Keycloak stack for a fresh account.
# Steps: s1 provision + Keycloak login, s2 onboarding, s3 task, s4 docs with @doc/@task, s5 channel post @doc,
# s7 backlinks of both docs, s8 zh-CN home/doc/channel + Settings > Appearance. Logs go to <shots-dir>/logs.
set -u
cd /volumes/kailo/acceptance/m0
dir=${1:?shots dir}; mkdir -p "$dir/logs"
export SHOTS=/w/$dir
export M0_EMAIL=${2:-m0-$(date +%Y%m%d%H%M%S)@kailo-acceptance.test}
export M0_PASSWORD="$(openssl rand -base64 18)Aa1"
st=$dir/state.json; rm -f "$st"
run() { local n=$1; shift; env "$@" bash acc.sh "$n.mjs" "$st" > "$dir/logs/$n${LOG_SUFFIX:-}.log" 2>&1 || { echo "$n failed"; tail -5 "$dir/logs/$n${LOG_SUFFIX:-}.log"; exit 1; }; echo "$n ok"; }
run s1-login
run s2-onboard
run s3-task
run s4-docs
a=$(sed -n "s/^DOC_A //p" $dir/logs/s4-docs.log); b=$(sed -n "s/^DOC_B //p" $dir/logs/s4-docs.log)
run s5-channel M0_CHANNEL=m0-review
c=$(sed -n "s/^URL //p" $dir/logs/s5-channel.log | tail -1)
LOG_SUFFIX=-docA run s7-backlinks M0_SHOT=40-backlinks-docA M0_DOC_URL=$a
LOG_SUFFIX=-docB run s7-backlinks M0_SHOT=41-backlinks-docB M0_DOC_URL=$b
run s8-appearance M0_LOCALE=zh-CN M0_DOC_URL=$b M0_CHANNEL_URL=$c
grep -ho "References[^|]*|[^|]*|[^|]*|[^|]*|[^|]*" $dir/logs/s7-backlinks-doc*.log
grep -h "5xx:" -A3 $dir/logs/*.log | grep -v "^5xx: *$" | sort -u | head -20
rm -f "$st"
echo "M0_OK email=$M0_EMAIL doc_a=$a doc_b=$b channel=$c"
