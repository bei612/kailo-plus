#!/usr/bin/env bash
# kailo-dev-check: fast Rust compile feedback for authors on the CI node (OPS-05; CI-CD 手册「kailo-dev-check」).
#
#   dev-check.sh <branch|sha> [crate ...] [--web] [--affected] [--test|--no-test]   (dev box: kailo-dev-check, same arguments)
#
# For a pushed kailo-macro branch: cargo fmt --check, `cargo check --tests` and `cargo clippy` of the given crates (or of
# the packages the branch's change set reaches, computed by the branch's kailo/ci/affected.sh like the CI does), with the
# CI's flags (kailo/ci/steps.sh: test and lint); with --web (picked by --affected when apps/web, packages or kailo/i18n
# change) the front-end checks of the CI web and lint steps: apps/web type-check, biome ci and import cycles on the
# changed files, ast-grep scan and rule tests, i18n catalogs, brand scan, and the Vitest tests the changed files reach
# (steps.sh web-test, `vitest related`). Then it exits: 0 clean, 1 errors, 2 usage, 75 the node had no room in time
# (EX_TEMPFAIL), 78 configuration. Errors print as cargo prints them.
# With --test (by default with --affected, dev_check.test_by_default) it then RUNS the selected packages' tests: the
# branch's own `kailo/ci/steps.sh test` (and `test-sandbox`), i.e. the CI test step's package selection (affected.sh,
# skip_tests included), migrations of the database and template1, nextest flags, RUSTFLAGS and Deno parts, in a
# throwaway container with the CI's environment, against the shared PostgreSQL (CI settings, CHECK_POSTGRES_ARGS), a
# throwaway redis, OpenBao dev server and SpiceDB as check.sh starts them. Keycloak, OpenMeter and microsandbox are not
# started and not listed in KAILO_TEST_SERVICES, so their tests skip exactly as in a CI run whose selection does not
# start them. The test part holds the node's heavy lock (like the CI test phase) after its own memory preflight; it
# runs with dev_check.test_memory (12g) and test_jobs (6: build jobs and nextest --test-threads) in a target directory
# of its slot (<slot>/test-target, capped at test_target_cap_gb), and is skipped when `check --tests` already failed.
#
# It is NOT the CI: no job, no queue, no verify record; the unified CI stays with the main agent. Warm instead of fresh:
#   - per slot one persistent checkout (only the files a branch switch changes get new mtimes, so cargo rechecks only
#     them) and one persistent container (the branch's check image, recreated when that image or the node_modules
#     snapshot changes), incremental target directories on the CI cache filesystem (ci-fs), the shared sccache, cargo
#     registry and node_modules snapshots of the CI;
#   - test code is checked against a live PostgreSQL (`kailo-dev-check-pg`, tmpfs, shared by the slots) migrated with
#     the branch's migrations, one database per migrations tree (SQLX_OFFLINE=false, like the CI test step); clippy
#     runs offline on the branch's .sqlx, like the CI lint step.
# Slots (dev_check.slots, default 1): up to that many runs at once, each in its own slot (lock, checkout, target
# directory, container); a run takes the first free slot, else waits for any. Slot 0 is <root>/{src,target},
# dev-check.lock, container kailo-dev-check; slot i>0 is <root>/slot-<i>/{src,target}, its dev-check.lock and
# container kailo-dev-check-<i>. The PostgreSQL container, its network and databases are shared: the databases are
# content-addressed (migrations tree) and only read by the sqlx macros, so one migration serves every slot.
# By default the compile runs under the node's heavy lock (locks.heavy, shared with image builds and the CI test
# phase), so it never competes with a verify's test phase or an image build; that also serializes the slots' compiles
# (dev_check.compile_under_heavy_lock=false runs them beside each other and beside the CI). Before it the resource
# preflight of the CI (envguard.py) admits the run, one slot at a time, counting the memory the other running slots may
# still take. Settings: config.json `dev_check` (defaults below).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
CONFIG=${KAILO_CI_CONFIG:-/volumes/kailo/ci/config.json}
export DOCKER_HOST=unix:///run/kailo-docker/docker.sock
usage() { sed -n '4,5p' "$0" >&2; exit 2; }
say() { printf 'kailo-dev-check: %s\n' "$*" >&2; }
[ $# -ge 1 ] || usage
ref=$1; shift
crates=(); affected=false; web=false; test_flag=
for a in "$@"; do
  case "$a" in
    --affected) affected=true ;;
    --web) web=true ;;
    --test) test_flag=true ;;
    --no-test) test_flag=false ;;
    -*) usage ;;
    *) [[ "$a" =~ ^[A-Za-z0-9_-]+$ ]] || { say "invalid crate name: $a"; exit 2; }; crates+=("$a") ;;
  esac
