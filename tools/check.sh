#!/usr/bin/env bash
# 统一检查入口（ADR-07）。本地与 CI 调用同一命令、同一步骤集。
# 十个门禁子步骤对应 03-验证发布与验收门禁.md §5 的十项合并门禁；另有 status 一步只提示上游变化（ADR-16），不计入门禁。
# 无适用对象的步骤输出 SKIP 并通过——它在首次出现适用对象时自动生效，不被注释掉。
#
# 用法：
#   tools/check.sh              # 全部步骤
#   tools/check.sh --full       # 全部步骤
#   tools/check.sh <step>       # 单步，step 见下方 STEPS
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

# 步骤编号对应 03 §5，执行顺序按依赖：迁移演练先于验证——演练结束时演练库处于最新
# 迁移，第 2 步中读取 DATABASE_URL 的测试依赖这一状态；单独运行 verify 时须自备已迁移的库。
STEPS=(status lint contract migrate verify replay trace supply seam security docs)
FAIL=0

hdr()  { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
pass() { printf '  \033[32mPASS\033[0m %s\n' "$*"; }
skip() { printf '  \033[90mSKIP\033[0m %s\n' "$*"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$*"; FAIL=1; }

have() { command -v "$1" >/dev/null 2>&1; }
# 目录存在且含至少一个非隐藏条目
populated() { [ -d "$1" ] && [ -n "$(ls -A "$1" 2>/dev/null | grep -v '^\.')" ]; }

# Host invocation is only a launcher. No project toolchain is run on the host.
run_in_check_container() (
  set -euo pipefail
  source tools/container-safety.sh
  container_safety_init
  container_resource_preflight
  : "${CHECK_CPUS:?执行配置必须提供 CHECK_CPUS}"
  : "${CHECK_MEMORY:?执行配置必须提供 CHECK_MEMORY}"
  : "${CHECK_NETWORK:?执行配置必须提供 CHECK_NETWORK}"
  : "${CHECK_CACHE_ROOT:?执行配置必须提供 CHECK_CACHE_ROOT}"
  mkdir -p -- "$CHECK_CACHE_ROOT"
  cache=$(container_require_data_path "$CHECK_CACHE_ROOT")
  workspace=$(mktemp -d)
  container_id=
  trap 'if [ -n "$container_id" ]; then "${CONTAINER_DOCKER[@]}" rm -f "$container_id" >/dev/null 2>&1 || true; fi; rm -r -- "$workspace"' EXIT
  mkdir -p "$workspace/apps" "$workspace/.design" "$workspace/image" "$workspace/tmp"

  # Export actual source, never ignored credentials/data, caches or session files.
  # An explicit ref checks the tree being published, not unrelated dirty work.
  if [ -n "${CHECK_SOURCE_REF:-}" ]; then
    tree=$(git rev-parse --verify "${CHECK_SOURCE_REF}^{tree}")
    git archive "$tree" | tar -xf - -C "$workspace/apps"
    design_commit=$(python3 - "$workspace/apps/.github/workflows/check.yml" <<'PY'
import re, sys, yaml
with open(sys.argv[1], encoding="utf-8") as source:
    pin = yaml.safe_load(source)["jobs"]["check"]["env"]["DESIGN_COMMIT"]
if not isinstance(pin, str) or not re.fullmatch(r"[0-9a-f]{40}", pin):
    sys.exit("拒绝检查：发布树的 DESIGN_COMMIT 不是完整 commit")
print(pin)
PY
    )
    git archive "${design_commit}:.design" | tar -xf - -C "$workspace/.design"
    design="$workspace/.design"
  else
    git ls-files -z --cached --others --exclude-standard | \
      while IFS= read -r -d '' path; do
        if [ -e "$path" ] || [ -L "$path" ]; then printf '%s\0' "$path"; fi
      done | tar --null --verbatim-files-from -T - -cf - | tar -xf - -C "$workspace/apps"
    design=$(realpath -e -- "${DESIGN:-${2:-../.design}}")
  fi
  [ -f "$workspace/apps/tools/check.Dockerfile" ] || {
    echo '拒绝检查：实际源码树没有检查镜像定义' >&2; exit 2;
  }
  recipe="$workspace/apps/tools/check.Dockerfile"
  recipe_digest=$(sha256sum "$recipe" | cut -d' ' -f1)
  image_tag="local/kailo-check:$recipe_digest"
  image=$("${CONTAINER_DOCKER[@]}" image inspect --format '{{.Id}}' "$image_tag" 2>/dev/null || true)
  if [ -z "$image" ]; then
    container_require_limited_builder
    tar -C "$workspace/apps/tools" -cf - check.Dockerfile | tar -xf - -C "$workspace/image"
    build_log=$(mktemp --suffix=.check-image.log)
    "${CONTAINER_DOCKER[@]}" buildx build --builder "$BUILDX_BUILDER" --load \
      --progress=plain -f "$workspace/image/check.Dockerfile" -t "$image_tag" "$workspace/image" \
      2>&1 | tee "$build_log"
    image=$("${CONTAINER_DOCKER[@]}" image inspect --format '{{.Id}}' "$image_tag")
  fi
  printf '检查镜像（不可变 image ID）：%s；配方 SHA-256：%s\n' "$image" "$recipe_digest"
  mkdir -p "$cache/home" "$cache/cargo-registry" "$cache/cargo-git"
  mounts=(
    --mount "type=bind,src=$workspace/apps,dst=/workspace/apps"
    --mount "type=bind,src=$(git rev-parse --absolute-git-dir),dst=/workspace/apps/.git,readonly"
    --mount "type=bind,src=$design,dst=/workspace/.design,readonly"
    --mount "type=bind,src=$cache,dst=/cache"
    --mount "type=bind,src=$workspace/tmp,dst=/tmp"
    --mount "type=bind,src=$cache/cargo-registry,dst=/usr/local/cargo/registry"
    --mount "type=bind,src=$cache/cargo-git,dst=/usr/local/cargo/git"
  )
  for optional in .references dist; do
    if [ "$optional" = .references ]; then location=../.references; destination=/workspace/.references
    else location=dist; destination=/workspace/apps/dist; fi
    if [ -d "$location" ]; then
      mounts+=(--mount "type=bind,src=$(realpath -e -- "$location"),dst=$destination,readonly")
    fi
  done
  # sudo 会清理宿主环境；名称式 --env 不能证明 DATABASE_URL 已投递。
  # 值只走 Docker stdin，不进 argv、日志或临时文件。
  for name in DATABASE_URL CARGO_BUILD_JOBS; do
    if [[ -v "$name" && ( "${!name}" == *$'\n'* || "${!name}" == *$'\r'* ) ]]; then
      echo "拒绝检查：$name 不能包含换行" >&2; exit 2
    fi
  done
  container_id=$({
    for name in DATABASE_URL CARGO_BUILD_JOBS; do
      if [[ -v "$name" ]]; then printf '%s=%s\n' "$name" "${!name}"; fi
    done
  } | "${CONTAINER_DOCKER[@]}" create --pull=never \
    --cpus "$CHECK_CPUS" --memory "$CHECK_MEMORY" --memory-swap "$CHECK_MEMORY" \
    --user "$(id -u):$(id -g)" --network "$CHECK_NETWORK" \
    "${mounts[@]}" --workdir /workspace/apps \
    --env HOME=/cache/home --env TMPDIR=/tmp --env XDG_CACHE_HOME=/cache/xdg \
    --env CARGO_TARGET_DIR=/cache/rust-target --env GOCACHE=/cache/go-build \
    --env GOMODCACHE=/cache/go-mod --env PUB_CACHE=/cache/pub \
    --env npm_config_cache=/cache/npm --env DESIGN=/workspace/.design \
    --env-file /dev/stdin \
    "$image" bash tools/check.sh "$@")
  container_verify_limits "$container_id"
  log=$(mktemp --suffix=.check.log)
  printf '本次检查日志：%s\n' "$log"
  "${CONTAINER_DOCKER[@]}" start -a "$container_id" 2>&1 | tee "$log"
  exit "$("${CONTAINER_DOCKER[@]}" wait "$container_id")"
)

prepare_check_dependencies() {
  for tool in cargo rustfmt go node npm npx dart python3 git; do
    have "$tool" || { echo "拒绝检查：镜像缺少工具链 $tool" >&2; return 2; }
  done
  cargo --version; go version; node --version; dart --version
  local manager tooling
  manager=$(node -p 'require("./package.json").packageManager') || return 2
  [[ "$manager" =~ ^pnpm@[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
    echo '拒绝检查：package.json 的 packageManager 不是固定 pnpm 版本' >&2; return 2;
  }
  tooling="$HOME/tooling/$manager"
  if [ ! -x "$tooling/node_modules/.bin/pnpm" ]; then
    npm install --prefix "$tooling" --no-audit --no-fund "$manager" || return 2
  fi
  export PATH="$tooling/node_modules/.bin:$PATH"
  pnpm install --frozen-lockfile || return 2
  (cd client-kit/dart && dart pub get) || return 2
}

step_lint() {
  hdr "1/10 格式与静态检查"
  local ran=0
  if populated core && have cargo; then
    ran=1
    cargo fmt --manifest-path core/Cargo.toml --all --check >/dev/null 2>&1 \
      && pass "cargo fmt" || fail "cargo fmt"
    # 编译一律用入库的 sqlx 离线数据，与镜像构建（core/Dockerfile）同一输入；离线数据与
    # 查询是否同步由第 4 步在演练库迁移到最新之后核对，不在空库上在线编译。
    SQLX_OFFLINE=true cargo clippy --manifest-path core/Cargo.toml --all-targets -- -D warnings \
      && pass "cargo clippy" || fail "cargo clippy"
  fi
  if populated worker && have go; then
    ran=1
    (cd worker && gofmt -l . | grep -q . ) && fail "gofmt 有未格式化文件" || pass "gofmt"
    (cd worker && go vet ./... >/dev/null 2>&1) && pass "go vet" || fail "go vet"
  fi
  if populated client-kit/ts && have pnpm; then
    ran=1
    pnpm -r typecheck >/dev/null 2>&1 && pass "tsc --noEmit" || fail "tsc --noEmit"
  fi
  if populated client-kit/dart/lib; then
    if have dart; then
      ran=1
      (cd client-kit/dart && dart analyze >/dev/null 2>&1) && pass "dart analyze" || fail "dart analyze"
    else
      fail "client-kit/dart 有 Dart 源码但本机无 dart 工具链，该侧无法校验"
    fi
  fi
  [ "$ran" -eq 0 ] && skip "尚无源码"
  return 0
}

step_verify()   { hdr "2/10 受影响范围的验证"
  local ran=0
  if populated core && have cargo; then ran=1
    SQLX_OFFLINE=true cargo test --manifest-path core/Cargo.toml && pass "cargo test" || fail "cargo test"; fi
  if populated worker && have go; then ran=1
    (cd worker && go test ./... >/dev/null 2>&1) && pass "go test" || fail "go test"; fi
  if populated client-kit/ts && have pnpm; then ran=1
    pnpm -r test && pass "pnpm -r test（TypeScript）" || fail "pnpm -r test（TypeScript）"; fi
  if populated client-kit/dart/test && have dart; then ran=1
    (cd client-kit/dart && dart test >/dev/null 2>&1) && pass "dart test" || fail "dart test"; fi
  [ "$ran" -eq 0 ] && skip "尚无可验证范围"
  return 0
}

step_contract() { hdr "3/10 contract compatibility"
  if ! populated contracts/enums && ! populated contracts/domain; then
    skip "contracts/ 尚无 schema"; return 0; fi
  if [ ! -f contracts/canary.schema.json ]; then
    fail "contracts/ 有 schema 但缺 canary.schema.json（见 contracts/README.md §1）"; return 0; fi
  if [ ! -f contracts/samples/canary.sample.json ]; then
    fail "缺 contracts/samples/canary.sample.json，四侧 round-trip 无样例可跑"; return 0; fi
  if bash tools/gen.sh --check >/tmp/gen.$$ 2>&1; then
    pass "四侧生成物与 contracts/ 同步（round-trip 由第 2 步的四侧测试承担）"
  else
    fail "生成物与 contracts/ 不同步，运行 tools/gen.sh 后提交"; sed 's/^/    /' /tmp/gen.$$
  fi
  rm -f /tmp/gen.$$

  # 06 §5 的兼容比对。「上一个已发布版本」以 git tag contracts-v* 表示，
  # 不另存快照——git 已经是历史权威，再存一份就是第二权威。
  local last
  last=$(git tag -l 'contracts-v*' --sort=-v:refname | head -1)
  if [ -z "$last" ]; then
    skip "尚无 contracts-v* 发布 tag，无基线可比对"
    return 0
  fi
  LAST_TAG="$last" python3 - <<'PY' || FAIL=1
import json, os, subprocess, sys
tag = os.environ["LAST_TAG"]
def at(rev, path):
    r = subprocess.run(["git", "show", f"{rev}:{path}"],
                       capture_output=True, text=True, check=True)
    return json.loads(r.stdout)

# 历史 tag 保留当时的树形；目录迁移不得把读不到旧路径当成新增 schema。
roots = subprocess.run(["git", "ls-tree", "-d", "--name-only", tag, "--",
                        "contracts", "apps/contracts"],
                       capture_output=True, text=True, check=True).stdout.splitlines()
if len(roots) != 1:
    print(f"  FAIL {tag} 的 contracts 根无法唯一解析：{roots}")
    sys.exit(1)
old_root = roots[0]
old_paths = set(subprocess.run(["git", "ls-tree", "-r", "--name-only", tag, "--", old_root],
                               capture_output=True, text=True, check=True).stdout.splitlines())
files = subprocess.run(["git", "ls-files", "--full-name", "contracts"],
                       capture_output=True, text=True, check=True).stdout.splitlines()
schemas = [f for f in files if f.endswith(".schema.json")]
breaking = []
matched = 0
for f in schemas:
    historical = old_root + f[len("contracts"):]
    if historical not in old_paths:
        continue  # 确认历史树中没有此 schema，才是新增
    try:
        old = at(tag, historical)
        with open(f, encoding="utf-8") as source:
            new = json.load(source)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"  FAIL {tag}:{historical} 与 {f} 无法比对（{type(error).__name__}）")
        sys.exit(1)
    matched += 1
    # 删除字段、把可选改必填、删除枚举值，都是破坏性变更
    for k in (old.get("properties") or {}):
        if k not in (new.get("properties") or {}):
            breaking.append(f"{f}: 删除字段 {k}")
    added_required = set(new.get("required") or []) - set(old.get("required") or [])
    for k in sorted(added_required):
        breaking.append(f"{f}: 字段 {k} 由可选改为必填")
    removed_enum = set(old.get("enum") or []) - set(new.get("enum") or [])
    for v in sorted(removed_enum):
        breaking.append(f"{f}: 删除枚举值 {v}")
if breaking:
    print(f"  \033[31mFAIL\033[0m 相对 {tag} 的破坏性变更，必须新版本号：")
    [print("   ", b) for b in breaking]
    sys.exit(1)
print(f"  \033[32mPASS\033[0m 相对 {tag} 无破坏性变更（{len(schemas)} 个 schema，匹配 {matched} 个历史 schema）")
PY
  return 0
}

step_migrate()  { hdr "4/10 数据迁移前进与回退演练"
  if ! populated core/migrations; then skip "尚无迁移"; return 0; fi
  # 结构规则：每个 up 必须有配对的 down，否则「可回滚」无从谈起
  local miss=0
  for up in core/migrations/*.up.sql; do
    [ -f "${up%.up.sql}.down.sql" ] || { fail "缺少回退脚本：${up%.up.sql}.down.sql"; miss=1; }
  done
  [ "$miss" -eq 0 ] && pass "每个迁移都有配对的回退脚本"
  if [ -z "${DATABASE_URL:-}" ]; then
    skip "未提供 DATABASE_URL，跳过实际演练（本地见 deploy/local/bootstrap.sh）"
    return 0
  fi
  if ! have sqlx; then fail "有 DATABASE_URL 但未安装 sqlx-cli，无法演练"; return 0; fi
  # 演练：前进 → 回退 → 再前进，任一失败即门禁失败
  if sqlx migrate run --source core/migrations >/dev/null 2>&1 \
     && sqlx migrate revert --source core/migrations >/dev/null 2>&1 \
     && sqlx migrate run --source core/migrations >/dev/null 2>&1; then
    pass "前进、回退、再前进三步演练通过"
  else
    fail "迁移演练失败"; return 0
  fi
  # 演练库此刻处于最新迁移：核对入库的 sqlx 离线数据与查询同步。否则编译期 SQL 校验
  # 会在没有库的环境里悄悄用过期快照通过。与 contracts 生成物同一套「入库 + 校验同步」。
  if (cd core && cargo sqlx prepare --check --workspace >/dev/null 2>&1); then
    pass "sqlx 离线数据与迁移后的库和查询同步"
  else
    fail "sqlx 离线数据过期，在 core/ 下对已迁移的演练库运行 cargo sqlx prepare --workspace 后提交"
  fi

  # 枚举漂移：迁移里的 CHECK 取值是时间点快照，contracts/enums/ 是当前权威。
  # 约束显式命名为 <枚举名>_enum，按名字精确对应，不做模糊匹配——
  # 模糊匹配会把取值恰好是子集的不同枚举误判成漂移。
  python3 - <<'PY' || FAIL=1
import glob, json, os, re, subprocess, sys

url = os.environ["DATABASE_URL"]
# 扫全部非系统 schema，不点名 identity：ADR-01 的模块划分会继续加 schema，
# 写死一个名字就让后加的模块悄悄躲开这项检查。
sql = ("select c.conname, pg_get_constraintdef(c.oid) from pg_constraint c "
       "join pg_namespace n on n.oid = c.connamespace "
       "where c.contype = 'c' and n.nspname not in ('pg_catalog', 'information_schema') "
       "and n.nspname not like 'pg\\_%'")
out = subprocess.run(["psql", url, "-tAF", "\t", "-c", sql], capture_output=True, text=True)
if out.returncode != 0:
    print(f"  \033[31mFAIL\033[0m 无法读取约束：{out.stderr.strip()[:120]}"); sys.exit(1)

in_db = {}
for line in out.stdout.strip().split("\n"):
    if "\t" not in line:
        continue
    name, definition = line.split("\t", 1)
    if name.endswith("_enum"):
        in_db[name[: -len("_enum")]] = set(re.findall(r"'([A-Z_]+)'::text", definition))

bad, checked = [], 0
for enum_name, dbvals in sorted(in_db.items()):
    f = f"contracts/enums/{enum_name}.schema.json"
    if not os.path.exists(f):
        bad.append(f"{enum_name}_enum: 约束按命名约定应对应 {f}，但该文件不存在")
        continue
    vals = set(json.load(open(f, encoding="utf-8"))["enum"])
    if dbvals != vals:
        bad.append(f"{enum_name}: 库中 {sorted(dbvals)} 与契约 {sorted(vals)} 不等")
    checked += 1
if bad:
    print("  \033[31mFAIL\033[0m 枚举漂移："); [print("   ", b) for b in bad]; sys.exit(1)
print(f"  \033[32mPASS\033[0m {checked} 个命名约束与 contracts/enums/ 逐值相等")
PY
  return 0
}

step_replay()   { hdr "5/10 Workflow replay"
  if populated worker/replay-tests && have go; then
    (cd worker && go test ./replay-tests/... >/dev/null 2>&1) && pass "replay 回归" || fail "replay 回归"
  else skip "尚无录制 history"; fi
  return 0
}

step_trace()    { hdr "6/10 设计 ID 与验证场景追溯"
  bash tools/check-docs.sh >/tmp/cd.$$ 2>&1 && pass "文档门禁六项（含设计语料）" \
    || { fail "文档门禁未过"; tail -25 /tmp/cd.$$; }
  rm -f /tmp/cd.$$
  DESIGN="${DESIGN:-../.design}" python3 - <<'PY' || FAIL=1
import glob, os, re, sys, yaml
d = os.environ["DESIGN"]
t02 = open(glob.glob(f"{d}/02-*.md")[0], encoding="utf-8").read()
t16 = open(glob.glob(f"{d}/16-*.md")[0], encoding="utf-8").read()
t03 = open(glob.glob(f"{d}/03-*.md")[0], encoding="utf-8").read()
cov = open(glob.glob("05-*.md")[0], encoding="utf-8").read()

known = {
    "requirements": set(re.findall(r"^\| (V-REQ-\d+) \|", t16, re.M)),
    "scenarios":    set(re.findall(r"^\| (V-SCN-\d+) \|", t16, re.M)),
    "decisions":    set(re.findall(r"^\| (DD-\d+) \|", t02, re.M)),
    "facts":        set(re.findall(r"^\| (SF-[A-Z]+-[A-Z0-9-]+) \|", t02, re.M)),
    "seams":        set(re.findall(r"^\| (SS-[A-Z]+-[A-Z0-9-]+) \|", t02, re.M)),
    "blockers":     set(re.findall(r"^\| (GAP-[A-Z]+-\d+) \|", t02, re.M)),
    "entities":     set(re.findall(r"^([A-Z][A-Za-z]+)\(", t03, re.M)),
}
# 覆盖矩阵的归属标签 → 追溯记录的 stage 取值（apps/06 §1、02 §1.0）：Stage N → SN，
# 平台一期收口 → PC，能力扩展 EXT-* → EXT-*，作废 → VOID（记录不得引用作废决策）
def stage_key(label):
    label = label.strip()
    m = re.match(r"Stage (\d)", label)
    if m:
        return "S" + m.group(1)
    if label.startswith("平台一期收口"):
        return "PC"
    m = re.match(r"能力扩展 (EXT-[A-Z]+)", label)
    if m:
        return m.group(1)
    if label.startswith("作废"):
        return "VOID"
    return None
stage_of = {}
for line in cov.split("\n"):
    m = re.match(r"\| ([^|]+)\| `(DD-\d+)`", line)
    if m and stage_key(m.group(1)):
        stage_of[m.group(2)] = stage_key(m.group(1))
valid_stages = {"S0", "S1", "S2", "S3", "S4", "S5", "PC", "EXT-BASE", "EXT-FILE", "EXT-KNOW", "EXT-DATA"}

# 业务能力参考实现的产品名只取自 .design/08 §9.1「内置参考实现」表的 Component 列：
# 契约键、能力 id、动作、工具与契约枚举值都不得含实现产品名（DD-88、apps/06 §1）
t08 = open(glob.glob(f"{d}/08-*.md")[0], encoding="utf-8").read()
ref_table = t08.split("内置参考实现（", 1)[1].split("\n\n", 2)[1] if "内置参考实现（" in t08 else ""
product_tokens = set()
for row in ref_table.split("\n")[2:]:
    cells = row.split("|")
    if len(cells) > 2:
        product_tokens |= {w.lower() for w in re.findall(r"[A-Za-z][A-Za-z0-9]{2,}", cells[1])}
def product_hits(value):
    parts = set(re.split(r"[^a-z0-9]+", str(value).lower()))
    return sorted(parts & product_tokens)

# 二开项目产物的登记处：<项目>/fork/upstream.yaml 的 artifacts（产物名 -> (记录, digest)）
upstream_artifacts = {}
for mf in sorted(glob.glob("*/fork/upstream.yaml")):
    for a in (yaml.safe_load(open(mf, encoding="utf-8")) or {}).get("artifacts") or []:
        upstream_artifacts[a.get("name")] = (mf, str(a.get("artifact_digest") or "none"))

files = sorted(glob.glob("tools/traceability/*.yaml"))
bad = []
for f in files:
    r = yaml.safe_load(open(f, encoding="utf-8")) or {}
    cid = r.get("capability_id", f)
    design = r.get("design") or {}
    status = r.get("status")
    exposure = r.get("exposure")
    # 规则 1：每个 design.* ID 必须在 .design 中解析
    for key, universe in known.items():
        for ref in design.get(key) or []:
            if ref not in universe:
                bad.append(f"{cid}: design.{key} 的 {ref} 在 .design 中解析不到")
    for ref in (r.get("validation") or {}).get("scenarios") or []:
        if ref not in known["scenarios"]:
            bad.append(f"{cid}: validation.scenarios 的 {ref} 解析不到")
    # 规则 2：status 非 withdrawn 时至少有一个 requirements/decisions/seams
    if status != "withdrawn" and not any(design.get(k) for k in ("requirements", "decisions", "seams")):
        bad.append(f"{cid}: status={status} 但 requirements/decisions/seams 全为空")
    # 规则 3：blockers 非空时 exposure 必须是 none
    if (design.get("blockers") or []) and exposure != "none":
        bad.append(f"{cid}: blockers 非空但 exposure={exposure}")
    # 规则 4：seams 非空时每个接缝要有一条 dimension 为「上游接缝」的证据
    ev = (r.get("validation") or {}).get("evidence") or []
    if (design.get("seams") or []) and not any(e.get("dimension") == "上游接缝" for e in ev):
        bad.append(f"{cid}: seams 非空但缺少 dimension 为「上游接缝」的证据")
    for e in ev:
        ref = e.get("ref")
        if ref and not os.path.exists(ref):
            bad.append(f"{cid}: 证据指向不存在的 {ref}")
    # 规则 5：stage 取值合法，且与覆盖矩阵对所含决策的归属一致；不得引用作废决策
    if r.get("stage") and r["stage"] not in valid_stages:
        bad.append(f"{cid}: stage={r['stage']} 不是 apps/06 §1 的合法取值")
    for dd in design.get("decisions") or []:
        want = stage_of.get(dd)
        if want == "VOID":
            bad.append(f"{cid}: 引用了已作废的 {dd}")
        elif want and r.get("stage") and r["stage"] != want:
            bad.append(f"{cid}: stage={r['stage']} 与覆盖矩阵对 {dd} 的归属 {want} 不一致")
    # 规则 7：能力 id、动作与工具不含业务能力实现的产品名
    rt = r.get("runtime") or {}
    for label, values in (("capability_id", [cid]),
                          ("runtime.actions", rt.get("actions") or []),
                          ("runtime.tools", rt.get("tools") or [])):
        for v in values:
            if product_hits(v):
                bad.append(f"{cid}: {label} 的 {v} 含实现产品名 {product_hits(v)}")
    # 规则 6：exposure 高于 none 时 release.artifacts 必须有 digest
    arts = ((r.get("release") or {}).get("artifacts")) or []
    if exposure and exposure != "none":
        if not arts or any(not a.get("digest") for a in arts):
            bad.append(f"{cid}: exposure={exposure} 但 release.artifacts 缺 digest")
    # 记录里的 digest 必须指向真实在发的产物：上游镜像等于其 manifest 的
    # artifact_digest，自建单元在 dist/ 中有对应的 SBOM。否则记录与实际发出的
    # 东西脱节——重建镜像之后最容易出现，而且没有任何其他检查会发现。
    for a in arts:
        name, dg = a.get("name") or "", str(a.get("digest") or "")
        got = upstream_artifacts.get(name)
        if got:
            if dg != got[1]:
                bad.append(f"{cid}: 产物 {name} 的 digest 与 {got[0]} 的 artifact_digest 不一致")
        elif name in ("core", "worker"):
            # 自建发布单元（tools/release.sh）：dist/<单元>.<digest>.spdx.json
            if not os.path.exists(f"dist/{name}.{dg.removeprefix('sha256:')}.spdx.json"):
                bad.append(f"{cid}: 产物 {name} 的 digest 在 dist/ 中没有对应的发布产物")
        else:
            bad.append(f"{cid}: 产物 {name} 既不是 */fork/upstream.yaml 登记的产物，也不是自建单元 core/worker")
# 规则 7（契约侧）：契约枚举值同样不含实现产品名
import json
for ef in sorted(glob.glob("contracts/enums/*.schema.json")):
    for v in (json.load(open(ef, encoding="utf-8")).get("enum") or []):
        if product_hits(v):
            bad.append(f"{ef}: 枚举值 {v} 含实现产品名 {product_hits(v)}")
if bad:
    print("  \033[31mFAIL\033[0m"); [print("   ", b) for b in bad]; sys.exit(1)
if not files:
    print("  \033[90mSKIP\033[0m 尚无追溯记录")
else:
    print(f"  \033[32mPASS\033[0m {len(files)} 条追溯记录通过 06 §1 的七条硬规则")
PY
  # 06 §3：注册表由追溯记录生成，并执行四个构建期拒绝条件
  if DESIGN="${DESIGN:-../.design}" python3 tools/gen-registry.py --check; then
    pass "能力注册表与追溯记录一致，四个构建期拒绝条件全部通过"
  else
    fail "能力注册表漂移或校验被拒绝，见上"
  fi
  return 0
}

step_supply()   { hdr "7/10 secret、依赖、许可证与供应链"
  if have gitleaks; then
    gitleaks detect --no-banner -q >/dev/null 2>&1 && pass "gitleaks 无命中" || fail "gitleaks 命中"
  else
    # 兜底：仓库内明显的私钥/令牌形态。二开项目里的上游原样（例如上游测试夹具里的假
    # 私钥、假 nsec）不是本仓库交付的内容；那里只扫本仓库新增或改写的行——与上游原样的
    # 差异由 upstream_manifest.py 按基准 commit 只读求出，基准取不到即失败。
    local secret='BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|nsec1[a-z0-9]{20,}|xox[baprs]-'
    local added mf tree fork_hit=0 excludes=()
    added=$(mktemp)
    for mf in */fork/upstream.yaml; do
      tree=${mf%%/*}
      grep -q '^module:' "$mf" && continue
      excludes+=(":(exclude)$tree/")
      # fork/ 是 Kailo 自有维护输入，不属于 added-lines 比对的上游源码树。
      git grep -qIE "$secret" -- "$tree/fork/" && fork_hit=1
      python3 tools/upstream_manifest.py added-lines "$tree" >>"$added" \
        || { fail "取不到 $tree 的上游基准，本仓库改动无法扫描"; }
    done
    if git grep -nIE "$secret" -- . "${excludes[@]}" >/dev/null 2>&1 \
       || grep -qE "$secret" "$added" || [ "$fork_hit" -eq 1 ]; then
      fail "发现疑似凭据"; else pass "内置扫描无命中（未安装 gitleaks）"; fi
    rm -f "$added"
  fi
  # 产物来源验证（ADR-06）：同名文件不等于同一产物。核对 SBOM 单元、
  # provenance 的 subject/digest/源码 commit，以及该 commit 的依赖锁摘要。
  if [ -d dist ] && [ -n "$(ls -A dist 2>/dev/null)" ]; then
    python3 - <<'PY' || FAIL=1
import glob, hashlib, json, os, re, subprocess, sys, yaml
bad = []
empty = [f for f in glob.glob("dist/*") if os.path.getsize(f) == 0]
bad += [f"{f}: 0 字节产物" for f in empty]
artifacts = glob.glob("dist/*.spdx.json") + glob.glob("dist/*.provenance.json")
names = {os.path.basename(f) for f in artifacts}

def release_form(provenance):
    """构建形态与历史根：只取 provenance 所记 commit 的真实 release.sh。"""
    try:
        with open(provenance, encoding="utf-8") as source:
            deps = json.load(source)["predicate"]["buildDefinition"]["resolvedDependencies"]
        commit = next(x["digest"]["gitCommit"] for x in deps if x.get("digest", {}).get("gitCommit"))
        if not re.fullmatch(r"[0-9a-f]{40}", commit):
            return None
        paths = subprocess.run(["git", "ls-tree", "-r", "--name-only", commit, "--",
                                "tools/release.sh", "apps/tools/release.sh"],
                               capture_output=True, text=True, check=True).stdout.splitlines()
        if len(paths) != 1:
            return None
        root = paths[0].removesuffix("tools/release.sh")
        script = subprocess.run(["git", "show", f"{commit}:{paths[0]}"],
                                capture_output=True, text=True, check=True).stdout
    except (OSError, KeyError, TypeError, ValueError, StopIteration, subprocess.CalledProcessError):
        return None
    image = re.search(r'^\s*tag="([a-z0-9-]+)/\$unit:\$COMMIT"', script, re.M)
    build_type = re.search(r'"buildType": "([^"]+)"', script)
    context = re.search(r'"externalParameters":\s*\{[^\n]*"context":\s*"([^"]+)"', script)
    records_build_id = '"buildArgs": {"PLATFORM_BUILD_ID": commit,' in script
    if records_build_id and '--build-arg "PLATFORM_BUILD_ID=$COMMIT"' not in script:
        return None
    records_runtime_args = (
        '"buildArgs": {"AGENT_RUNTIME_IMAGE": runtime_image} if runtime_image else {}' in script
        or '**({"AGENT_RUNTIME_IMAGE": runtime_image} if runtime_image else {})' in script)
    return (image.group(1), build_type.group(1), context.group(1), root,
            records_runtime_args, records_build_id) if image and build_type and context else None

for name in sorted(names):
    m = re.fullmatch(r"(core|worker)\.([0-9a-f]{64})\.(spdx|provenance)\.json", name)
    if not m:
        bad.append(f"{name}: 产物文件名不符合发布单元与 digest 规则")
        continue
    unit, digest, kind = m.groups()
    peer = f"{unit}.{digest}.{'provenance' if kind == 'spdx' else 'spdx'}.json"
    if peer not in names:
        bad.append(f"{name}: 缺对应 {peer}")
    if os.path.getsize(f"dist/{name}") == 0:
        continue
    try:
        with open(f"dist/{name}", encoding="utf-8") as source:
            document = json.load(source)
        # 镜像名与 buildType 以生成该产物的那一版 release.sh 为准（ADR-17 改过一次名）：
        # 旧产物如实记录旧名，新产物必须是新名，都不靠兼容分支放行。
        form = release_form(f"dist/{unit}.{digest}.provenance.json")
        if form is None:
            bad.append(f"{name}: 取不到生成它的 release.sh，构建形态无从核对")
            continue
        image, build_type, context, root, records_runtime_args, records_build_id = form
        if kind == "spdx":
            if document.get("name") != f"{image}/{unit}" or document.get("spdxVersion") != "SPDX-2.3":
                bad.append(f"{name}: SBOM 单元或 SPDX 版本不匹配")
            continue
        if document.get("subject") != [{"name": f"{image}/{unit}", "digest": {"sha256": digest}}]:
            bad.append(f"{name}: provenance subject 与文件 digest 不匹配")
        definition = document["predicate"]["buildDefinition"]
        dependencies = definition["resolvedDependencies"]
        commit = next((x.get("digest", {}).get("gitCommit") for x in dependencies
                       if x.get("digest", {}).get("gitCommit")), None)
        expected_parameters = {"dockerfile": f"{unit}/Dockerfile", "context": context}
        if records_build_id:
            expected_parameters["buildArgs"] = {"PLATFORM_BUILD_ID": commit}
        if records_runtime_args:
            expected_parameters.setdefault("buildArgs", {})
            if unit == "core":
                # Runtime 的摘要取自实际源码 commit；registry locator 是发布配置，
                # 不能固定为本机地址，也不能只信证明中自报的 Runtime 摘要。
                manifest = yaml.safe_load(subprocess.run(
                    ["git", "show", f"{commit}:{root}agent-runtime/fork/upstream.yaml"],
                    capture_output=True, text=True, check=True).stdout)
                runtimes = [artifact for artifact in manifest["artifacts"]
                            if artifact.get("name") == "agent-runtime"]
                runtime_digest = runtimes[0].get("artifact_digest") if len(runtimes) == 1 else None
                parameters = definition.get("externalParameters") or {}
                runtime_image = (parameters.get("buildArgs") or {}).get("AGENT_RUNTIME_IMAGE")
                if (not isinstance(runtime_digest, str)
                        or not re.fullmatch(r"sha256:[0-9a-f]{64}", runtime_digest)
                        or not isinstance(runtime_image, str)
                        or not re.fullmatch(r"[^@\s]+@sha256:[0-9a-f]{64}", runtime_image)
                        or not runtime_image.endswith("@" + runtime_digest)):
                    bad.append(f"{name}: Runtime 构建参数与源码 commit 固定产物不匹配")
                    continue
                expected_parameters["buildArgs"]["AGENT_RUNTIME_IMAGE"] = runtime_image
                expected_runtime = [{"uri": "oci://" + runtime_image.split("@")[0],
                                     "digest": {"sha256": runtime_digest.removeprefix("sha256:")}}]
            else:
                expected_runtime = []
            runtime_dependencies = [dependency for dependency in dependencies
                                    if str(dependency.get("uri", "")).startswith("oci://")]
            if runtime_dependencies != expected_runtime:
                bad.append(f"{name}: Runtime 依赖证明与构建参数不匹配")
        if (document.get("_type") != "https://in-toto.io/Statement/v1"
                or document.get("predicateType") != "https://slsa.dev/provenance/v1"
                or definition.get("buildType") != build_type
                or definition.get("externalParameters") != expected_parameters):
            bad.append(f"{name}: provenance 构建形态不匹配")
        lock_digest = next((x.get("digest", {}).get("sha256") for x in dependencies
                            if x.get("name") == "dependency-locks"), None)
        if not commit or not re.fullmatch(r"[0-9a-f]{40}", commit):
            bad.append(f"{name}: 源码 commit 缺失或非完整哈希")
            continue
        if subprocess.run(["git", "cat-file", "-e", commit + "^{commit}"],
                          capture_output=True).returncode != 0:
            bad.append(f"{name}: commit {commit[:12]} 在本仓库中不存在")
            continue
        paths = tuple(root + path for path in ("core/Cargo.lock", "client-kit/dart/pubspec.lock",
                                               "pnpm-lock.yaml", "worker/go.sum"))
        listed = subprocess.run(["git", "ls-tree", "-r", "--name-only", commit, "--", *paths],
                                capture_output=True, text=True, check=True).stdout.splitlines()
        blob_ids = [subprocess.run(["git", "rev-parse", f"{commit}:{path}"],
                                   capture_output=True, text=True, check=True).stdout.strip()
                    for path in listed]
        actual_lock_digest = (hashlib.sha256("".join(blob + "\n" for blob in blob_ids).encode()).hexdigest()
                              if blob_ids else "none")
        if lock_digest != actual_lock_digest:
            bad.append(f"{name}: 依赖锁摘要与源码 commit 不匹配")
    except (AttributeError, KeyError, TypeError, ValueError, yaml.YAMLError, subprocess.CalledProcessError) as error:
        bad.append(f"{name}: 产物元数据不可验证（{type(error).__name__}）")
if bad:
    print("  \033[31mFAIL\033[0m"); [print("   ", b) for b in bad]; sys.exit(1)
print(f"  \033[32mPASS\033[0m {len(names) // 2} 个产物 digest：SBOM、provenance、commit 与锁摘要一致")
PY
  else
    skip "尚无构建产物（tools/release.sh 生成）"
  fi
  return 0
}

step_seam()     { hdr "8/10 上游 seam diff"
  if ! ls */fork/upstream.yaml >/dev/null 2>&1; then skip "尚无上游进入运行拓扑"; return 0; fi
  DESIGN="${DESIGN:-../.design}" python3 - <<'PY' || FAIL=1
import glob, os, re, sys
sys.path.insert(0, "tools")
# 记录结构、源码摘要与基准解析由 upstream_manifest 判定——与 build-upstream.sh 同一份
import upstream_manifest as um
d = os.environ["DESIGN"]
t02 = open(glob.glob(f"{d}/02-*.md")[0], encoding="utf-8").read()
known = set(re.findall(r"^\| ((?:SF|SS)-[A-Z]+-[A-Z0-9-]+) \|", t02, re.M))
hexes = set(re.findall(r"\b[0-9a-f]{40}\b", t02))
bad, notes, n, arts = [], [], 0, 0
for tree, f in um.records().items():
    n += 1
    m = um.load(f)
    # 结构、删除路径、vendor 目标，以及每个已登记产物「由当前源码构建」（source_digest 重算一致）
    bad += [f"{f}: {b}" for b in um.problems(f, m)]
    # 基准 commit 必须可解析：.references 的对象库或上游远端里真的有它
    if re.fullmatch(r"[0-9a-f]{40}", str(m.get("implementation_base_commit"))):
        try:
            um.upstream_tree(f, m)
        except SystemExit as e:
            bad.append(str(e))
    for a in m.get("artifacts") or []:
        arts += a.get("artifact_digest") not in (None, "none")
        if a.get("blocked"):
            notes.append(f"{a['name']} 阻断：{a['blocked']}")
    # 设计追溯：证据 commit 与引用的 SF/SS 必须在 .design/02 解析得到
    if str(m.get("evidence_commit")) not in hexes:
        bad.append(f"{f}: evidence_commit 未出现在 .design/02，无法追溯")
    for ref in (m.get("source_facts") or []) + (m.get("source_seams") or []):
        if ref not in known:
            bad.append(f"{f}: {ref} 在 .design/02 中解析不到")
    for ref in m.get("compatibility_evidence") or []:
        q = ref[5:] if ref.startswith("apps/") else ref
        if not os.path.exists(q):
            bad.append(f"{f}: compatibility_evidence 指向不存在的 {ref}")
for x in notes:
    print(f"  \033[33mNOTE\033[0m {x}")
if bad:
    print("  \033[31mFAIL\033[0m"); [print("   ", b) for b in bad]; sys.exit(1)
print(f"  \033[32mPASS\033[0m {n} 份来源记录：基准可解析、设计引用闭合、证据可达、{arts} 个产物由当前源码构建")
PY
  return 0
}

step_status()   { hdr "上游变化提示（ADR-16，只提示，不计入门禁）"
  # .references 的 HEAD、UPDATE_TASKS.json 与更新记录对比各二开项目的基准 commit。是否升级由
  # 04 的影响分类决定：有新提交不等于失败，这一步永远不置 FAIL。
  if ! ls */fork/upstream.yaml >/dev/null 2>&1; then skip "尚无来源记录"; return 0; fi
  python3 tools/upstream_manifest.py status 2>&1 | sed 's/^/  /' || true
  return 0
}

step_security() { hdr "9/10 受影响安全不变式"
  if [ ! -f deploy/local/compose.yaml ]; then skip "尚无部署描述"; return 0; fi
  python3 - <<'PY' || FAIL=1
import glob, os, re, subprocess, sys, yaml
import pathlib
import json
import tempfile

# 初始化顺序检查生产脚本；配置预检只使用实际部署输入，不维护第二套配置。
initializer = pathlib.Path("deploy/local/init-local.sh").read_text(encoding="utf-8")
prechecks = list(re.finditer(r"^\./bootstrap\.sh --validate-config$", initializer, re.M))
destructive = list(re.finditer(r"^\s*(?:compose down --volumes|sudo -n rm -rf)\b", initializer, re.M))
if len(prechecks) != 1 or not destructive or any(item.start() < prechecks[0].start() for item in destructive):
    raise SystemExit("FAIL init-local 必须在删除前调用同一配置预检")
sync_calls = list(re.finditer(r"^\./bootstrap\.sh --sync-client-redirects$", initializer, re.M))
idp_ready = re.search(r"^compose up -d --wait keycloak temporal spicedb buzz-relay$", initializer, re.M)
core_start = re.search(r"^\./start-core\.sh$", initializer, re.M)
if (len(sync_calls) != 1 or not idp_ready or not core_start
        or not idp_ready.end() < sync_calls[0].start() < core_start.start()):
    raise SystemExit("FAIL 客户端回调同步必须在 IdP 就绪后、Core 启动前执行")
ensure_calls = list(re.finditer(r"^\./bootstrap\.sh --ensure-platform-admin$", initializer, re.M))
platform_subject = re.search(r'^platform_subject=\$\(\.\./\.\./core/verify/idp-subject\.sh "\$PLATFORM_ADMIN_USER"\)', initializer, re.M)
tenant_boot = re.search(r'--slug "\$VERIFY_TENANT_SLUG"', initializer)
catalog_boot = re.search(r'--slug "\$PLATFORM_CATALOG_TENANT_SLUG"[^\n]*\\\n\s*--admin-subject "\$platform_subject"', initializer)
if (len(ensure_calls) != 1 or not platform_subject or not tenant_boot or not catalog_boot
        or not idp_ready.end() < ensure_calls[0].start() < platform_subject.start() < core_start.start()
        or not core_start.start() < tenant_boot.start() < catalog_boot.start()):
    raise SystemExit("FAIL 平台管理员须在 IdP 就绪后补齐、取 subject，并在业务 Tenant 之后引导 Catalog")
deployment_env = pathlib.Path("deploy/local/.env")
if deployment_env.is_file():
    result = subprocess.run(["bash", "deploy/local/bootstrap.sh", "--validate-config"],
                            capture_output=True)
    if result.returncode != 0:
        raise SystemExit("FAIL 实际部署配置未通过 bootstrap --validate-config；本门禁不回显配置或凭据")
    print("  \033[32mPASS\033[0m 实际部署配置通过生产预检；预检只读，不生成凭据或清理数据")
else:
    print("  \033[33mSKIP\033[0m 实际部署配置预检无适用对象（未提供 deploy/local/.env）；不代表运行验收")
print("  \033[32mPASS\033[0m 初始化先预检、后清理；IdP 就绪后同步客户端与管理员，业务 Tenant 后引导 Catalog")

# IdP 原生语言：执行生产同步分支，只隔离文件/HTTP，不接触实际用户或凭据。
import copy
import io
import contextlib
import urllib.error
from unittest.mock import patch

locale_calls = list(re.finditer(r"^\./bootstrap\.sh --sync-realm-locales$", initializer, re.M))
if len(locale_calls) != 1 or not idp_ready.end() < locale_calls[0].start() < core_start.start():
    raise SystemExit("FAIL realm 语言同步必须在 IdP 就绪后、Core 启动前执行")
bootstrap_source = pathlib.Path("deploy/local/bootstrap.sh").read_text(encoding="utf-8")
locale_source = bootstrap_source.split("<<'PYLOCALE'\n", 1)[1].split("\nPYLOCALE", 1)[0]
locale_template = json.loads(pathlib.Path("deploy/local/identity-provider/realm.json").read_text())
locale_desired = {"internationalizationEnabled": True, "supportedLocales": ["zh-CN", "en"],
                  "defaultLocale": "zh-CN"}
assert all(locale_template.get(k) == v for k, v in locale_desired.items())


def locale_sync_probe(current, fault=None, expected_error=False):
    writes = []
    realm_before = copy.deepcopy(current)
    output = io.StringIO()

    def read_file(path, *args, **kwargs):
        if str(path) == "identity-provider/realm.json":
            return json.dumps(locale_template)
        assert str(path) == "secrets/keycloak_admin_password"
        return "fixture-password"

    def http(request, data=None, **kwargs):
        assert kwargs["timeout"] == 1
        if isinstance(request, str):
            assert request == "https://idp.invalid/realms/master/protocol/openid-connect/token"
            return io.BytesIO(b'{"access_token":"fixture-token"}')
        assert request.full_url == "https://idp.invalid/admin/realms/fixture"
        assert request.get_header("Authorization") == "Bearer fixture-token"
        if request.method == "PUT":
            body = json.loads(request.data)
            assert body == locale_desired  # 不允许投递用户/client/角色/认证配置。
            writes.append(body)
            if fault != "lost-update":
                current.update(body)
            if fault == "unknown-after-write":
                raise urllib.error.URLError("fixture-password fixture-token")
            return io.BytesIO()
        assert request.method == "GET"
        return io.BytesIO(json.dumps(current).encode())

    error = None
    with patch.object(pathlib.Path, "read_text", read_file), \
         patch("urllib.request.urlopen", http), \
         patch.object(sys, "argv", ["bootstrap", "https://idp.invalid/realms/fixture", "fixture", "admin", "1"]), \
         contextlib.redirect_stdout(output):
        try:
            exec(compile(locale_source, "bootstrap:PYLOCALE", "exec"), {})
        except SystemExit as caught:
            error = str(caught)
    assert (error is not None) == expected_error
    assert "fixture-password" not in output.getvalue() + (error or "")
    assert "fixture-token" not in output.getvalue() + (error or "")
    assert {k: v for k, v in current.items() if k not in locale_desired} == \
           {k: v for k, v in realm_before.items() if k not in locale_desired}
    return len(writes)


locale_current = {"realm": "fixture", "id": "unchanged", "enabled": True, "registrationAllowed": False}
assert locale_sync_probe(locale_current) == 1
locale_current["supportedLocales"].reverse()
assert locale_sync_probe(locale_current) == 0
assert locale_sync_probe({"realm": "fixture"}, "lost-update", True) == 1
locale_unknown = {"realm": "fixture"}
assert locale_sync_probe(locale_unknown, "unknown-after-write", True) == 1
assert locale_sync_probe(locale_unknown) == 0
assert locale_sync_probe({"realm": "other"}, expected_error=True) == 0
print("  \033[32mPASS\033[0m IdP 原生中英：同步/重入/读回拒绝/结果不明后只读确认/身份不变 6 项")

class UniqueKeysLoader(yaml.SafeLoader):
    pass

def unique_mapping(loader, node, deep=False):
    keys = set()
    for key_node, _ in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in keys:
            raise SystemExit(f"FAIL compose.yaml: 重复配置键 {key}（第 {key_node.start_mark.line + 1} 行）")
        keys.add(key)
    return loader.construct_mapping(node, deep=deep)

UniqueKeysLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, unique_mapping)
d = yaml.load(open("deploy/local/compose.yaml", encoding="utf-8"), Loader=UniqueKeysLoader)
raw = open("deploy/local/compose.yaml", encoding="utf-8").read()
bad = []
# Exercise the actual existing deployment producer, not a second renderer.
starter = pathlib.Path("deploy/local/start-core.sh").read_text(encoding="utf-8")
adapter_start = starter.index("adapter_compose=()")
adapter_end = starter.index("# DD-105:", adapter_start)
cleanup_start = starter.index("runtime_config=\n")
cleanup_end = starter.index("runtime_compose=()", cleanup_start)
adapter_program = "set -eu\n" + starter[cleanup_start:cleanup_end] + starter[adapter_start:adapter_end] + '''
if [ -n "${adapter_config:-}" ]; then
  python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1]))))' "$adapter_config"
fi
'''
with tempfile.TemporaryDirectory() as temporary:
    location = pathlib.Path(temporary)
    directory = location / "adapters.json"
    public = location / "public.json"
    public_doc = {"keys": [{"kty": "EC", "crv": "P-256", "alg": "ES256",
        "kid": "fixture", "x": "A" * 43, "y": "A" * 43}]}
    public.write_text(json.dumps(public_doc), encoding="utf-8")
    delivery = {"adapters": [{"nativeHumanIdentities": [{"jwksFile": str(public)},
        {"jwksFile": str(public)}]}]}
    directory.write_text(json.dumps(delivery), encoding="utf-8")
    base_env = {k: v for k, v in os.environ.items() if k != "APPLICATION_ADAPTER_DIRECTORY_FILE"}
    base_env["TMPDIR"] = temporary
    def adapter_produce(path=None):
        values = {} if path is None else {"APPLICATION_ADAPTER_DIRECTORY_FILE": str(path)}
        result = subprocess.run(["bash", "-c", adapter_program], cwd=temporary,
                                env=base_env | values, capture_output=True, text=True)
        assert not list(location.glob("tmp.*")), "原 EXIT cleanup 必须清掉失败/成功投递临时文件"
        return result
    absent = adapter_produce()
    assert absent.returncode == 0 and absent.stdout == "", "零业务组件不能强制或生成目录投递"
    directory.write_text('{"adapters":[]}', encoding="utf-8")
    empty = adapter_produce(directory)
    assert empty.returncode == 0 and len(json.loads(empty.stdout)["services"]["core-bff"]["volumes"]) == 1
    directory.write_text(json.dumps(delivery), encoding="utf-8")
    original = adapter_produce(directory)
    assert original.returncode == 0, original.stderr
    core_delivery = json.loads(original.stdout)["services"]["core-bff"]
    assert core_delivery["environment"] == {"APPLICATION_ADAPTER_DIRECTORY_FILE": str(directory)}
    mounts = core_delivery["volumes"]
    assert len(mounts) == 2 and {mount["source"] for mount in mounts} == {str(directory), str(public)}
    assert all(mount["target"] == mount["source"] and mount["read_only"] is True
        and mount["bind"]["create_host_path"] is False for mount in mounts)
    linked = location / "linked.json"
    linked.symlink_to(directory)
    for path in (location / "missing.json", location, linked, "relative.json", "/"):
        assert adapter_produce(path).returncode != 0, "无效投递路径不能进入 Core mount"
    for content in ('{"adapters":[],"adapters":[]}', '{', '{"adapters":null}',
                    json.dumps({"adapters": [{"nativeHumanIdentities": [{"jwksFile": str(linked)}]}]})):
        directory.write_text(content, encoding="utf-8")
        assert adapter_produce(directory).returncode != 0, "不明/歧义目录不能生成投递"
    directory.write_text(json.dumps(delivery), encoding="utf-8")
    for secret_field in ("d", "k", "p", "q"):
        public.write_text(json.dumps({"keys": [public_doc["keys"][0] | {secret_field: "fixture-private"}]}), encoding="utf-8")
        refused = adapter_produce(directory)
        assert refused.returncode != 0 and "fixture-private" not in refused.stdout + refused.stderr
    public.write_text(json.dumps(public_doc), encoding="utf-8")
    assert adapter_produce(directory).returncode == 0
    assert '"${adapter_compose[@]}"' in starter[starter.index("compose() {"):]
    assert "adapter_config" in starter[starter.index("cleanup_start_core()"):starter.index("trap cleanup_start_core EXIT")]
print("  \033[32mPASS\033[0m Application 原投递：可缺席、精确只读文件、公钥去重、坏路径/歧义/私钥拒绝、同原启动消费者")
gateway_start = starter.index("gateway_names=(")
gateway_end = starter.index("\nproject=", gateway_start)
gateway_program = "set -eu\n" + starter[gateway_start:gateway_end]
with tempfile.TemporaryDirectory() as temporary:
    location = pathlib.Path(temporary)
    (location / "secrets").mkdir()
    (location / "model-gateway-config.yaml").write_text(
        pathlib.Path("deploy/local/model-gateway-config.yaml").read_text(encoding="utf-8"), encoding="utf-8")
    public = location / "public.json"
    public.write_text(json.dumps({"keys": [{"kty": "EC", "crv": "P-256", "alg": "ES256",
        "kid": "fixture", "x": "A" * 43, "y": "A" * 43}]}), encoding="utf-8")
    identity = {"GATEWAY_SERVICE_ISSUER": "fixture-gateway", "GATEWAY_SERVICE_AUDIENCE": "fixture-core",
        "GATEWAY_SERVICE_CALLER_ID": "fixture-caller", "GATEWAY_SERVICE_JWKS_FILE": str(public),
        "GATEWAY_SERVICE_MAX_TOKEN_SECONDS": "60", "GATEWAY_SERVICE_SIGNING_KEY_FILE": "/private/fixture.pem",
        "GATEWAY_SERVICE_KEY_ID": "fixture", "GATEWAY_SERVICE_TOKEN_SECONDS": "30",
        "AGENT_TOOL_MCP_URL": "http://core-bff:8082/service/v1/agent-tools/mcp",
        "AGENT_TOOL_EXT_MCP_URL": "http://core-bff:8082/", "AGENT_TOOL_SESSION_ISSUER": "fixture-tool",
        "AGENT_TOOL_SESSION_AUDIENCE": "fixture-tool-audience", "AGENT_TOOL_SESSION_TOKEN_SECONDS": "30",
        "AGENT_TOOL_GATEWAY_URL": "http://agentgateway:18081", "AGENT_TOOL_GATEWAY_NAME": "fixture"}
    base_env = {k: v for k, v in os.environ.items() if not k.startswith(("GATEWAY_SERVICE_", "AGENT_TOOL_"))}
    base_env.update(OIDC_ISSUER="fixture-oidc", OIDC_SERVICE_CLIENT_ID="fixture-service",
        OIDC_WORKER_CLIENT_ID="fixture-worker", BFF_SERVICE_NAME="core-bff", SERVICE_CONTAINER_PORT="8082",
        AGENTGATEWAY_PROVIDER_SECRET_DIRECTORY="/private", AGENTGATEWAY_MODEL_PORT="18080", TMPDIR=temporary)
    def produce(values):
        return subprocess.run(["bash", "-c", gateway_program], cwd=temporary,
                              env=base_env | values, capture_output=True).returncode
    output = location / "secrets/agentgateway-service.yaml"
    def derived():
        return yaml.safe_load(output.read_text(encoding="utf-8"))
    if produce(identity) != 0 or derived()["llm"]["policies"]["extAuthz"]["conditional"][0]["policies"]["backendAuth"]["jwtSign"]["claims"]["sub"] != "fixture-caller":
        bad.append("Gateway 完整组未由原 producer 投递精确独立 SERVICE")
    if derived()["gateways"] != {"fixture": {"port": 18081}}:
        bad.append("Gateway 具名 listener 必须取同一 Tool URL/name，不能用 admin/browser 入口")
    if output.stat().st_mode & 0o777 != 0o444:
        bad.append("Gateway 非密配置必须能由原非 root 镜像读取；不得扩大私钥权限")
    if (produce({}) != 0 or derived()["gateways"] != {}
            or derived()["llm"]["policies"]["extAuthz"]["conditional"][0]["policies"]["backendAuth"] is not None):
        bad.append("Gateway 全缺省未清除旧签名投递")
    for invalid in ({"GATEWAY_SERVICE_ISSUER": "partial"},
                    identity | {"GATEWAY_SERVICE_TOKEN_SECONDS": "60"},
                    identity | {"GATEWAY_SERVICE_CALLER_ID": "fixture-worker"},
                    *(identity | {"AGENT_TOOL_GATEWAY_URL": f"http://agentgateway:{port}"}
                      for port in (8080, 8091, 15000, 18080))):
        if produce(invalid) == 0 or derived()["gateways"] != {}:
            bad.append("Gateway 部分/超期/共用 Worker 身份必须拒绝且不能覆盖原投递")
gateway_env = d["services"]["agentgateway"].get("environment") or {}
if any(name.startswith("GATEWAY_SERVICE_") for name in gateway_env):
    bad.append("Gateway 不得把可选 SERVICE 完整组变为 Compose 全局必填或第二直接输入")
if "gateway_delivery=(-f secrets/agentgateway-service.compose.json)" not in initializer:
    bad.append("Gateway 初始化缺少原派生 Compose 配置消费者")
# 同一部署事实只维护一次；这里校验消费者投影，不读取真实 .env 或任何 secret。
# 去掉必填提示文案后比较表达式，提示文字变化不影响语义。
projections = {
    ("buzz-web", "PLATFORM_DISPLAY_NAME"): "${PLATFORM_DISPLAY_NAME}",
    ("core-bff", "PLATFORM_DISPLAY_NAME"): "${PLATFORM_DISPLAY_NAME}",
    ("agentgateway", "OIDC_REDIRECT_URI"): "${PUBLIC_ORIGIN}/oauth/callback",
    ("core-bff", "TENANT_INVITATION_LINK_BASE"): "${PUBLIC_ORIGIN}/app/invite",
    ("agentgateway", "OIDC_JWKS_URI"): "${OIDC_ISSUER}/protocol/openid-connect/certs",
    ("temporal", "OIDC_JWKS_URI"): "${OIDC_ISSUER}/protocol/openid-connect/certs",
    ("core-bff", "SERVICE_OIDC_JWKS_URI"): "${OIDC_ISSUER}/protocol/openid-connect/certs",
    ("core-bff", "OIDC_TOKEN_URL"): "${OIDC_ISSUER}/protocol/openid-connect/token",
    ("worker", "OIDC_TOKEN_URL"): "${OIDC_ISSUER}/protocol/openid-connect/token",
    ("core-bff", "TEMPORAL_TARGET_URL"): "http://${TEMPORAL_ADDRESS}",
    ("worker", "TEMPORAL_ADDRESS"): "${TEMPORAL_ADDRESS}",
    ("worker", "CORE_SERVICE_URL"): "http://core-bff:${SERVICE_CONTAINER_PORT}",
    ("core-bff", "BUZZ_RELAY_WS_URL"): "ws://${BUZZ_RELAY_HOST}:${BUZZ_RELAY_PORT}",
    ("core-bff", "BUZZ_RELAY_TRANSPORT"): "http://${BUZZ_RELAY_HOST}:${BUZZ_RELAY_PORT}",
    ("core-bff", "RELAY_OPERATOR_API_ORIGIN"): "http://${BUZZ_RELAY_HOST}:${BUZZ_RELAY_PORT}",
    ("temporal-db", "POSTGRES_DB"): "${TEMPORAL_DB_NAME}",
    ("temporal-schema", "SQL_DATABASE"): "${TEMPORAL_DB_NAME}",
    ("temporal-schema", "VISIBILITY_DATABASE"): "${TEMPORAL_DB_NAME}_visibility",
    ("temporal", "TEMPORAL_DB_NAME"): "${TEMPORAL_DB_NAME}",
    ("temporal", "TEMPORAL_VISIBILITY_DB_NAME"): "${TEMPORAL_DB_NAME}_visibility",
    ("core-bff", "OPENMETER_CUSTOMERS_URL"): "${OPENMETER_CUSTOMERS_URL}",
    ("core-bff", "OPENMETER_NAMESPACE"): "${OPENMETER_NAMESPACE}",
    ("core-bff", "OPENMETER_HTTP_TIMEOUT_SECONDS"): "${OPENMETER_HTTP_TIMEOUT_SECONDS}",
    ("core-bff", "OPENMETER_CORE_TOKEN_FILE"): "${OPENMETER_CORE_TOKEN_FILE}",
    ("openmeter", "NAMESPACE_DEFAULT"): "${OPENMETER_NAMESPACE}",
    ("openmeter", "SERVER_CORESERVICETOKENFILE"): "${OPENMETER_CORE_TOKEN_FILE}",
    ("openmeter", "OPENMETER_API_PORT"): "${OPENMETER_API_PORT}",
    ("openmeter", "POSTGRES_USER"): "${OPENMETER_DB_USER}",
    ("openmeter", "POSTGRES_DATABASE"): "${OPENMETER_DB_NAME}",
    ("openmeter-postgres", "POSTGRES_USER"): "${OPENMETER_DB_USER}",
    ("openmeter-postgres", "POSTGRES_DB"): "${OPENMETER_DB_NAME}",
    ("openmeter", "AGGREGATION_CLICKHOUSE_USERNAME"): "${OPENMETER_CLICKHOUSE_USER}",
    ("openmeter", "AGGREGATION_CLICKHOUSE_DATABASE"): "${OPENMETER_CLICKHOUSE_DB_NAME}",
    ("openmeter-clickhouse", "CLICKHOUSE_USER"): "${OPENMETER_CLICKHOUSE_USER}",
    ("openmeter-clickhouse", "CLICKHOUSE_DB"): "${OPENMETER_CLICKHOUSE_DB_NAME}",
}
for (service, key), expected in projections.items():
    value = (d.get("services", {}).get(service, {}).get("environment") or {}).get(key, "")
    actual = re.sub(r"\$\{(\w+):\?[^}]*\}", r"${\1}", str(value))
    if actual != expected:
        bad.append(f"{service}.{key}: 必须从公共配置派生，不得独立维护")
sample = open("deploy/local/.env.example", encoding="utf-8").read()
sample_keys = set(re.findall(r"^([A-Z][A-Z_0-9]*)=", sample, re.M))
for key, expression in {
    "PUBLIC_ORIGIN": "http://${PUBLIC_HOST}:${AGENTGATEWAY_PORT}",
    "OIDC_ISSUER": "http://${OIDC_HOST}:${KEYCLOAK_PORT}/realms/${OIDC_REALM}",
    "OPENMETER_CUSTOMERS_URL": "http://${OPENMETER_HOST}:${OPENMETER_API_PORT}/api/v3/openmeter/customers",
}.items():
    if f"{key}={expression}" not in sample.splitlines():
        bad.append(f".env.example: {key} 必须保留本地拓扑派生表达式，不得重新手填")
for service, host_key, networks in (
    ("buzz-relay", "BUZZ_RELAY_HOST", ("component", "app")),
    ("agentgateway", "PUBLIC_HOST", ("edge", "app")),
    ("keycloak", "OIDC_HOST", ("edge", "app", "component")),
):
    for network in networks:
        aliases = d["services"][service]["networks"][network].get("aliases", [])
        aliases = [re.sub(r"\$\{(\w+):\?[^}]*\}", r"${\1}", str(value)) for value in aliases]
        expected_aliases = ["${" + host_key + "}"]
        if service == "agentgateway" and network == "edge":
            expected_aliases.append("${AGENTGATEWAY_MODEL_HOST}")
        if aliases != expected_aliases:
            bad.append(f"{service}.{network}: DNS alias 必须取自公共主机名输入 {host_key}")
if re.sub(r"\$\{(\w+):\?[^}]*\}", r"${\1}", d["networks"]["edge"].get("name", "")) != "${PLATFORM_EDGE_NETWORK}":
    bad.append("edge: 必须使用唯一部署配置中的 PLATFORM_EDGE_NETWORK")
retired = {"OIDC_JWKS_URI", "OIDC_TOKEN_URL", "OIDC_REDIRECT_URI",
           "TENANT_INVITATION_LINK_BASE", "TEMPORAL_TARGET_URL", "CORE_SERVICE_URL", "CORE_DATABASE_URL",
           "BUZZ_RELAY_WS_URL", "BUZZ_RELAY_TRANSPORT", "RELAY_OPERATOR_API_ORIGIN"}
for key in sorted(sample_keys & retired):
    bad.append(f".env.example: {key} 是派生值，不得恢复为独立输入")
sources = {key for value in projections.values() for key in re.findall(r"\$\{(\w+)\}", value)}
for key in sorted(sources - sample_keys):
    bad.append(f".env.example: 缺少公共输入 {key}")
core_config = d.get("services", {}).get("core-bff", {})
if "DATABASE_URL" in (core_config.get("environment") or {}) or "./secrets/core-db-url.env" not in (core_config.get("env_file") or []):
    bad.append("core-bff: DATABASE_URL 只能由数据库同源凭据生成的受控 env_file 投递")
# apps 是独立仓库根；凭据和数据的排除必须来自本仓库根 .gitignore，
# 不能依赖父仓库或仅覆盖单一扩展名的嵌套规则。
for probe, pattern in (
    ("deploy/local/secrets/gitnexus-ignore-probe.env", "/deploy/local/secrets/"),
    ("deploy/local/data/gitnexus-ignore-probe.dat", "/deploy/local/data/"),
):
    result = subprocess.run(
        ["git", "check-ignore", "-v", "--no-index", probe],
        capture_output=True, text=True,
    )
    origin = result.stdout.split("\t", 1)[0].strip()
    if result.returncode != 0 or not origin.startswith(".gitignore:") or not origin.endswith(":" + pattern):
        bad.append(f"GitNexus 根 ignore 缺少 {pattern}：本地凭据或数据会进入索引")
declared = set(d.get("networks") or {})
for name, svc in (d.get("services") or {}).items():
    nets = set(svc.get("networks") or [])
    # 01 §8 与 07 §1：网络归属必须显式声明，默认网络会让边界失效
    if not nets:
        bad.append(f"{name}: 未声明 networks，会落到默认网络")
    for n in nets - declared:
        bad.append(f"{name}: 使用了未声明的 network {n}")
    # 公开入口与管理面不得同属一个服务（SS-AGW-ADMIN 的编排层表达）
    if {"edge", "mgmt"} <= nets:
        bad.append(f"{name}: 同时接入 edge 与 mgmt，管理面对公开入口可达")
    # ADR-06：按 digest 引用，不使用可变 tag
    img = svc.get("image")
    if img and "@sha256:" not in img:
        bad.append(f"{name}: image 未按 digest 引用（{img}）")
# DD-93：私有数据网络 `<owner>-data` 只接纳名为 `<owner>` 或 `<owner>-*` 的服务，
# 且至多一个成员同时接入其他网络——那是所有者运行体，数据存储本身不出网，
# 其他服务在网络层到不了别人的数据。
for net in sorted(n for n in declared if n.endswith("-data")):
    owner = net[: -len("-data")]
    members = {name: set(svc.get("networks") or []) for name, svc in (d.get("services") or {}).items()
               if net in set(svc.get("networks") or [])}
    for name in sorted(members):
        if name != owner and not name.startswith(owner + "-"):
            bad.append(f"{name}: 接入了 {owner} 的私有数据网络 {net}")
    bridging = sorted(name for name, nets in members.items() if nets - {net})
    if len(bridging) > 1:
        bad.append(f"{net}: {', '.join(bridging)} 都同时接入其他网络，数据存储对共享网络可达")
# 同一条规则延伸到本仓库自建镜像的基础镜像：compose 按 digest 引用了产物，
# 产物的 FROM 却跟着可变 tag 走，两次构建就不是同一份输入（ADR-06）。
# 二开项目里查每个产物在来源记录中登记的 build_dockerfile，不以所在目录区分（ADR-16 第 8 条）：
# 产物直接沿用的上游构建文件（Relay、网关）与 fork/packaging/ 下的一样由本仓库维护。
# 二开树里其余 Dockerfile（上游示例、基准测试、CI）不是产物的构建文件，不在这条规则里。
forks, fork_built = [], []
for mf in sorted(glob.glob("*/fork/upstream.yaml")):
    forks.append(mf.split("/")[0] + "/")
    for a in (yaml.safe_load(open(mf, encoding="utf-8")) or {}).get("artifacts") or []:
        if a.get("build_dockerfile"):
            fork_built.append(a["build_dockerfile"])
for df in sorted(set(glob.glob("**/Dockerfile", recursive=True)) | set(fork_built)):
    if "/node_modules/" in df or "/target/" in df or df.startswith("target/") \
            or (any(df.startswith(t) for t in forks) and df not in fork_built):
        continue
    if not os.path.isfile(df):
        bad.append(f"{df}: 来源记录登记的 build_dockerfile 不存在")
        continue
    stages = set()
    for n, line in enumerate(open(df, encoding="utf-8"), 1):
        m = re.match(r"\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?", line, re.I)
        if not m:
            continue
        # 引用本文件前面阶段名的 FROM 不拉取镜像，其基础镜像已在那个阶段上检查
        # scratch 是保留的空基础镜像，不从任何 registry 拉取，没有可固定的 digest
        if "@sha256:" not in m.group(1) and not m.group(1).startswith("$") \
                and m.group(1) != "scratch" and m.group(1).lower() not in stages:
            bad.append(f"{df}:{n}: 基础镜像未按 digest 引用（{m.group(1)}）")
        if m.group(2):
            stages.add(m.group(2).lower())
# OpenBao 的部署前置不变式（07 §1）中可由部署描述校验的条目
bao_cfg = "deploy/local/secret-store-config.hcl"
bao_init = "deploy/local/secret-store-init.sh"
if os.path.exists(bao_init):
    init = open(bao_init, encoding="utf-8").read()
    if not re.search(r'ns write "\$\{OPENBAO_KV_MOUNT\}/config"[^\n]*\bcas_required=true\b', init):
        bad.append("secret-store-init.sh: KV v2 mount 未启用 cas_required=true（DD-70）")
    if not re.search(r'ns read -field=cas_required "\$\{OPENBAO_KV_MOUNT\}/config"', init):
        bad.append("secret-store-init.sh: 缺少 cas_required 运行期回读校验（DD-70）")
if os.path.exists(bao_cfg):
    lines = [l for l in open(bao_cfg, encoding="utf-8").read().split("\n")
             if not l.strip().startswith("#")]
    body = "\n".join(lines)
    # 上游已移除 mlock：出现该键且为 false 时进程直接拒绝启动（SF-OBA-10）
    if "disable_mlock" in body:
        bad.append("secret-store-config.hcl: 出现 disable_mlock，上游已移除该支持（SF-OBA-10）")
    # 零 audit device 时 audit broker 的 fail-closed 分支被短路（SF-OBA-06）；
    # 该版本只接受声明式配置，且必须给满 type 与 path 两个块标签（SF-OBA-11）
    if not re.search(r'^\s*audit\s+"[^"]+"\s+"[^"]+"\s*\{', body, re.M):
        bad.append("secret-store-config.hcl: 缺少带 type 与 path 两个标签的 audit 块（SF-OBA-06/11）")
    for svc, spec in (d.get("services") or {}).items():
        if "openbao" in (spec.get("image") or "") and "-dev" in " ".join(spec.get("command") or []):
            bad.append(f"{svc}: 使用了 server -dev，07 §1 禁止它进入任何 active 拓扑")

# 自建上游的 digest 必须与其来源记录一致：compose 与记录各写一份，两处脱节就意味着
# 跑的不是被登记的那个产物。
for mf in sorted(glob.glob("*/fork/upstream.yaml")):
    for a in (yaml.safe_load(open(mf, encoding="utf-8")) or {}).get("artifacts") or []:
        want, name = str(a.get("artifact_digest") or "none"), a.get("name")
        if want == "none":
            continue
        for svc, spec in (d.get("services") or {}).items():
            img = spec.get("image") or ""
            if f"/{name}@" in img and not img.endswith(want):
                bad.append(f"{svc}: 镜像 digest 与 {mf} 中 {name} 的 artifact_digest 不一致")

# Buzz Relay 的三个「缺省即关闭」开关（07 §1、SF-BUZ-26/30）。
# 原生端本机持钥直连 Relay，Core 不在其发布路径上，roster 校验是协作
# 数据平面唯一的准入执行点——这三项写错等于整条协作面无准入。
for svc, spec in (d.get("services") or {}).items():
    env = spec.get("environment") or {}
    # 列表写法（- KEY=VALUE）与映射写法同义，不能因为写法不同就落在检查之外
    if isinstance(env, list):
        env = dict((e.split("=", 1) + [None])[:2] for e in map(str, env))
    if not isinstance(env, dict) or "BUZZ_BIND_ADDR" not in env:
        continue
    for key, want in (("BUZZ_REQUIRE_RELAY_MEMBERSHIP", "true"),
                      ("BUZZ_ALLOW_NIP_OA_AUTH", "false"),
                      ("BUZZ_REQUIRE_AUTH_TOKEN", "true")):
        got = str(env.get(key, "")).strip().lower()
        if got != want:
            bad.append(f"{svc}: {key} 为 {got or '未设置'}，必须显式为 {want}")
    # SS-BUZ-GOVERNANCE（DD-80、DD-106）：未设定即上游行为——成员可自建
    # Channel、自加入、读写非 private Channel，且 Buzz 自带 workflow 引擎照常
    # 运行（cron、kind:9 触发、/hooks/{id}），成为 Temporal 之外的第二个工作流
    # 权威。空值是合法的收紧（成员什么都不能发），因此只要求显式赋值，不要求
    # 非空；只写键不给值（映射里的 null、列表里不带 =）表示从宿主环境透传，
    # 宿主没有它时容器里就没有，同样不算设定。
    if env.get("BUZZ_MEMBER_EVENT_KINDS") is None:
        bad.append(f"{svc}: 未设定 BUZZ_MEMBER_EVENT_KINDS，Relay 以上游行为运行，"
                   "含 Buzz 自带 workflow（SF-BUZ-37、SF-BUZ-45、DD-106）")

# 该开关只存在于本仓库的构建里，上游镜像会静默忽略它。跑 Buzz 二进制的
# 服务（Relay 本身，以及以 buzz-admin 建 schema 的一次性服务）都必须用本仓库
# 构建：同一套二进制混用两个来源，schema 与服务就可能不是同一份代码。
for svc, spec in (d.get("services") or {}).items():
    env = spec.get("environment") or {}
    entry = " ".join(spec.get("entrypoint") or []) if isinstance(spec.get("entrypoint"), list) else str(spec.get("entrypoint") or "")
    runs_buzz = (isinstance(env, dict) and "BUZZ_BIND_ADDR" in env) or "/buzz-" in entry
    if runs_buzz and "/collaboration-relay@" not in str(spec.get("image") or ""):
        bad.append(f"{svc}: 未运行 collaboration/ 的本仓库构建，SS-BUZ-GOVERNANCE 不生效")

# SS-AGW-OIDC：身份 header 投影的硬约束。
#
# 按 route 逐条检查是不够的：认证与投影挂在 listener 的 gateway 阶段，
# 而 gateway 阶段先于选路执行（SF-AGW-22）。因此这里对**每条 route**算出
# 它实际生效的那份 transformation——listener 级优先，退回 route 级——
# 再逐条判定。没有任何一条能落在检查之外。
agw_cfg = "deploy/local/model-gateway-config.yaml"
if os.path.exists(agw_cfg):
    agw_source = pathlib.Path(agw_cfg).read_text(encoding="utf-8")
    if "gateways: {} # GATEWAY_SERVICE_DELIVERY_GATEWAYS" not in agw_source:
        bad.append("Gateway 缺少原派生具名 listener 消费者")
    agw = yaml.safe_load(agw_source)
    if agw.get("routes") != []:
        bad.append("Gateway 原 traffic.route 集合须有明确空列表，保证最后一条删除读回")
    application_check = agw["llm"]["policies"]["extAuthz"]["conditional"]
    if (len(application_check) != 1
            or application_check[0].get("condition") != "has(apiKey.componentBindingId)"
            or application_check[0].get("failureMode") != "deny"
            or application_check[0].get("policies", {}).get("backendAuth") is not None):
        bad.append("APPLICATION 模型必须保留精确条件与 extAuthz deny；未投递不能假冒 SERVICE")
    PROJECTED = {"x-platform-oidc-issuer", "x-platform-oidc-subject"}
    # 原生入口标识（DD-78）：只许原生 listener 投影，且值固定；浏览器 listener
    # 必须移除它，否则浏览器自报就能打开只对原生端开放的入口
    SURFACE = "x-platform-client-surface"
    # ADR-17：此前使用的旧前缀身份 header 在每个入口都必须移除，永久保留——外来的
    # 旧名 header 一旦被放行，任何仍认旧名的读者都会把它当成网关投影
    LEGACY = {"x-kailo-oidc-issuer", "x-kailo-oidc-subject", "x-kailo-client-surface",
              "x-kailo-human-identity", "x-kailo-tenant", "x-kailo-workspace", "x-kailo-principal"}
    FORBIDDEN_SOURCES = ("jwt.rawToken", "jwt.raw_token", "jwt.roles", "jwt.groups",
                         "jwt.realm_access", "jwt.resource_access")
    # DD-73：AgentGateway 故意不把它当 hop-by-hop 清理（SF-AGW-20），
    # 不显式删除就会把调用方的代理凭据转给 upstream。
    MUST_REMOVE = {"proxy-authorization"}

    def transform_of(node):
        return ((node.get("policies") or {}).get("transformations") or {}).get("request") or {}

    checked = 0
    for bind in agw.get("binds") or []:
        for lis in bind.get("listeners") or []:
            lis_name = lis.get("name") or "?"
            lis_pol = lis.get("policies") or {}
            oidc, jwt = lis_pol.get("oidc"), lis_pol.get("jwtAuth")
            lis_tr = transform_of(lis)
            routes = lis.get("routes") or []
            if not routes:
                continue

            # 认证必须挂在 listener 上，且恰好一种：浏览器入口用 OIDC（cookie 会话），
            # 原生入口用 jwtAuth（Bearer）。两者同挂时 OIDC 先执行，会把不带 cookie
            # 的原生请求当成未登录导航（SF-AGW-22、DD-78）。
            if bool(oidc) == bool(jwt):
                bad.append(f"agentgateway {lis_name}: listener 必须恰好挂一种认证（oidc 或 jwtAuth）"
                           f"——route 内联认证会各持一套会话且新增 route 可绕开（SF-AGW-22）")
            if oidc and not (oidc.get("logout") or {}).get("path"):
                # logout 是可选项；缺了它，退出请求被当普通请求转给后端，
                # 网关 cookie 原样留着，下一个请求就建起新会话（SF-AGW-23）
                bad.append(f"agentgateway {lis_name}: OIDC 未配置 logout，退出后网关会话仍在（SF-AGW-23）")
            if jwt:
                # 上游缺省 optional 放行无令牌请求；省略 audiences 即不校验 aud；
                # 保留令牌会把用户凭据转给 BFF（SF-AGW-24、SF-AGW-11/19）
                if str(jwt.get("mode", "")).lower() != "strict":
                    bad.append(f"agentgateway {lis_name}: jwtAuth.mode 必须显式为 strict（缺省 optional 放行无令牌请求，SF-AGW-24）")
                if not [a for a in (jwt.get("audiences") or []) if str(a).strip()]:
                    bad.append(f"agentgateway {lis_name}: jwtAuth.audiences 必须非空（省略即不校验 aud，SF-AGW-11/19）")
                if jwt.get("preserveToken") is True:
                    bad.append(f"agentgateway {lis_name}: jwtAuth.preserveToken 不得为 true（令牌会被转给 BFF，SF-AGW-24）")
            for route in routes:
                rp = route.get("policies") or {}
                if rp.get("oidc") or rp.get("jwtAuth"):
                    bad.append(f"agentgateway {lis_name}/{route.get('name') or '?'}: "
                               f"route 内联认证，会与 listener 级认证互不相认（SF-AGW-22）")
                # DD-112：浏览器入口靠 cookie 会话，跨源伪造防护只由网关 csrf 策略执行，而它只能按
                # route 配置（SF-AGW-26）——漏配一条 route 就是一条可被同站跨源页面触发的写入口。
                # 额外可信来源只有部署的 PUBLIC_ORIGIN；原生入口是 Bearer，不配。
                if oidc:
                    extra = ((rp.get("csrf") or {}).get("additionalOrigins"))
                    if extra != ["${PUBLIC_ORIGIN}"]:
                        bad.append(f"agentgateway {lis_name}/{route.get('name') or '?'}: 浏览器入口的 route 必须配置 "
                                   f"csrf，additionalOrigins 只能是 [${{PUBLIC_ORIGIN}}]（DD-112），实际 {extra!r}")

            # 每条 route 实际生效的 transformation：listener 级优先，退回 route 级。
            # gateway 阶段先于选路执行，所以这样算出的就是请求真正经过的那一份。
            allowed_sets = PROJECTED | ({SURFACE} if jwt else set())
            for route in routes:
                where = f"agentgateway {lis_name}/{route.get('name') or '?'}"
                tr = lis_tr or transform_of(route)
                if not tr:
                    bad.append(f"{where}: 没有生效的 request transformation，身份不会被投影")
                    continue
                checked += 1
                set_map = tr.get("set") or {}
                sets = set(set_map.keys())
                removes = {str(h).lower() for h in (tr.get("remove") or [])}
                # 投影目标不得进入 remove：set 已保证要么是已验证的值、要么不存在
                for h in sets & removes:
                    bad.append(f"{where}: {h} 同时出现在 set 与 remove（SS-AGW-OIDC 禁止）")
                for h in sets - allowed_sets:
                    bad.append(f"{where}: 投影了 {h}，该入口只允许 {sorted(allowed_sets)}")
                for h in PROJECTED - sets:
                    bad.append(f"{where}: 缺少对 {h} 的 set，BFF 会因缺失而全部拒绝")
                for h in sorted(LEGACY - removes):
                    bad.append(f"{where}: 未移除旧前缀身份 header {h}（ADR-17，清理规则永久保留）")
                for h in MUST_REMOVE - removes:
                    bad.append(f"{where}: 未删除 {h}，会把调用方的代理凭据转给 upstream（DD-73、SF-AGW-20）")
                if jwt:
                    if str(set_map.get(SURFACE, "")).strip() != '"native"':
                        bad.append(f"{where}: 原生入口必须把 {SURFACE} 投影为固定值 \"native\"（DD-78）")
                elif SURFACE not in removes:
                    bad.append(f"{where}: 浏览器入口必须移除 {SURFACE}，否则浏览器可自报为原生端（DD-78）")
                # 禁止投影 raw token 与角色 claim：授权在 Core 重做
                for h, expr in set_map.items():
                    if any(src in str(expr) for src in FORBIDDEN_SOURCES):
                        bad.append(f"{where}: {h} 取自 {expr}，禁止投影 raw token 或角色 claim")
    if not checked:
        bad.append("agentgateway: 没有任何 route 被身份投影覆盖")

# SpiceDB 是访问允许/拒绝的权威（03 §1），部署的 schema 必须与 .design/03 §5
# 的固定 schema 逐字相等。漂移不会让任何调用报错，只会静默改变授权判定。
zed_path = "deploy/local/authorization/schema.zed"
design_03 = os.path.join(os.environ.get("DESIGN", "../.design"), "03-领域模型与权限模型.md")
if os.path.exists(zed_path):
    if not os.path.exists(design_03):
        bad.append(f"{zed_path}: 找不到 {design_03}，无法比对固定 schema")
    else:
        blocks = re.findall(r"^```zed\n(.*?)^```", open(design_03, encoding="utf-8").read(), re.M | re.S)
        if len(blocks) != 1:
            bad.append(f"{design_03}: §5 的 zed 代码块应恰好有 1 个，实际 {len(blocks)} 个")
        else:
            got = open(zed_path, encoding="utf-8").read()
            # 文件头允许 // 注释说明来源，正文之后必须逐字相等
            body = re.sub(r"\A(?:(?://[^\n]*)?\n)*", "", got)
            if body != blocks[0]:
                bad.append(f"{zed_path}: 与 {design_03} §5 的 zed 块不等，授权判定会与设计脱节")

# 杜绝硬编码：可配置项必须来自 ${VAR:?}，不得是字面量
# 发布到宿主的端口可带绑定地址前缀（127.0.0.1:…）；前缀不改变「端口写死」这一事实
for m in re.finditer(r"^\s+-\s+\"?(?:[\d.]+:)?(\d{2,5}):(\d{2,5})\"?\s*$", raw, re.M):
    bad.append(f"端口字面量 {m.group(0).strip()}，应取自 ${{VAR:?}}")
if bad:
    print("  \033[31mFAIL\033[0m"); [print("   ", b) for b in bad]; sys.exit(1)
zed_note = "；SpiceDB schema 与 .design/03 §5 逐字相等" if os.path.exists(zed_path) else ""
print(f"  \033[32mPASS\033[0m {len(d.get('services') or {})} 个服务：network 显式、边界不越层、私有数据网络按所有者隔离、镜像按 digest、无端口字面量、公共配置单源投影{zed_note}")
PY
  return 0
}

step_docs()     { hdr "10/10 文档、runbook 与 release note 同步"
  # 07 §6 的清单是权威：清单有几项就必须有几份，编号一一对应。每份必须写明
  # 触发信号、判定依据、可执行步骤、不可执行的动作与完成判据，并留下带日期的
  # 演练记录——没演练过的 runbook 在事故里第一次跑，等于没有。
  if python3 tools/check-runbooks.py; then
    pass "07 §6 的 runbook 逐项齐全，章节完整且有演练记录"
  else
    fail "runbook 不完整"
  fi
  return 0
}

main() {
  if [ ! -f /.dockerenv ]; then
    run_in_check_container "$@"
    exit "$?"
  fi
  if [ "${1:-}" = --docs-only ]; then
    exec bash tools/check-docs.sh "${DESIGN:-../.design}"
  fi
  prepare_check_dependencies || exit 2
  local want=("${STEPS[@]}")
  case "${1:-}" in
    --full|"") ;;
    *) want=("$1") ;;
  esac
  for s in "${want[@]}"; do
    if ! printf '%s\n' "${STEPS[@]}" | grep -qx "$s"; then
      echo "未知步骤：$s（可用：${STEPS[*]}）"; exit 2; fi
    "step_$s"
  done
  echo
  [ "$FAIL" -eq 0 ] && echo "全部通过。" || echo "存在失败项，见上。"
  exit "$FAIL"
}
main "$@"
