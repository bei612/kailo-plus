#!/usr/bin/env bash
# 统一检查入口（ADR-07）。本地与 CI 调用同一命令、同一步骤集。
# 十个子步骤对应 03-验证发布与验收门禁.md §5 的十项合并门禁。
# 无适用对象的步骤输出 SKIP 并通过——它在首次出现适用对象时自动生效，不被注释掉。
#
# 用法：
#   tools/check.sh              # 按变更范围选择步骤
#   tools/check.sh --full       # 全部步骤
#   tools/check.sh <step>       # 单步，step 见下方 STEPS
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

STEPS=(lint verify contract migrate replay trace supply seam security docs)
FAIL=0

hdr()  { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
pass() { printf '  \033[32mPASS\033[0m %s\n' "$*"; }
skip() { printf '  \033[90mSKIP\033[0m %s\n' "$*"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$*"; FAIL=1; }

have() { command -v "$1" >/dev/null 2>&1; }
# 目录存在且含至少一个非隐藏条目
populated() { [ -d "$1" ] && [ -n "$(ls -A "$1" 2>/dev/null | grep -v '^\.')" ]; }

step_lint() {
  hdr "1/10 格式与静态检查"
  local ran=0
  if populated core && have cargo; then
    ran=1
    # sqlx 离线数据必须与查询同步：否则编译期 SQL 校验会在没有库的环境里
    # 悄悄用过期快照通过。与 contracts 生成物同一套「入库 + 校验同步」模式。
    if [ -n "${DATABASE_URL:-}" ] && have sqlx; then
      if (cd core && cargo sqlx prepare --check --workspace >/dev/null 2>&1); then
        pass "sqlx 离线数据与查询同步"
      else
        fail "sqlx 离线数据过期，在 core/ 下运行 cargo sqlx prepare --workspace 后提交"
      fi
    fi
    cargo fmt --manifest-path core/Cargo.toml --all --check >/dev/null 2>&1 \
      && pass "cargo fmt" || fail "cargo fmt"
    cargo clippy --manifest-path core/Cargo.toml --all-targets -- -D warnings >/dev/null 2>&1 \
      && pass "cargo clippy" || fail "cargo clippy"
  fi
  if populated worker && have go; then
    ran=1
    (cd worker && gofmt -l . | grep -q . ) && fail "gofmt 有未格式化文件" || pass "gofmt"
    (cd worker && go vet ./... >/dev/null 2>&1) && pass "go vet" || fail "go vet"
  fi
  if populated web/packages && have pnpm; then
    ran=1
    pnpm -r typecheck >/dev/null 2>&1 && pass "tsc --noEmit" || fail "tsc --noEmit"
  fi
  if populated mobile/lib; then
    if have dart; then
      ran=1
      (cd mobile && dart analyze >/dev/null 2>&1) && pass "dart analyze" || fail "dart analyze"
    else
      fail "mobile/ 有 Dart 源码但本机无 dart 工具链，该侧无法校验"
    fi
  fi
  [ "$ran" -eq 0 ] && skip "尚无源码"
  return 0
}

step_verify()   { hdr "2/10 受影响范围的验证"
  local ran=0
  if populated core && have cargo; then ran=1
    cargo test --manifest-path core/Cargo.toml >/dev/null 2>&1 && pass "cargo test" || fail "cargo test"; fi
  if populated worker && have go; then ran=1
    (cd worker && go test ./... >/dev/null 2>&1) && pass "go test" || fail "go test"; fi
  if populated web/packages && have pnpm; then ran=1
    pnpm -r test >/dev/null 2>&1 && pass "node --test（TypeScript）" || fail "node --test（TypeScript）"; fi
  if populated mobile/test && have dart; then ran=1
    (cd mobile && dart test >/dev/null 2>&1) && pass "dart test" || fail "dart test"; fi
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
    r = subprocess.run(["git", "show", f"{rev}:{path}"], capture_output=True, text=True)
    return json.loads(r.stdout) if r.returncode == 0 else None

# --full-name 取仓库根相对路径：git show <rev>:<path> 只认这种形式，
# 而工作树读取要用相对当前目录的路径，两者不可混用。
files = subprocess.run(["git", "ls-files", "--full-name", "contracts"],
                       capture_output=True, text=True).stdout.split()
schemas = [f for f in files if f.endswith(".schema.json")]
prefix = subprocess.run(["git", "rev-parse", "--show-prefix"],
                        capture_output=True, text=True).stdout.strip()
breaking = []
for f in schemas:
    old = at(tag, f)
    if old is None:
        continue  # 新增 schema 是向后兼容变更
    local = f[len(prefix):] if prefix and f.startswith(prefix) else f
    new = json.load(open(local, encoding="utf-8"))
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
print(f"  \033[32mPASS\033[0m 相对 {tag} 无破坏性变更（{len(schemas)} 个 schema）")
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

  # 枚举漂移：迁移里的 CHECK 取值是时间点快照，contracts/enums/ 是当前权威。
  # 约束显式命名为 <枚举名>_enum，按名字精确对应，不做模糊匹配——
  # 模糊匹配会把取值恰好是子集的不同枚举误判成漂移。
  python3 - <<'PY' || FAIL=1
import glob, json, os, re, subprocess, sys

url = os.environ["DATABASE_URL"]
sql = ("select c.conname, pg_get_constraintdef(c.oid) from pg_constraint c "
       "join pg_namespace n on n.oid = c.connamespace "
       "where c.contype = 'c' and n.nspname = 'identity'")
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
stage_of = {}
for line in cov.split("\n"):
    m = re.match(r"\| (Stage \d)[^|]*\| `(DD-\d+)`", line)
    if m:
        stage_of[m.group(2)] = m.group(1).replace("Stage ", "S")

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
    # 规则 5：stage 必须与覆盖矩阵对所含决策的归属一致
    for dd in design.get("decisions") or []:
        want = stage_of.get(dd)
        if want and r.get("stage") and r["stage"] != want:
            bad.append(f"{cid}: stage={r['stage']} 与覆盖矩阵对 {dd} 的归属 {want} 不一致")
    # 规则 6：exposure 高于 none 时 release.artifacts 必须有 digest
    if exposure and exposure != "none":
        arts = ((r.get("release") or {}).get("artifacts")) or []
        if not arts or any(not a.get("digest") for a in arts):
            bad.append(f"{cid}: exposure={exposure} 但 release.artifacts 缺 digest")
if bad:
    print("  \033[31mFAIL\033[0m"); [print("   ", b) for b in bad]; sys.exit(1)
if not files:
    print("  \033[90mSKIP\033[0m 尚无追溯记录——Stage 0 不产出用户可达能力，属正确状态")
else:
    print(f"  \033[32mPASS\033[0m {len(files)} 条追溯记录通过 06 §1 的六条硬规则")
PY
  # 06 §3：注册表由追溯记录生成，并执行四个构建期拒绝条件
  if DESIGN="${DESIGN:-../.design}" python3 tools/gen-registry.py; then
    pass "能力注册表已生成，四个构建期拒绝条件全部通过"
  else
    fail "能力注册表生成被拒绝，见上"
  fi
  return 0
}

step_supply()   { hdr "7/10 secret、依赖、许可证与供应链"
  if have gitleaks; then
    gitleaks detect --no-banner -q >/dev/null 2>&1 && pass "gitleaks 无命中" || fail "gitleaks 命中"
  else
    # 兜底：仓库内明显的私钥/令牌形态
    if git grep -nIE 'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|nsec1[a-z0-9]{20,}|xox[baprs]-' -- . >/dev/null 2>&1; then
      fail "发现疑似凭据"; else pass "内置扫描无命中（未安装 gitleaks）"; fi
  fi
  # 产物来源验证（ADR-06）：每个镜像 digest 必须同时有 SBOM 与 provenance，
  # provenance 必须指向本仓库中真实存在的 commit。
  if [ -d dist ] && [ -n "$(ls -A dist 2>/dev/null)" ]; then
    python3 - <<'PY' || FAIL=1
import glob, json, os, re, subprocess, sys
bad = []
empty = [f for f in glob.glob("dist/*") if os.path.getsize(f) == 0]
bad += [f"{f}: 0 字节产物" for f in empty]
digests = {m.group(1) for f in glob.glob("dist/*")
           if (m := re.search(r"\.([0-9a-f]{64})\.", f))}
for dg in sorted(digests):
    for kind in ("spdx.json", "provenance.json"):
        if not glob.glob(f"dist/*.{dg}.{kind}"):
            bad.append(f"{dg[:12]}: 缺 {kind}")
for f in glob.glob("dist/*.provenance.json"):
    if os.path.getsize(f) == 0:
        continue
    d = json.load(open(f, encoding="utf-8"))
    deps = d["predicate"]["buildDefinition"]["resolvedDependencies"]
    commit = next((x["digest"]["gitCommit"] for x in deps if "gitCommit" in x.get("digest", {})), None)
    if not commit:
        bad.append(f"{os.path.basename(f)}: provenance 未记录源码 commit"); continue
    if subprocess.run(["git", "cat-file", "-e", commit + "^{commit}"],
                      capture_output=True).returncode != 0:
        bad.append(f"{os.path.basename(f)}: commit {commit[:12]} 在本仓库中不存在")
if bad:
    print("  \033[31mFAIL\033[0m"); [print("   ", b) for b in bad]; sys.exit(1)
print(f"  \033[32mPASS\033[0m {len(digests)} 个产物 digest：SBOM 与 provenance 齐备、commit 可解析")
PY
  else
    skip "尚无构建产物（tools/release.sh 生成）"
  fi
  return 0
}

step_seam()     { hdr "8/10 上游 seam diff"
  if ! populated upstream-patches; then skip "尚无上游进入运行拓扑"; return 0; fi
  DESIGN="${DESIGN:-../.design}" python3 - <<'PY' || FAIL=1
import glob, os, re, sys
d = os.environ["DESIGN"]
t02 = open(glob.glob(f"{d}/02-*.md")[0], encoding="utf-8").read()
known = set(re.findall(r"^\| ((?:SF|SS)-[A-Z]+-[A-Z0-9-]+) \|", t02, re.M))
hexes = set(re.findall(r"\b[0-9a-f]{40}\b", t02))
bad, n = [], 0
for f in sorted(glob.glob("upstream-patches/*/baseline.yaml")):
    n += 1
    raw = open(f, encoding="utf-8").read()
    def val(k):
        m = re.search(rf"^{k}:\s*(\S+)", raw, re.M)
        return m.group(1) if m else None
    def lst(k):
        m = re.search(rf"^{k}:\s*\[(.*?)\]", raw, re.M | re.S)
        return [x.strip() for x in m.group(1).split(",") if x.strip()] if m else []
    ev, ib, div = val("evidence_commit"), val("implementation_base_commit"), val("base_divergence")
    for name, v in (("evidence_commit", ev), ("implementation_base_commit", ib)):
        if not v or not re.fullmatch(r"[0-9a-f]{40}", v):
            bad.append(f"{f}: {name} 不是 40 位 commit")
    # 06 §2 的硬规则：两者不同而 base_divergence 声明为 none 即构建失败
    if ev and ib and ev != ib and div == "none":
        bad.append(f"{f}: evidence_commit 与 implementation_base_commit 不同，但 base_divergence 声明为 none")
    if ev and ev not in hexes:
        bad.append(f"{f}: evidence_commit 未出现在 .design/02，无法追溯")
    for ref in lst("source_facts") + lst("source_seams"):
        if ref not in known:
            bad.append(f"{f}: {ref} 在 .design/02 中解析不到")
    for ref in lst("compatibility_evidence"):
        q = ref[5:] if ref.startswith("apps/") else ref
        if not os.path.exists(q):
            bad.append(f"{f}: compatibility_evidence 指向不存在的 {ref}")
if bad:
    print("  \033[31mFAIL\033[0m"); [print("   ", b) for b in bad]; sys.exit(1)
print(f"  \033[32mPASS\033[0m {n} 份 baseline manifest：commit 可追溯、设计引用闭合、证据可达")
PY
  return 0
}

step_security() { hdr "9/10 受影响安全不变式"
  if [ ! -f deploy/local/compose.yaml ]; then skip "尚无部署描述"; return 0; fi
  python3 - <<'PY' || FAIL=1
import glob, os, re, sys, yaml
d = yaml.safe_load(open("deploy/local/compose.yaml", encoding="utf-8"))
raw = open("deploy/local/compose.yaml", encoding="utf-8").read()
bad = []
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
# OpenBao 的部署前置不变式（07 §1）中可由部署描述校验的两条
bao_cfg = "deploy/local/openbao-config.hcl"
if os.path.exists(bao_cfg):
    lines = [l for l in open(bao_cfg, encoding="utf-8").read().split("\n")
             if not l.strip().startswith("#")]
    body = "\n".join(lines)
    # 上游已移除 mlock：出现该键且为 false 时进程直接拒绝启动（SF-OBA-10）
    if "disable_mlock" in body:
        bad.append("openbao-config.hcl: 出现 disable_mlock，上游已移除该支持（SF-OBA-10）")
    # 零 audit device 时 audit broker 的 fail-closed 分支被短路（SF-OBA-06）；
    # 该版本只接受声明式配置，且必须给满 type 与 path 两个块标签（SF-OBA-11）
    if not re.search(r'^\s*audit\s+"[^"]+"\s+"[^"]+"\s*\{', body, re.M):
        bad.append("openbao-config.hcl: 缺少带 type 与 path 两个标签的 audit 块（SF-OBA-06/11）")
    for svc, spec in (d.get("services") or {}).items():
        if "openbao" in (spec.get("image") or "") and "-dev" in " ".join(spec.get("command") or []):
            bad.append(f"{svc}: 使用了 server -dev，07 §1 禁止它进入任何 active 拓扑")

# 自建上游的 digest 必须与其 baseline manifest 一致：compose 与 manifest
# 各写一份，两处脱节就意味着跑的不是被登记的那个产物。
for mf in glob.glob("upstream-patches/*/baseline.yaml"):
    proj = mf.split("/")[1]
    m = re.search(r"^artifact_digest:\s*(\S+)", open(mf, encoding="utf-8").read(), re.M)
    if not m or m.group(1) == "none":
        continue
    want = m.group(1)
    for svc, spec in (d.get("services") or {}).items():
        img = spec.get("image") or ""
        if f"upstream-{proj}@" in img and not img.endswith(want):
            bad.append(f"{svc}: 镜像 digest 与 {mf} 的 artifact_digest 不一致")

# SS-AGW-OIDC：身份 header 投影的三条硬约束
agw_cfg = "deploy/local/agentgateway-config.yaml"
if os.path.exists(agw_cfg):
    agw = yaml.safe_load(open(agw_cfg, encoding="utf-8"))
    PROJECTED = {"x-kailo-oidc-issuer", "x-kailo-oidc-subject"}
    FORBIDDEN_SOURCES = ("jwt.rawToken", "jwt.raw_token", "jwt.roles", "jwt.groups",
                         "jwt.realm_access", "jwt.resource_access")
    found_route = False
    for bind in agw.get("binds") or []:
        for lis in bind.get("listeners") or []:
            for route in lis.get("routes") or []:
                tr = ((route.get("policies") or {}).get("transformations") or {}).get("request") or {}
                if not tr:
                    continue
                found_route = True
                sets = set((tr.get("set") or {}).keys())
                removes = set(tr.get("remove") or [])
                # 投影目标不得进入 remove：set 已保证要么是已验证的值、要么不存在
                for h in sets & removes:
                    bad.append(f"agentgateway: {h} 同时出现在 set 与 remove（SS-AGW-OIDC 禁止）")
                # 只许投影这两条，多一条都是扩大信任面
                for h in sets - PROJECTED:
                    bad.append(f"agentgateway: 投影了 {h}，SS-AGW-OIDC 只允许 {sorted(PROJECTED)}")
                for h in PROJECTED - sets:
                    bad.append(f"agentgateway: 缺少对 {h} 的 set，BFF 会因缺失而全部拒绝")
                # 禁止投影 raw token 与角色 claim：授权在 Core 重做
                for h, expr in (tr.get("set") or {}).items():
                    if any(s in str(expr) for s in FORBIDDEN_SOURCES):
                        bad.append(f"agentgateway: {h} 取自 {expr}，禁止投影 raw token 或角色 claim")
    if not found_route:
        bad.append("agentgateway: 没有任何 request transformation，身份不会被投影")

# 杜绝硬编码：可配置项必须来自 ${VAR:?}，不得是字面量
for m in re.finditer(r"^\s+-\s+\"?(\d{2,5}):(\d{2,5})\"?\s*$", raw, re.M):
    bad.append(f"端口字面量 {m.group(0).strip()}，应取自 ${{VAR:?}}")
if bad:
    print("  \033[31mFAIL\033[0m"); [print("   ", b) for b in bad]; sys.exit(1)
print(f"  \033[32mPASS\033[0m {len(d.get('services') or {})} 个服务：network 显式、边界不越层、镜像按 digest、无端口字面量")
PY
  return 0
}

step_docs()     { hdr "10/10 文档、runbook 与 release note 同步"
  local n; n=$(find docs/runbooks -name '*.md' 2>/dev/null | wc -l)
  if [ "$n" -gt 0 ]; then pass "$n 份 runbook"; else skip "生产发布前需补齐 07 §6 的十份"; fi
  return 0
}

main() {
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
