#!/usr/bin/env bash
# kailo-dev-check: fast Rust compile feedback for authors on the CI node (OPS-05; CI-CD 手册「kailo-dev-check」).
#
#   dev-check.sh <branch|sha> [crate ...|--affected]      (dev box: kailo-dev-check <branch> [crate ...|--affected])
#
# For a pushed kailo-macro branch: cargo fmt --check, `cargo check --tests` and `cargo clippy` of the given crates (or of
# the packages the branch's change set reaches, computed by the branch's kailo/ci/affected.sh like the CI does), with the
# CI's flags (kailo/ci/steps.sh: test and lint), then exits: 0 clean, 1 errors, 2 usage, 75 the node had no room in time
# (EX_TEMPFAIL), 78 configuration. Errors print as cargo prints them.
#
# It is NOT the CI: no job, no queue, no verify record; the unified CI stays with the main agent. Warm instead of fresh:
#   - one persistent checkout (only the files a branch switch changes get new mtimes, so cargo rechecks only them)
#     and one persistent container `kailo-dev-check` (the branch's check image, recreated when that image or the
#     node_modules snapshot changes), incremental target directories on the CI cache filesystem (ci-fs), the shared
#     sccache, cargo registry and node_modules snapshots of the CI;
#   - test code is checked against a live PostgreSQL (`kailo-dev-check-pg`, tmpfs) migrated with the branch's
#     migrations, one database per migrations tree (SQLX_OFFLINE=false, like the CI test step); clippy runs offline on
#     the branch's .sqlx, like the CI lint step.
# One run at a time (dev lock); the compile runs under the node's heavy lock (locks.heavy, shared with image builds and
# the CI test phase), so it never competes with a verify's test phase or an image build; before it the resource
# preflight of the CI (envguard.py) runs. Settings: config.json `dev_check` (defaults below).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
CONFIG=${KAILO_CI_CONFIG:-/volumes/kailo/ci/config.json}
export DOCKER_HOST=unix:///run/kailo-docker/docker.sock
usage() { sed -n '4,5p' "$0" >&2; exit 2; }
say() { printf 'kailo-dev-check: %s\n' "$*" >&2; }
[ $# -ge 1 ] || usage
ref=$1; shift
crates=(); affected=false
for a in "$@"; do
  case "$a" in
    --affected) affected=true ;;
    -*) usage ;;
    *) [[ "$a" =~ ^[A-Za-z0-9_-]+$ ]] || { say "invalid crate name: $a"; exit 2; }; crates+=("$a") ;;
  esac
done
[ ${#crates[@]} -gt 0 ] || affected=true
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
    pg_memory=dc.get("postgres_memory", "1536m"), pg_tmpfs=dc.get("postgres_tmpfs", "1g"),
    keep_dbs=str(dc.get("keep_databases", 6)), max_wait=str(dc.get("max_wait", 7200)),
    heavy_lock=(cfg.get("locks") or {}).get("heavy", "/var/lib/kailo-ci/locks/image-build.lock"),
)
for k, v in out.items():
    print(f"{k}={shlex.quote(str(v))}")
PY
)"
src=$root/src
target=$root/target
container=kailo-dev-check
pg=kailo-dev-check-pg
net=kailo-dev-check
mkdir -p "$root" "$target" "$root/ids" "$root/dbs" "$(dirname "$heavy_lock")"

# -- locks -------------------------------------------------------------------------------------------------------
# The holder file next to a lock says who has it (informational: the lock itself is the flock).
hold() {  # hold <fd> <lock file> <what>: take the lock, waiting up to max_wait seconds and saying for whom
  local fd=$1 lock=$2 what=$3 waited=0 holder
  if ! flock -n "$fd"; then
    holder=$(cat "$lock.holder" 2>/dev/null || echo unknown)
    say "waiting for $(basename "$lock") (held by: $holder)"
    until flock -w 60 "$fd"; do
      waited=$((waited + 60))
      [ "$waited" -lt "$max_wait" ] || { say "gave up after ${max_wait}s waiting for $(basename "$lock")"; exit 75; }
      say "still waiting for $(basename "$lock") (${waited}s; held by: $(cat "$lock.holder" 2>/dev/null || echo unknown))"
    done
  fi
  printf '%s pid=%s since=%s\n' "$what" "$$" "$(date -u +%FT%TZ)" > "$lock.holder" 2>/dev/null || true
}
exec 7>>"$root/dev-check.lock"
hold 7 "$root/dev-check.lock" "kailo-dev-check $ref"

