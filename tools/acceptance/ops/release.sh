#!/usr/bin/env bash
# release.sh <commit> <round>: deploy <commit> on the CI node with b02-deploy.sh while the current release serves, then
# run the post-deploy acceptance round into logs/<round>.log once the deploy is done (state/wait-and-rerun.sh).
# A deploy or waiter already running is stopped first (one release at a time). Prints the deploy log path.
set -euo pipefail
commit=${1:?usage: release.sh <commit> <round>}
round=${2:?usage: release.sh <commit> <round>}
acc=/volumes/kailo/acceptance/traing
for p in $(pgrep -f "[s]tate/wait-and-rerun.sh" || true); do kill "$p"; done
p=$(pgrep -f "[b]02-deploy.sh" | head -1 || true)
if [ -n "$p" ]; then kill -TERM -- "-$(ps -o pgid= "$p" | tr -d ' ')" 2>/dev/null || true; sleep 5; fi
sed -i "s#logs/[A-Za-z0-9_-]*\.log#logs/$round.log#g" "$acc/state/wait-and-rerun.sh"
log=/volumes/kailo/deploy/logs/deploy-${commit:0:10}-$(date -u +%Y%m%dT%H%M%SZ).log
(cd /volumes/kailo/deploy/work && nohup setsid bash b02-deploy.sh "$commit" > "$log" 2>&1 < /dev/null &)
sleep 2
(cd "$acc" && nohup setsid bash state/wait-and-rerun.sh "$log" > /dev/null 2>&1 < /dev/null &)
echo "$log"
