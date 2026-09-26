#!/usr/bin/env bash
# 构建发布单元并产出可追溯的来源证明（ADR-06、00-实施总纲.md Stage 0 第 7/8 项）。
#
# 每个单元产出三样东西，全部以镜像 digest 为键：
#   1. OCI 镜像，按 digest 引用（tag 只作人类可读别名）
#   2. SPDX SBOM —— 依赖与许可证清单由它派生，不另维护第二份
#   3. SLSA 风格 provenance 断言 —— 源码 commit、依赖锁摘要、构建参数、构建者
#
# 接入托管 registry 后，SBOM 与 provenance 改为 OCI referrer 附到 digest 上，
# 并启用 cosign keyless 签名；本脚本的产出形状不变。
set -euo pipefail
cd "$(dirname "$0")/.." || exit 2

UNITS=(core worker)
OUT=dist
# 用 BuildKit 构建：Dockerfile 里的 cache mount 依赖它，且它是现代 Docker 的默认构建器
export DOCKER_BUILDKIT=1
# 本机若未把当前用户加入 docker 组，退回 sudo；syft 需要与 docker 同等权限
SUDO=""
docker info >/dev/null 2>&1 || SUDO="sudo -n"
DOCKER="$SUDO docker"

say()  { printf '%s\n' "$*"; }
pass() { printf '  \033[32mOK\033[0m   %s\n' "$*"; }
die()  { printf '  \033[31mFAIL\033[0m %s\n' "$*"; exit 1; }

# 不接受未跟踪源码；Dockerfile 的 COPY worker 会把它一同放进构建上下文。
# 实际构建输入另从固定 commit 导出，避免被 ignored 文件或构建期间的工作树变化污染。
[ -z "$(git status --porcelain --untracked-files=all)" ] || die "工作树有未提交改动，构建产物无法追溯到 commit"
COMMIT=$(git rev-parse HEAD)
BUILD_CONTEXT=$(mktemp -d)
trap 'rm -r -- "$BUILD_CONTEXT"' EXIT
git archive --format=tar "$COMMIT:apps" .dockerignore core worker | tar -xf - -C "$BUILD_CONTEXT" \
  || die "无法从固定 commit 导出构建上下文"

mkdir -p "$OUT"
# 清掉历史失败留下的空产物：0 字节的 SBOM 或 provenance 会被误认为有效
find "$OUT" -type f -empty -delete


for unit in "${UNITS[@]}"; do
  say "== $unit =="
  tag="kailo/$unit:$COMMIT"
  if [ -n "${BUILDX_BUILDER:-}" ]; then
    # docker-container builder 的 cgroup 限额约束编译；--load 把镜像交给后续
    # inspect 与 syft 使用的本地 image store。
    $DOCKER buildx build --builder "$BUILDX_BUILDER" --load -q \
      -f "$BUILD_CONTEXT/$unit/Dockerfile" -t "$tag" "$BUILD_CONTEXT" >/dev/null \
      || die "$unit 构建失败"
  else
    $DOCKER build -q -f "$BUILD_CONTEXT/$unit/Dockerfile" -t "$tag" "$BUILD_CONTEXT" >/dev/null \
      || die "$unit 构建失败"
  fi
  digest=$($DOCKER image inspect --format '{{.Id}}' "$tag")
  pass "镜像 $digest"

  sbom="$OUT/$unit.${digest#sha256:}.spdx.json"
  # 先写临时文件，成功才落位：失败时不留下 0 字节产物冒充 SBOM
  tmp_sbom=$(mktemp)
  if $SUDO env "PATH=$PATH" syft "docker:$tag" -o spdx-json > "$tmp_sbom"; then
    mv "$tmp_sbom" "$sbom"
  else
    rm -f "$tmp_sbom"; die "$unit SBOM 生成失败"
  fi
  pass "SBOM $(basename "$sbom")"

  # 依赖锁的摘要进 provenance：换了锁文件就换了产物来源
  locks=$(git ls-files 'core/Cargo.lock' 'worker/go.sum' 'pnpm-lock.yaml' 'mobile/pubspec.lock' 2>/dev/null || true)
  lock_digest=$( [ -n "$locks" ] && git hash-object $locks | sha256sum | cut -d' ' -f1 || echo none )

  prov="$OUT/$unit.${digest#sha256:}.provenance.json"
  python3 - "$unit" "$digest" "$COMMIT" "$lock_digest" "$prov" <<'PY'
import json, os, subprocess, sys
unit, digest, commit, lock_digest, out = sys.argv[1:6]
remote = subprocess.run(["git","config","--get","remote.origin.url"],
                        capture_output=True, text=True).stdout.strip() or "none"
json.dump({
    "_type": "https://in-toto.io/Statement/v1",
    "subject": [{"name": f"kailo/{unit}", "digest": {"sha256": digest.removeprefix("sha256:")}}],
    "predicateType": "https://slsa.dev/provenance/v1",
    "predicate": {
        "buildDefinition": {
            "buildType": "https://kailo.local/docker-build/v1",
            "externalParameters": {"dockerfile": f"{unit}/Dockerfile", "context": "apps/"},
            "resolvedDependencies": [
                {"uri": remote, "digest": {"gitCommit": commit}},
                {"name": "dependency-locks", "digest": {"sha256": lock_digest}},
            ],
        },
        "runDetails": {
            "builder": {"id": os.environ.get("KAILO_BUILDER_ID", "local")},
        },
    },
}, open(out, "w"), ensure_ascii=False, indent=2)
PY
  pass "provenance $(basename "$prov")"
done

say ""
say "产物在 $OUT/，已按 digest 命名。dist/ 不入版本库——可追溯性来自 provenance 里的 commit 与锁摘要。"