# Interrupted (the dev box's ssh went away, Ctrl-C): stop what runs in the container, so the next run does not wait
# for an orphaned cargo holding the build directory lock.
running=false
interrupted() { $running && docker restart -t 1 "$container" >/dev/null 2>&1 || true; exit 130; }
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
say "$ref @ ${commit:0:12}"

# -- image, node_modules snapshot, container ---------------------------------------------------------------------
image="local/kailo-macro-check:$(sha256sum "$src/kailo/ci/check.Dockerfile" | cut -c1-16)"
exec 9>>"$heavy_lock"
heavy_held=false
heavy() { $heavy_held || { hold 9 "$heavy_lock" "kailo-dev-check $ref"; heavy_held=true; }; }
if ! docker image inspect "$image" >/dev/null 2>&1; then
  heavy   # an image build: same lock as every other image build on the node
  say "building the check image $image"
  DOCKER_CONFIG=${docker_config:-$HOME/.docker} BUILDX_BUILDER=$buildx_builder \
    docker buildx build --load --progress=plain -f "$src/kailo/ci/check.Dockerfile" -t "$image" "$src/kailo/ci" >&2
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
printf 'root:x:0:0:root:/root:/bin/sh\nkailo:x:%s:%s:kailo:/cache/home:/bin/sh\n' "$(id -u)" "$(id -g)" > "$root/ids/passwd"
printf 'root:x:0:\nkailo:x:%s:\n' "$(id -g)" > "$root/ids/group"

docker network inspect "$net" >/dev/null 2>&1 || docker network create "$net" >/dev/null
want="$image $nm_key $(stat -c %i "$snap") $cpus $memory"
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
    -e HOME=/cache/home -e RUSTUP_TOOLCHAIN=1.94.0 -e CARGO_NET_GIT_FETCH_WITH_CLI=true -e CARGO_TERM_COLOR=never \
    -e CARGO_BUILD_JOBS="${cpus%.*}" -e RUSTC_WRAPPER=sccache -e SCCACHE_DIR=/cache/sccache \
    -e SCCACHE_CACHE_SIZE="$sccache_size" "$image" sleep infinity >/dev/null
fi
x() { docker exec "$container" "$@" 9>&- 7>&-; }

# -- live database for test code (one per migrations tree) ---------------------------------------------------------
[ -s "$root/pg.secret" ] || { umask 077; head -c 24 /dev/urandom | base64 | tr -d '/+=' > "$root/pg.secret"; }
if [ "$(docker inspect -f '{{.State.Running}}' "$pg" 2>/dev/null)" != true ]; then
  docker rm -f "$pg" >/dev/null 2>&1 || true
  docker image inspect "$pg_image" >/dev/null 2>&1 || docker pull -q "$pg_image" >/dev/null
  docker run -d --name "$pg" --restart unless-stopped --network "$net" ${cgroup_parent:+--cgroup-parent "$cgroup_parent"} \
    --cpus 2 --memory "$pg_memory" --tmpfs "$pg_data:size=$pg_tmpfs" -e POSTGRES_PASSWORD="$(cat "$root/pg.secret")" \
    "$pg_image" -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_wal_size=256MB >/dev/null
  for _ in $(seq 60); do docker exec "$pg" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
fi
mig_tree=$(git -C "$src" rev-parse HEAD:crates/macro_db_client/migrations)
db=dc_${mig_tree:0:16}
db_url="postgres://postgres:$(cat "$root/pg.secret")@$pg:5432/$db"
if [ "$(docker exec "$pg" psql -U postgres -Atc "select 1 from pg_database where datname='$db'")" != 1 ]; then
  say "migrating a database for migrations ${mig_tree:0:12}"
  x env DATABASE_URL="$db_url" sh -c 'sqlx database create && sqlx migrate run --source crates/macro_db_client/migrations' \
    >/dev/null || { say "migrations of ${commit:0:12} do not apply"; exit 1; }
