#!/usr/bin/env bash
# kailo-dev-check jobs on the CI node (OPS-05): the check runs detached from the caller's ssh session, so a dropped link
# (the dev box reaches the node over WireGuard) does not kill it; the dev-box wrapper reattaches and keeps reading.
#
#   dev-check-job.sh submit <branch|sha> [crate ...] [--web] [--affected] [--test|--no-test]
#                                                                  print the job id (same commit + arguments: the job
#                                                                  already running, or finished less than 15 min ago)
#   dev-check-job.sh follow <job> <offset>                         stream the log from byte <offset> until the job ends
#   dev-check-job.sh status <job>                                  "running" or "done <exit code>"
#
# Jobs live in <dev_check.root>/jobs/<id>/ (args, commit, log, rc when finished) and are removed a day after they end.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
CONFIG=${KAILO_CI_CONFIG:-/volumes/kailo/ci/config.json}
root=$(python3 -I -c 'import json,sys; print((json.load(open(sys.argv[1])).get("dev_check") or {}).get("root", "/var/lib/kailo-ci/ci-fs/dev-check"))' "$CONFIG")
mirror=$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["repositories"]["kailo-macro"]["source_repository"])' "$CONFIG")
queue=$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["queue"])' "$CONFIG")
jobs=$root/jobs
mkdir -p "$jobs"
die() { printf 'kailo-dev-check: %s\n' "$*" >&2; exit 2; }
valid_job() { [[ "${1:-}" =~ ^[0-9a-f]{16}$ ]] && [ -d "$jobs/$1" ] || die "no such job: ${1:-}"; }

case "${1:-}" in
  submit)
    shift
    [ $# -ge 1 ] || die "usage: submit <branch|sha> [crate ...|--affected]"
    ref=$1; shift
    [[ "$ref" =~ ^[A-Za-z0-9._/-]+$ ]] && [[ "$ref" != *..* ]] || die "invalid branch or commit: $ref"
    for a in "$@"; do
      [[ "$a" =~ ^--(affected|web|test|no-test)$ || "$a" =~ ^[A-Za-z0-9_-]+$ ]] || die "invalid argument: $a"
    done
    (
      exec 8>>"$queue/source-kailo-macro.lock"   # the CI worker's lock for the same mirror
      flock 8
      git -C "$mirror" fetch -q --prune origin '+refs/heads/*:refs/remotes/origin/*'
    )
    if [[ "$ref" =~ ^[0-9a-f]{7,40}$ ]] && commit=$(git -C "$mirror" rev-parse -q --verify "$ref^{commit}"); then :
    elif commit=$(git -C "$mirror" rev-parse -q --verify "refs/remotes/origin/$ref^{commit}"); then :
    else die "no branch or commit '$ref' on GitHub (push it first)"; fi
    args=("$@"); [ ${#args[@]} -gt 0 ] || args=(--affected)
    id=$(printf '%s %s\n' "$commit" "${args[*]}" | sha256sum | cut -c1-16)
    exec 9>>"$jobs/.lock"; flock 9
    find "$jobs" -mindepth 1 -maxdepth 1 -type d -mmin +1440 -exec rm -rf {} + 2>/dev/null || true
    dir=$jobs/$id
    if [ -d "$dir" ]; then
      if [ ! -f "$dir/rc" ] && [ -f "$dir/pid" ] && kill -0 "$(cat "$dir/pid")" 2>/dev/null; then
        echo "kailo-dev-check: reattaching to job $id (${commit:0:12} ${args[*]}, running)" >&2; echo "$id"; exit 0
      fi
      if [ -f "$dir/rc" ] && [ -n "$(find "$dir/rc" -mmin -15)" ]; then
        echo "kailo-dev-check: job $id (${commit:0:12} ${args[*]}) finished $(( ($(date +%s) - $(stat -c %Y "$dir/rc")) / 60 )) min ago; showing its result" >&2
        echo "$id"; exit 0
      fi
      rm -rf "$dir"
    fi
    mkdir -p "$dir"
    printf '%s\n' "$commit" > "$dir/commit"; printf '%s\n' "$ref" "${args[@]}" > "$dir/args"; : > "$dir/log"
    # Detached: own session, no terminal, output to the job log; the exit code lands in rc (written last).
    setsid nohup bash -c 'd=$1; shift; echo $$ > "$d/pid"; rc=0; "$@" || rc=$?; echo "$rc" > "$d/rc.tmp"; mv -f "$d/rc.tmp" "$d/rc"' \
      _ "$dir" env DEV_CHECK_REF_NAME="$ref" "$here/dev-check.sh" "$commit" "${args[@]}" \
      </dev/null >>"$dir/log" 2>&1 9>&- &
    for _ in $(seq 50); do [ -s "$dir/pid" ] && break; sleep 0.1; done
    echo "kailo-dev-check: started job $id (${commit:0:12} ${args[*]})" >&2
    echo "$id"
    ;;
  follow)
    valid_job "${2:-}"; dir=$jobs/$2; off=${3:-0}
    [[ "$off" =~ ^[0-9]+$ ]] || die "invalid offset: $off"
    while :; do
      done_=false; [ -f "$dir/rc" ] && done_=true
      size=$(stat -c %s "$dir/log")
      if [ "$size" -gt "$off" ]; then tail -c +"$((off + 1))" "$dir/log" | head -c "$((size - off))"; off=$size; fi
      $done_ && exit 0
      if [ ! -f "$dir/rc" ] && ! kill -0 "$(cat "$dir/pid" 2>/dev/null || echo 0)" 2>/dev/null; then
        sleep 1; [ -f "$dir/rc" ] && continue
        echo "kailo-dev-check: job $2 ended without an exit code (node restart?)" >&2; echo 1 > "$dir/rc"; continue
      fi
      sleep 2
    done
    ;;
  status)
    valid_job "${2:-}"; dir=$jobs/$2
    if [ -f "$dir/rc" ]; then echo "done $(cat "$dir/rc")"; else echo running; fi
    ;;
  *) sed -n '5,11p' "$0" >&2; exit 2 ;;
esac