done
[ ${#crates[@]} -gt 0 ] || $web || affected=true
[[ "$ref" =~ ^[A-Za-z0-9._/-]+$ ]] && [[ "$ref" != *..* ]] || { say "invalid branch or commit: $ref"; exit 2; }

# Settings (config.json): the kailo-macro repository's mirror, caches and images, and dev_check overrides.
eval "$(python3 -I - "$CONFIG" <<'PY'
import json, shlex, sys
cfg = json.load(open(sys.argv[1]))
repo = cfg["repositories"]["kailo-macro"]
env = {**{k: str(v) for k, v in (cfg.get("environment") or {}).items()},
       **{k: str(v) for k, v in (repo.get("environment") or {}).items()}}
dc = cfg.get("dev_check") or {}
out = dict(
    mirror=repo["source_repository"], queue=cfg["queue"],
    cache=env["CHECK_CACHE_ROOT"], nm_root=env.get("CHECK_NODE_MODULES_ROOT", env["CHECK_CACHE_ROOT"] + "/node-modules"),
    sccache_size=env.get("CHECK_SCCACHE_SIZE", "20G"), docker_config=env.get("DOCKER_CONFIG", ""),
    buildx_builder=env.get("BUILDX_BUILDER", ""), cgroup_parent=env.get("CHECK_CGROUP_PARENT", ""),
    pg_image=env.get("CHECK_POSTGRES_IMAGE", "pgvector/pgvector:pg18"),
    pg_data=env.get("CHECK_POSTGRES_DATA", "/var/lib/postgresql"),
    root=dc.get("root", "/var/lib/kailo-ci/ci-fs/dev-check"),
    cpus=str(dc.get("cpus", 8)), memory=dc.get("memory", "12g"), cap_gb=str(dc.get("target_cap_gb", 25)),
    # The tests need the CI's PostgreSQL settings (max_connections=500, max_locks_per_transaction, WAL) and room for
    # their databases (the CI test phase peaks at ~1.7 GiB of tmpfs); memory covers tmpfs + PostgreSQL itself.
    pg_memory=dc.get("postgres_memory", "6g"), pg_tmpfs=dc.get("postgres_tmpfs", "4g"),
    pg_shm=dc.get("postgres_shm", env.get("CHECK_POSTGRES_SHM", "1g")),
    pg_args=dc.get("postgres_args", env.get("CHECK_POSTGRES_ARGS", "-c fsync=off -c synchronous_commit=off "
        "-c full_page_writes=off -c max_wal_size=1GB -c max_locks_per_transaction=8192 -c max_connections=500")),
    test_default=str(dc.get("test_by_default", True)).lower(),
    test_memory=dc.get("test_memory", dc.get("memory", "12g")), test_jobs=str(dc.get("test_jobs", 6)),
    test_cap_gb=str(dc.get("test_target_cap_gb", 18)),
    keep_dbs=str(dc.get("keep_databases", 6)), max_wait=str(dc.get("max_wait", 7200)),
    heavy_lock=(cfg.get("locks") or {}).get("heavy", "/var/lib/kailo-ci/locks/image-build.lock"),
    compile_heavy=str(dc.get("compile_under_heavy_lock", True)).lower(),
    heavy_mode=str(dc.get("heavy_lock_mode", "shared")).lower(),
    slots=str(max(1, int(dc.get("slots", 1)))),
)
def size(v):
    t = str(v).strip().lower().rstrip("ib").rstrip("b")
    return int(float(t[:-1]) * {"k": 1 << 10, "m": 1 << 20, "g": 1 << 30, "t": 1 << 40}[t[-1]]) if t[-1] in "kmgt" else int(t)
# The test part's admission: its container, the PostgreSQL tmpfs it may fill, redis + OpenBao + SpiceDB (2 GiB).
out["test_need"] = str(size(out["test_memory"]) + size(out["pg_tmpfs"]) + (2 << 30))
for k, v in out.items():
    print(f"{k}={shlex.quote(str(v))}")
PY
)"
# Tests: --test / --no-test, else with --affected unless dev_check.test_by_default is false.
if [ -n "$test_flag" ]; then run_tests=$test_flag
elif $affected && [ "$test_default" != false ]; then run_tests=true
else run_tests=false; fi
pg=kailo-dev-check-pg     # shared by the slots, like its network and databases
net=kailo-dev-check
tsvc=kailo-dev-check-t    # the test part's throwaway containers: one test part at a time on the node (test-part.lock)
mkdir -p "$root" "$root/ids" "$root/dbs" "$(dirname "$heavy_lock")"
slot_dir() { if [ "$1" -eq 0 ]; then echo "$root"; else echo "$root/slot-$1"; fi; }
slot_container() { if [ "$1" -eq 0 ]; then echo kailo-dev-check; else echo "kailo-dev-check-$1"; fi; }
slot_busy() {  # its lock is held by a run
  local lock; lock="$(slot_dir "$1")/dev-check.lock"
  [ -e "$lock" ] && ! flock -n "$lock" true 2>/dev/null
}

# -- locks -------------------------------------------------------------------------------------------------------
# The holder file next to a lock says who has it (informational: the lock itself is the flock).
hold() {  # hold <fd> <lock file> <what> [-s]: take the lock (shared with -s), waiting up to max_wait seconds and saying for whom
  local fd=$1 lock=$2 what=$3 mode=${4:-} waited=0 holder
  if ! flock $mode -n "$fd"; then
    holder=$(cat "$lock.holder" 2>/dev/null || echo unknown)
    say "waiting for $(basename "$lock") (held by: $holder)"
    until flock $mode -w 60 "$fd"; do
      waited=$((waited + 60))
      [ "$waited" -lt "$max_wait" ] || { say "gave up after ${max_wait}s waiting for $(basename "$lock")"; return 75; }
      say "still waiting for $(basename "$lock") (${waited}s; held by: $(cat "$lock.holder" 2>/dev/null || echo unknown))"
    done
  fi
  printf '%s pid=%s since=%s\n' "$what" "$$" "$(date -u +%FT%TZ)" > "$lock.holder" 2>/dev/null || true
}
# -- slot: the first free one, else wait for any (fd 7 holds its lock for the whole run) --------------------------
take_slot() {
  local i d
  for ((i = 0; i < slots; i++)); do
    d=$(slot_dir "$i"); mkdir -p "$d"
    exec 7>>"$d/dev-check.lock"
    if flock -n 7; then slot=$i; return 0; fi
    exec 7>&-
  done
  return 1
}
holders() {
  local i
  for ((i = 0; i < slots; i++)); do printf 'slot %s: %s; ' "$i" "$(cat "$(slot_dir "$i")/dev-check.lock.holder" 2>/dev/null || echo unknown)"; done
}
slot=
if ! take_slot; then
  waited=0
  say "all $slots slot(s) busy; waiting for one (held by: $(holders))"
  until take_slot; do
    [ "$waited" -lt "$max_wait" ] || { say "gave up after ${max_wait}s waiting for a free slot"; exit 75; }
    sleep 15; waited=$((waited + 15))
    [ $((waited % 300)) -ne 0 ] || say "still waiting for a free slot (${waited}s; held by: $(holders))"
  done
fi
sdir=$(slot_dir "$slot")
src=$sdir/src
target=$sdir/target
container=$(slot_container "$slot")
mkdir -p "$target"
printf '%s pid=%s since=%s\n' "kailo-dev-check $ref" "$$" "$(date -u +%FT%TZ)" > "$sdir/dev-check.lock.holder" 2>/dev/null || true
[ "$slots" -eq 1 ] || say "slot $slot of $slots ($container)"

# Interrupted (the dev box's ssh went away, Ctrl-C): stop what runs in the container, so the next run does not wait
# for an orphaned cargo holding the build directory lock.
running=false; testing=false
test_down() { docker rm -f -v "$tsvc-run" "$tsvc-sandbox" "$tsvc-redis" "$tsvc-openbao" "$tsvc-spicedb" >/dev/null 2>&1 || true; }
interrupted() {
  $running && docker restart -t 1 "$container" >/dev/null 2>&1 || true
  $testing && test_down
  exit 130
}
trap interrupted INT TERM HUP PIPE

# -- source ------------------------------------------------------------------------------------------------------
(
  exec 8>>"$queue/source-kailo-macro.lock"   # the CI worker's lock for the same mirror
  flock 8
  git -C "$mirror" fetch -q --prune origin '+refs/heads/*:refs/remotes/origin/*'
)
if [[ "$ref" =~ ^[0-9a-f]{7,40}$ ]] && commit=$(git -C "$mirror" rev-parse -q --verify "$ref^{commit}"); then :
elif commit=$(git -C "$mirror" rev-parse -q --verify "refs/remotes/origin/$ref^{commit}"); then :
else say "no branch or commit '$ref' on GitHub (push it first)"; exit 2; fi
checkout() {
  [ -d "$src/.git" ] || git clone -q --shared --no-checkout "$mirror" "$src"
  git -C "$src" fetch -q "$mirror" '+refs/remotes/origin/*:refs/remotes/origin/*' &&
    git -C "$src" -c advice.detachedHead=false checkout -q -f --detach "$commit" &&
    git -C "$src" clean -q -ffd   # untracked files go; ignored ones (node_modules mount points) stay
}
if ! checkout; then  # e.g. objects of the previous commit pruned from the mirror: start the checkout over
  say "persistent checkout unusable; recreating it (one cold compile of the workspace crates)"
  rm -rf "$src"; checkout
fi
ref_name=${DEV_CHECK_REF_NAME:-$ref}   # the branch the caller named (dev-check-job.sh passes the resolved commit)
say "$ref_name @ ${commit:0:12}"

# -- image, node_modules snapshot, container ---------------------------------------------------------------------
image="local/kailo-macro-check:$(sha256sum "$src/kailo/ci/check.Dockerfile" | cut -c1-16)"
exec 9>>"$heavy_lock"
heavy_held=false
heavy() { $heavy_held || { hold 9 "$heavy_lock" "kailo-dev-check $ref" || return $?; heavy_held=true; }; }
# The compile and test phases take the heavy lock SHARED by default (dev_check.heavy_lock_mode): dev-check slots run
# beside each other (the admission above reserves memory for the other running slots), while image builds and the CI
# test phase, which take it exclusively, still never overlap a dev-check. The check-image build keeps it exclusive.
heavy_run() {
  if [ "$heavy_mode" = shared ]; then
    $heavy_held || { hold 9 "$heavy_lock" "kailo-dev-check $ref (shared)" -s || return $?; heavy_held=true; }
  else heavy; fi
}
if ! docker image inspect "$image" >/dev/null 2>&1; then
  heavy   # an image build: same lock as every other image build on the node
  if ! docker image inspect "$image" >/dev/null 2>&1; then   # another slot may have built it while we waited
    say "building the check image $image"
    DOCKER_CONFIG=${docker_config:-$HOME/.docker} BUILDX_BUILDER=$buildx_builder \
      docker buildx build --load --progress=plain -f "$src/kailo/ci/check.Dockerfile" -t "$image" "$src/kailo/ci" >&2
  fi
fi
bun_image=oven/bun:$(sed -n 's/.*"packageManager": *"bun@\([0-9.]*\)".*/\1/p' "$src/package.json")
# Same key and layout as kailo/ci/check.sh js_deps, so the CI's snapshots serve here and a snapshot made here serves the
# CI (the code_mode_assets build script needs the JS packages).
nm_key=$( { echo "v1 $bun_image"; git -C "$src" ls-files -s -- bun.lock bunfig.toml ':(glob)**/package.json' \
            ':(glob)**/bun.lock' ':(glob)**/patches/**'; } | sha256sum | cut -c1-24)
snap=$nm_root/$nm_key
if [ ! -f "$snap/complete" ]; then
  say "no node_modules snapshot $nm_key; bun install (once per lockfile state)"
  docker image inspect "$bun_image" >/dev/null 2>&1 || docker pull -q "$bun_image" >/dev/null
  docker rm -f "$container" >/dev/null 2>&1 || true   # its mounts sit inside the checkout
  find "$src" -path "$src/.git" -prune -o -name node_modules -type d -prune -exec rm -rf {} +
  docker run --rm ${cgroup_parent:+--cgroup-parent "$cgroup_parent"} --cpus "$cpus" --memory 8g --user "$(id -u):$(id -g)" \
    -v "$src:/src" -w /src -v "$cache:/cache" -e HOME=/cache/home -e BUN_INSTALL_CACHE_DIR=/cache/bun "$bun_image" \
    sh -c 'bun install --frozen-lockfile && cd packages/sdk && bun install --frozen-lockfile' >&2
  tmp=$nm_root/.tmp-dev-$$
  rm -rf "$tmp"; mkdir -p "$tmp/tree"
  (cd "$src" && find . -path ./.git -prune -o -name node_modules -type d -prune -print) > "$tmp/list"
  while IFS= read -r d; do mkdir -p "$tmp/tree/$(dirname "$d")" && mv "$src/$d" "$tmp/tree/$d"; done < "$tmp/list"
  touch "$tmp/complete"
  mv -T "$tmp" "$snap" 2>/dev/null || rm -rf "$tmp"
fi
touch "$snap"   # most recently used: the CI keeps the three newest snapshots
nm_mounts=()
while IFS= read -r d; do d=${d#./}; mkdir -p "$src/$d"; nm_mounts+=(-v "$snap/tree/$d:/src/$d"); done < "$snap/list"
# Shared by the slots: written only when different, and by rename (a running container keeps the file it mounted).
put() { [ "$(cat "$1" 2>/dev/null)" = "$2" ] || { printf '%s\n' "$2" > "$1.tmp.$$" && mv -f "$1.tmp.$$" "$1"; }; }
put "$root/ids/passwd" "$(printf 'root:x:0:0:root:/root:/bin/sh\nkailo:x:%s:%s:kailo:/cache/home:/bin/sh' "$(id -u)" "$(id -g)")"
put "$root/ids/group" "$(printf 'root:x:0:\nkailo:x:%s:' "$(id -g)")"

# The shared network, secret and PostgreSQL are created by one slot at a time (fd 6, released after the databases).
exec 6>>"$root/shared.lock"; flock 6
docker network inspect "$net" >/dev/null 2>&1 || docker network create "$net" >/dev/null
want="v2 $image $nm_key $(stat -c %i "$snap") $cpus $memory $sccache_size"
have=$(docker inspect -f '{{index .Config.Labels "kailo.dev-check"}}' "$container" 2>/dev/null || true)
if [ "$have" != "$want" ] || [ "$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null)" != true ]; then
  docker rm -f "$container" >/dev/null 2>&1 || true
  say "starting the warm container ($image)"
  docker run -d --name "$container" --init --restart unless-stopped --label "kailo.dev-check=$want" \
    ${cgroup_parent:+--cgroup-parent "$cgroup_parent"} --cpus "$cpus" --memory "$memory" --memory-swap "$memory" \
    --user "$(id -u):$(id -g)" --network "$net" \
    -v "$src:/src" -w /src -v "$mirror:$mirror:ro" -v "$cache:/cache" -v "$target:/cache/target" "${nm_mounts[@]}" \
    -v "$root/ids/passwd:/etc/passwd:ro" -v "$root/ids/group:/etc/group:ro" \
    -v "$cache/cargo-registry:/usr/local/cargo/registry" -v "$cache/cargo-git:/usr/local/cargo/git" \
    -e HOME=/cache/home -e BUN_INSTALL_CACHE_DIR=/cache/bun -e RUSTUP_TOOLCHAIN=1.94.0 -e CARGO_NET_GIT_FETCH_WITH_CLI=true -e CARGO_TERM_COLOR=never \
    -e CARGO_BUILD_JOBS="${cpus%.*}" -e RUSTC_WRAPPER=sccache -e SCCACHE_DIR=/cache/sccache \
    -e SCCACHE_CACHE_SIZE="$sccache_size" "$image" sleep infinity >/dev/null
fi
x() { docker exec "$container" "$@" 9>&- 7>&- 6>&- 5>&-; }

# -- live database for test code (one per migrations tree) ---------------------------------------------------------
[ -s "$root/pg.secret" ] || { umask 077; head -c 24 /dev/urandom | base64 | tr -d '/+=' > "$root/pg.secret"; }
# Settings changed (dev_check.postgres_*, CHECK_POSTGRES_ARGS): recreated, but only while no other slot runs (its
# compile reads the databases); otherwise the next run does it.
read -r -a pg_argv <<<"$pg_args"
pg_want="v2 $pg_image $pg_memory $pg_tmpfs $pg_shm $pg_args"
pg_up=false; [ "$(docker inspect -f '{{.State.Running}}' "$pg" 2>/dev/null)" = true ] && pg_up=true
if $pg_up && [ "$(docker inspect -f '{{index .Config.Labels "kailo.dev-check-pg"}}' "$pg" 2>/dev/null)" != "$pg_want" ]; then
  busy=false
  for ((i = 0; i < slots; i++)); do [ "$i" -eq "$slot" ] || ! slot_busy "$i" || busy=true; done
  if $busy; then say "PostgreSQL settings changed; another slot is running, so it is recreated by a later run"
  else say "PostgreSQL settings changed; recreating it (databases are migrated again)"; pg_up=false; fi
fi
if ! $pg_up; then
  docker rm -f "$pg" >/dev/null 2>&1 || true
  rm -f "$root"/dbs/* "$root/template1.tree"
  docker image inspect "$pg_image" >/dev/null 2>&1 || docker pull -q "$pg_image" >/dev/null
  docker run -d --name "$pg" --restart unless-stopped --network "$net" ${cgroup_parent:+--cgroup-parent "$cgroup_parent"} \
    --label "kailo.dev-check-pg=$pg_want" --cpus 2 --memory "$pg_memory" --shm-size "$pg_shm" \
    --tmpfs "$pg_data:size=$pg_tmpfs" -e POSTGRES_PASSWORD="$(cat "$root/pg.secret")" "$pg_image" "${pg_argv[@]}" >/dev/null
  for _ in $(seq 60); do docker exec "$pg" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
fi
pgq() { docker exec "$pg" psql -U postgres -v ON_ERROR_STOP=1 -Atq "$@" 9>&- 7>&- 6>&- 5>&-; }
mig_tree=$(git -C "$src" rev-parse HEAD:crates/macro_db_client/migrations)
db=dc_${mig_tree:0:16}
pg_url="postgres://postgres:$(cat "$root/pg.secret")@$pg:5432"
db_url="$pg_url/$db"
if [ "$(pgq -c "select 1 from pg_database where datname='$db'")" != 1 ]; then
  say "migrating a database for migrations ${mig_tree:0:12}"
  # From template0: template1 is the test part's (migrated with whatever tree the last test run used).
  { pgq -c "create database \"$db\" template template0" &&
    x env DATABASE_URL="$db_url" sqlx migrate run --source crates/macro_db_client/migrations >/dev/null; } || {
    pgq -c "drop database if exists \"$db\" with (force)" >/dev/null 2>&1 || true
    say "migrations of ${commit:0:12} do not apply"; exit 1; }
fi
touch "$root/dbs/$db"
# Least recently used beyond keep_databases go, except those touched in the last two hours (another slot's run).
ls -1t "$root/dbs" | tail -n +$((keep_dbs + 1)) | while read -r old; do
  [ -n "$(find "$root/dbs/$old" -maxdepth 0 -mmin +120)" ] || continue
  docker exec "$pg" dropdb -U postgres --if-exists "$old" >/dev/null 2>&1 || true; rm -f "$root/dbs/$old"
done
exec 6>&-

# -- target cap, preflight, heavy lock (the affected-package filter may compile too) ------------------------------
used=$(du -sx -BG "$target" 2>/dev/null | cut -f1 | tr -dc 0-9)
if [ "${used:-0}" -gt "$cap_gb" ]; then
  say "target directories use ${used}G > ${cap_gb}G; clearing them (next run is cold)"
  find "$target" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
fi
# Admission one slot at a time (fd 5): a slot that is running counts with what its container may still take
# (memory limit - current use), so runs admitted together cannot overcommit the node.
need=$memory
if [ "$slots" -gt 1 ]; then
  exec 5>>"$root/admit.lock"
  flock -w "$max_wait" 5 || { say "gave up after ${max_wait}s waiting for admission"; exit 75; }
  others=()
  for ((i = 0; i < slots; i++)); do
    [ "$i" -ne "$slot" ] || continue
    # busy (its lock held) and its container up; a busy slot still starting its container is not counted
    if ! flock -n "$(slot_dir "$i")/dev-check.lock" true 2>/dev/null &&
       [ "$(docker inspect -f '{{.State.Running}}' "$(slot_container "$i")" 2>/dev/null)" = true ]; then
      others+=("$(slot_container "$i")")
    fi
  done
  # another slot's test part (its throwaway container; at most one on the node)
  [ "$(docker inspect -f '{{.State.Running}}' "$tsvc-run" 2>/dev/null)" = true ] && others+=("$tsvc-run")
  if [ ${#others[@]} -gt 0 ]; then
    read -r need reserve < <(docker stats --no-stream --format '{{.MemUsage}}' "${others[@]}" 2>/dev/null |
      python3 -I -c '
import re, sys
UNITS = dict(b=1, k=1 << 10, kb=1000, kib=1 << 10, m=1 << 20, mb=10**6, mib=1 << 20, g=1 << 30, gb=10**9, gib=1 << 30)
def size(text):
    m = re.fullmatch(r"([0-9.]+)\s*([a-z]*)", text.strip().lower())
    return int(float(m.group(1)) * UNITS.get(m.group(2) or "b", 1)) if m else 0
reserve = sum(max(0, size(limit) - size(used)) for used, _, limit in (line.partition("/") for line in sys.stdin))
print(size(sys.argv[1]) + reserve, reserve)' "$memory") || true
    [ -n "${reserve:-}" ] || { need=$memory; reserve=0; }   # a container being recreated: no figure, own memory only
    say "admission: ${#others[@]} other slot(s) running; reserving $((reserve >> 20))MiB more they may still take"
  fi
fi
python3 -I "$here/envguard.py" --config "$CONFIG" preflight --repo kailo-macro --stage dev-check --memory "$need" \
  --wait "$max_wait" || exit $?
exec 5>&-
# dev_check.compile_under_heavy_lock (default true): false lets the compile run beside an image build or a verify's
# test phase. Admission then rests on the memory preflight above and the container's own cpus/memory limits; the
# check image build keeps the heavy lock either way.
[ "$compile_heavy" = false ] || heavy_run

# -- selection --------------------------------------------------------------------------------------------------
# Change set as the CI computes it: merge-base with origin/main (first parent for a commit on main).
if git -C "$src" merge-base --is-ancestor "$commit" refs/remotes/origin/main; then
  base=$(git -C "$src" rev-parse -q --verify "$commit^1" || true)
else
  base=$(git -C "$src" merge-base "$commit" refs/remotes/origin/main || true)
fi
: > "$src/.git/kailo-dev-changed"   # empty (no base): affected.sh selects everything, web-test runs every test
[ -z "$base" ] || git -C "$src" diff --name-only --no-renames "$base" "$commit" > "$src/.git/kailo-dev-changed"
printf '%s\n' "$base" > "$src/.git/kailo-dev-base"
sel=; skip_tests=false
if $affected; then
  # Both lines (selection, skip_tests) go to the test part as the CI's KAILO_AFFECTED file.
  if ! x env KAILO_CHANGED_FILES=/src/.git/kailo-dev-changed KAILO_BASE="${base:-HEAD}" KAILO_BIN_CACHE=/cache/bin \
      bash kailo/ci/affected.sh > "$src/.git/kailo-dev-affected" || ! sel=$(sed -n 1p "$src/.git/kailo-dev-affected") ||
      [ -z "$sel" ]; then
    say "the affected-package selection (kailo/ci/affected.sh) failed, see above: the CI's lint and test fail the same way"
    exit 1
  fi
  [ "$(sed -n 2p "$src/.git/kailo-dev-affected")" = true ] && skip_tests=true
  say "affected since ${base:0:12}: Rust: $sel$($skip_tests && echo ' (skip_tests: only .sqlx or clippy.toml changed)')"
  if [ -z "$base" ] || grep -qE '^(apps/web/|packages/|kailo/i18n/)' "$src/.git/kailo-dev-changed"; then web=true; fi
  [ "$sel" = all ] && say "the change set reaches every package (toolchain, .cargo or no base): checking the workspace"
  [ "$sel" = all ] || [ "$sel" = none ] || read -r -a crates <<<"$sel"
  if [ "$sel" = none ] && ! $web; then say "no Rust package and no front-end file affected; nothing to check"; exit 0; fi
fi
$web && say "front-end checks: on (changed files since ${base:0:12})"
$affected || printf '%s\nfalse\n' "${crates[*]}" > "$src/.git/kailo-dev-affected"   # the named crates
pkgs=(); test_pkgs=(); sync=false; soup=false
if [ "${sel:-}" = all ]; then
  pkgs=(--workspace --exclude sync_service); test_pkgs=(--workspace --exclude sync_service); sync=true; soup=true
else
  for c in "${crates[@]}"; do
    if [ "$c" = sync_service ]; then sync=true; else pkgs+=(-p "$c"); test_pkgs+=(-p "$c"); fi
    [ "$c" = soup ] && soup=true
  done
fi

# -- checks -----------------------------------------------------------------------------------------------------
# Incremental for the workspace crates only (profile setting, not CARGO_INCREMENTAL: sccache refuses that variable and
# passes the incremental member compilations through), so a re-check after an edit redoes just the edited code.
lint_flags="-Dwarnings -Dclippy::disallowed_methods -C link-arg=-fuse-ld=mold"
results=(); failed=0; no_room=0; check_tests_rc=0; part_rc=0
record() {  # record <name> <rc|skipped> <start>: one summary line
  local status=ok
  case "$2" in 0) ;; skipped) status=skipped ;; 75) status=no-room; no_room=1 ;; *) status=FAIL; failed=1 ;; esac
  results+=("$(printf '%-16s %-8s %5ss' "$1" "$status" $(( $(date +%s) - $3 )))")
}
part() {  # part <name> <command...>
  local name=$1 t0 rc=0; shift
  printf '\n===== %s =====\n' "$name"
  t0=$(date +%s); running=true
  x "$@" || rc=$?
  running=false
  record "$name" "$rc" "$t0"
  part_rc=$rc   # (part itself returns 0: set -e, and every part runs)
}
rust=false; { [ ${#pkgs[@]} -gt 0 ] || $sync; } && rust=true
fmt_pkgs=("${pkgs[@]}"); $sync && [ "${sel:-}" != all ] && fmt_pkgs+=(-p sync_service)
[ "${sel:-}" = all ] && fmt_pkgs=(--all)
if $rust; then part "fmt" cargo fmt --check "${fmt_pkgs[@]}"; fi
if [ ${#test_pkgs[@]} -gt 0 ]; then
  # steps.sh test: live database; `check` instead of nextest's build (no codegen, no run)
  # (the lint RUSTFLAGS: plain rustc ignores the clippy tool lint, so the diagnostics are the test step's, and both
  # parts share one target directory: the dependencies are compiled once for both)
  part "check --tests" env CARGO_TARGET_DIR=/cache/target/dev CARGO_PROFILE_DEV_INCREMENTAL=true \
    CARGO_PROFILE_TEST_INCREMENTAL=true SQLX_OFFLINE=false DATABASE_URL="$db_url" RUSTFLAGS="$lint_flags" \
    cargo check --locked --all-features --tests "${test_pkgs[@]}"
  check_tests_rc=$part_rc
fi
# steps.sh lint: clippy_selected, offline on the branch's .sqlx
clippy_env=(env CARGO_TARGET_DIR=/cache/target/dev CARGO_PROFILE_DEV_INCREMENTAL=true CARGO_PROFILE_TEST_INCREMENTAL=true
  SQLX_OFFLINE=true RUSTFLAGS="$lint_flags")
if [ ${#pkgs[@]} -gt 0 ]; then part "clippy" "${clippy_env[@]}" cargo clippy --all-features "${pkgs[@]}"; fi
if $sync; then
  part "clippy sync" "${clippy_env[@]}" cargo clippy -p sync_service -- -A clippy::unnecessary_map_or -A clippy::collapsible_if
fi
if $soup; then
  part "clippy soup" "${clippy_env[@]}" sh -c \
    'cargo clippy -p soup --no-default-features && cargo clippy -p soup --no-default-features --features ports'
fi
if $web; then
  # The CI's commands: steps.sh web (type-check), steps.sh lint (biome and import cycles on the changed files,
  # ast-grep, i18n catalogs, brand scan), steps.sh web-test (Vitest on what the changed files reach).
  part "web type-check" bash -c 'cd apps/web && bun run type-check'
  part "biome (changed)" bash -c 'rc=0; since=(); [ -n "$1" ] && since=(--since="$1")
    for dir in apps/web packages/collaboration; do
      echo "-- biome ci --changed ($dir)"
      (cd "$dir" && bun x --bun biome ci --changed "${since[@]}" --no-errors-on-unmatched --error-on-warnings --colors=off) || rc=1
      echo "-- biome import cycles --changed ($dir)"
      (cd "$dir" && bun x --bun biome lint --changed "${since[@]}" --no-errors-on-unmatched \
        --only=suspicious/noImportCycles --colors=off) || rc=1
    done; exit $rc' _ "$base"
  part "ast-grep" bash -c 'bun x @ast-grep/cli@0.44.1 scan --off=tsx-no-hardcoded-ui-string --off=ts-no-hardcoded-ui-string \
    && bun x @ast-grep/cli@0.44.1 test --skip-snapshot-tests'
  part "i18n catalogs" bun kailo/i18n/check.ts
  part "brand scan" bash kailo/ci/brand-scan.sh
  wasm_cache=/cache/wasm-pkgs/${image##*:}
  mkdir -p "$cache/wasm-pkgs/${image##*:}" && touch "$cache/wasm-pkgs/${image##*:}"
  part "vitest (related)" env KAILO_CHANGED_FILES=/src/.git/kailo-dev-changed WASM_PKG_CACHE_DIR="$wasm_cache" \
    VITEST_MODULE_CACHE_DIR=/cache/target/vitest-modules bash kailo/ci/steps.sh web-test
fi

# -- tests: the CI test step itself (the branch's steps.sh test and test-sandbox) -----------------------------------
# The CI's run_in (check.sh) environment and mounts, with this slot's checkout and a test target directory of its own
# (<slot>/test-target, mounted where steps.sh puts the CI's slot 1: /cache/target/slot1/test, so the shared sccache
# serves the CI's compilations). CARGO_BUILD_JOBS = dev_check.test_jobs is also nextest's --test-threads (steps.sh).
test_target=$sdir/test-target
test_run() {  # test_run <container name> <network> <env file...> -- <command...>
  local name=$1 network=$2 envs=(); shift 2
  while [ "$1" != -- ]; do envs+=(--env-file "$1"); shift; done; shift
  docker run --rm --init --name "$name" --pull=never ${cgroup_parent:+--cgroup-parent "$cgroup_parent"} \
    --cpus "$cpus" --memory "$test_memory" --memory-swap "$test_memory" --user "$(id -u):$(id -g)" --network "$network" \
    -v "$src:/src" -w /src -v "$mirror:$mirror:ro" -v "$cache:/cache" -v "$test_target:/cache/target" "${nm_mounts[@]}" \
    -v "$root/ids/passwd:/etc/passwd:ro" -v "$root/ids/group:/etc/group:ro" --tmpfs /deno-scratch:rw,size=2g,mode=1777 \
    -v "$cache/cargo-registry:/usr/local/cargo/registry" -v "$cache/cargo-git:/usr/local/cargo/git" \
    "${envs[@]}" "$image" "$@" 9>&- 7>&- 6>&- 5>&-
}
up_wait() {  # up_wait <what> <seconds> <command...>
  local what=$1 n=$2; shift 2
  for _ in $(seq "$n"); do "$@" >/dev/null 2>&1 && return 0; sleep 1; done
  echo "$what did not start"; return 1
}
# check.sh's always-on test services (redis_up, bao_up, spicedb_up), with the images the branch's check.sh pins. The
# test container joins redis' network namespace (127.0.0.1:6379), as in the CI. A service that does not come up is
# left out of KAILO_TEST_SERVICES (its tests skip) and said so; redis is required (its tests have no skip).
tests_up() {  # writes the services' variables to $1
  local out=$1 bao_image spicedb_image token key list=()
  test_down
  : > "$out"
  docker image inspect redis:7 >/dev/null 2>&1 || docker pull -q redis:7 >/dev/null || return 1
  docker run -d --rm --name "$tsvc-redis" ${cgroup_parent:+--cgroup-parent "$cgroup_parent"} --network "$net" --cpus 1 \
    --memory 1g --tmpfs /data:rw,size=256m,mode=1777 redis:7 >/dev/null || return 1
  up_wait redis 30 docker exec "$tsvc-redis" redis-cli ping || return 1
  bao_image=$(sed -n 's/^ *local bao=[^ ]* image=\([^ ]*\).*/\1/p' "$src/kailo/ci/check.sh" | head -1)
  token=$(head -c 18 /dev/urandom | base64 | tr -d '/+=')
  if [ -n "$bao_image" ] && { docker image inspect "$bao_image" >/dev/null 2>&1 || docker pull -q "$bao_image" >/dev/null; } &&
     docker run -d --rm --name "$tsvc-openbao" ${cgroup_parent:+--cgroup-parent "$cgroup_parent"} --network "$net" \
       --cpus 1 --memory 512m -e BAO_DEV_ROOT_TOKEN_ID="$token" -e BAO_DEV_LISTEN_ADDRESS=0.0.0.0:8200 \
       "$bao_image" server -dev >/dev/null &&
     up_wait OpenBao 30 docker exec -e BAO_ADDR=http://127.0.0.1:8200 -e BAO_TOKEN="$token" "$tsvc-openbao" bao status &&
     docker exec -e BAO_ADDR=http://127.0.0.1:8200 -e BAO_TOKEN="$token" "$tsvc-openbao" sh -c \
       'bao secrets enable transit >/dev/null && bao write -f transit/keys/kailo-test derived=true >/dev/null'; then
    printf 'BAO_ADDR=http://%s:8200\nBAO_TOKEN=%s\n' "$tsvc-openbao" "$token" >> "$out"; list+=(openbao)
  else echo "OpenBao (image '${bao_image:-not found in kailo/ci/check.sh}') not started: its tests skip here"; fi
  spicedb_image=$(sed -n 's/^spicedb_image=\([^ ]*\)$/\1/p' "$src/kailo/ci/check.sh" | head -1)
  key=$(head -c 24 /dev/urandom | base64 | tr -d '/+=')
  if [ -n "$spicedb_image" ] && { docker image inspect "$spicedb_image" >/dev/null 2>&1 ||
       docker pull -q "$spicedb_image" >/dev/null; } &&
     docker run -d --rm --name "$tsvc-spicedb" ${cgroup_parent:+--cgroup-parent "$cgroup_parent"} --network "$net" \
       --cpus 1 --memory 512m -e SPICEDB_GRPC_PRESHARED_KEY="$key" -e SPICEDB_DATASTORE_ENGINE=memory \
       -e SPICEDB_HTTP_ENABLED=true -e SPICEDB_SKIP_RELEASE_CHECK=true -e SPICEDB_TELEMETRY_ENDPOINT= \
       "$spicedb_image" serve >/dev/null &&
     up_wait SpiceDB 60 docker exec "$tsvc-spicedb" grpc_health_probe -addr=localhost:50051; then
    printf 'SPICEDB_HTTP_URL=http://%s:8443\nSPICEDB_PRESHARED_KEY=%s\n' "$tsvc-spicedb" "$key" >> "$out"; list+=(spicedb)
  else echo "SpiceDB (image '${spicedb_image:-not found in kailo/ci/check.sh}') not started: its tests skip here"; fi
  local IFS=,
  printf 'KAILO_TEST_SERVICES=%s\n' "${list[*]}" >> "$out"
  echo "test services: redis${list[*]:+,${list[*]}} (KAILO_TEST_SERVICES=${list[*]}); not started, so their tests skip as in" \
    "a CI run that does not start them: Keycloak (CI: authentication_service selected), OpenMeter (kailo_metering," \
    "ai_usage, kailo_governance), microsandbox (agent_harness)"
}
# The shared PostgreSQL, used by one test part at a time (test-part.lock): a fresh database `dctest` from template1, which
# carries the migrations of the last tree a test part used (reset when the tree differs; steps.sh test then migrates
# the database and template1 exactly as in the CI, a no-op when they are current). The compile databases come from
# template0 and are not touched.
drop_test_dbs() {
  local d
  for d in $(pgq -c "select datname from pg_database where datname = 'dctest' or left(datname, 11) = '_sqlx_test_'"); do
    pgq -c "drop database if exists \"$d\" with (force)" || return 1
  done
}
tests_db() {
  drop_test_dbs || return 1
  if [ "$(cat "$root/template1.tree" 2>/dev/null)" != "$mig_tree" ]; then
    echo "template1: reset for migrations ${mig_tree:0:12} (steps.sh test migrates it)"
    pgq -c "update pg_database set datistemplate = false where datname = 'template1'" \
      -c "drop database if exists template1 with (force)" \
      -c "create database template1 template template0 is_template true" || return 1
  fi
  rm -f "$root/template1.tree"
  pgq -c "create database dctest template template1"
}
tests_db_done() {
  [ "$(pgq -d template1 -c "select count(*) from _sqlx_migrations where not success" 2>/dev/null)" != 0 ] ||
    echo "$mig_tree" > "$root/template1.tree"
  drop_test_dbs || true
}
if $run_tests && [ ${#test_pkgs[@]} -gt 0 ]; then
  printf '\n===== %s =====\n' "nextest"
  t0=$(date +%s); rc=0
  if $skip_tests; then
    echo "affected.sh: skip_tests (only .sqlx or clippy.toml changed): the CI's test step runs no Rust tests either"
    record "nextest" skipped "$t0"
  elif [ "$check_tests_rc" -ne 0 ]; then
    echo "check --tests failed: the tests do not compile (see above); not running them"
    record "nextest" skipped "$t0"
  else
    # As the CI's test phase: under the node's heavy lock, then a memory preflight for what this part adds.
    heavy_run || rc=$?
    # The test part's containers ($tsvc-*), the shared database `dctest`, the `_sqlx_test_` databases and template1
    # are node-wide: with the heavy lock shared, the slots' test parts still take turns on their own lock.
    exec 6>>"$root/test-part.lock"
    [ $rc -ne 0 ] || hold 6 "$root/test-part.lock" "kailo-dev-check $ref (test part)" || rc=$?
    [ $rc -ne 0 ] || python3 -I "$here/envguard.py" --config "$CONFIG" preflight --repo kailo-macro --stage dev-check \
      --memory "$test_need" --wait "$max_wait" || rc=$?
    if [ $rc -eq 0 ]; then
      testing=true
      mkdir -p "$test_target"
      used=$(du -sx -BG "$test_target" 2>/dev/null | cut -f1 | tr -dc 0-9) || used=0
      if [ "${used:-0}" -gt "$test_cap_gb" ]; then
        echo "test target uses ${used}G > ${test_cap_gb}G; clearing it (this build is cold, sccache serves it)"
        find "$test_target" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
      fi
      old_umask=$(umask); umask 077
      { echo HOME=/cache/home; echo BUN_INSTALL_CACHE_DIR=/cache/bun; echo RUSTUP_TOOLCHAIN=1.94.0; echo SQLX_OFFLINE=true
        echo CARGO_NET_GIT_FETCH_WITH_CLI=true; echo CARGO_BUILD_JOBS="$test_jobs"; echo CARGO_TERM_COLOR=never
        echo CARGO_INCREMENTAL=0; echo RUSTC_WRAPPER=sccache; echo SCCACHE_DIR=/cache/sccache
        echo SCCACHE_CACHE_SIZE="$sccache_size"; echo KAILO_AFFECTED=/src/.git/kailo-dev-affected
        echo KAILO_BASE_FILE=/src/.git/kailo-dev-base; echo KAILO_SLOT=1; echo DATABASE_URL="$pg_url/dctest"
      } > "$sdir/test.env"
      umask "$old_umask"
      rm -f "$src/.git/kailo-test-sandbox"
      if ! { tests_up "$sdir/test-services.env" && tests_db; }; then
        echo "the test services or the test database did not come up (above)"; rc=1
      else
        test_run "$tsvc-run" "container:$tsvc-redis" "$sdir/test.env" "$sdir/test-services.env" -- \
          bash kailo/ci/steps.sh test || rc=$?
      fi
      tests_db_done
      test_down
      record "nextest" "$rc" "$t0"
      if [ -f "$src/.git/kailo-test-sandbox" ]; then   # steps.sh test selected code_execution: no network, as in the CI
        printf '\n===== %s =====\n' "nextest sandbox"
        t0=$(date +%s); rc=0
        test_run "$tsvc-sandbox" none "$sdir/test.env" -- bash kailo/ci/steps.sh test-sandbox || rc=$?
        record "nextest sandbox" "$rc" "$t0"
      fi
      rm -f "$sdir/test.env" "$sdir/test-services.env"
      testing=false
    else
      record "nextest" "$rc" "$t0"
    fi
    exec 6>&-
  fi
fi

[ ${#results[@]} -gt 0 ] || { say "nothing selected"; exit 0; }
printf '\n===== kailo-dev-check %s @ %s =====\n' "$ref_name" "${commit:0:12}"
printf '%s\n' "${results[@]}"
if [ $failed -ne 0 ]; then echo "errors above"; exit 1; fi
if [ $no_room -ne 0 ]; then echo "the node had no room for a part in time (no-room); rerun later"; exit 75; fi
echo "clean (the parts above, with the CI's commands and flags)"
exit 0