fi
touch "$root/dbs/$db"
ls -1t "$root/dbs" | tail -n +$((keep_dbs + 1)) | while read -r old; do
  docker exec "$pg" dropdb -U postgres --if-exists "$old" >/dev/null 2>&1 || true; rm -f "$root/dbs/$old"
done

# -- target cap, preflight, heavy lock (the affected-package filter may compile too) ------------------------------
used=$(du -sx -BG "$target" 2>/dev/null | cut -f1 | tr -dc 0-9)
if [ "${used:-0}" -gt "$cap_gb" ]; then
  say "target directories use ${used}G > ${cap_gb}G; clearing them (next run is cold)"
  find "$target" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
fi
python3 -I "$here/envguard.py" --config "$CONFIG" preflight --repo kailo-macro --stage dev-check --memory "$memory" \
  --wait "$max_wait" || exit $?
heavy

# -- selection --------------------------------------------------------------------------------------------------
if $affected; then
  if git -C "$src" merge-base --is-ancestor "$commit" refs/remotes/origin/main; then
    base=$(git -C "$src" rev-parse -q --verify "$commit^1" || true)
  else
    base=$(git -C "$src" merge-base "$commit" refs/remotes/origin/main || true)
  fi
  : > "$src/.git/kailo-dev-changed"   # empty (no base): affected.sh selects everything
  [ -z "$base" ] || git -C "$src" diff --name-only --no-renames "$base" "$commit" > "$src/.git/kailo-dev-changed"
  if ! sel=$(x env KAILO_CHANGED_FILES=/src/.git/kailo-dev-changed KAILO_BASE="${base:-HEAD}" KAILO_BIN_CACHE=/cache/bin \
      bash kailo/ci/affected.sh | sed -n 1p) || [ -z "$sel" ]; then
    say "the affected-package selection (kailo/ci/affected.sh) failed, see above: the CI's lint and test fail the same way"
    exit 1
  fi
  say "affected since ${base:0:12}: $sel"
  [ "$sel" != none ] || { say "no Rust package affected; nothing to check"; exit 0; }
  [ "$sel" = all ] && say "the change set reaches every package (toolchain, .cargo or no base): checking the workspace"
  [ "$sel" = all ] || read -r -a crates <<<"$sel"
fi
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
results=(); failed=0
part() {  # part <name> <command...>
  local name=$1 t0 rc=0; shift
  printf '\n===== %s =====\n' "$name"
  t0=$(date +%s); running=true
  x "$@" || rc=$?
  running=false
  results+=("$(printf '%-16s %-8s %5ss' "$name" "$([ $rc -eq 0 ] && echo ok || echo FAIL)" $(( $(date +%s) - t0 )))")
  [ $rc -eq 0 ] || failed=1
}
fmt_pkgs=("${pkgs[@]}"); $sync && [ "${sel:-}" != all ] && fmt_pkgs+=(-p sync_service)
[ "${sel:-}" = all ] && fmt_pkgs=(--all)
part "fmt" cargo fmt --check "${fmt_pkgs[@]}"
if [ ${#test_pkgs[@]} -gt 0 ]; then
  # steps.sh test: live database; `check` instead of nextest's build (no codegen, no run)
  # (the lint RUSTFLAGS: plain rustc ignores the clippy tool lint, so the diagnostics are the test step's, and both
  # parts share one target directory: the dependencies are compiled once for both)
  part "check --tests" env CARGO_TARGET_DIR=/cache/target/dev CARGO_PROFILE_DEV_INCREMENTAL=true \
    CARGO_PROFILE_TEST_INCREMENTAL=true SQLX_OFFLINE=false DATABASE_URL="$db_url" RUSTFLAGS="$lint_flags" \
    cargo check --locked --all-features --tests "${test_pkgs[@]}"
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
printf '\n===== kailo-dev-check %s @ %s =====\n' "$ref" "${commit:0:12}"
printf '%s\n' "${results[@]}"
[ $failed -eq 0 ] && echo "clean (fmt, test code against the live schema, clippy as the CI lint)" || echo "errors above"
exit $failed
