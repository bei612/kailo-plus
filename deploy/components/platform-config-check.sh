#!/usr/bin/env bash
# Batch E 只读核对：平台 .env 键、受控投递文件、运行容器的投递结果、buzz-web
# CSP frame-src 与各组件 frame-ancestors。不修改任何文件或容器；只打印允许
# 列表内的非 secret 值（origin 与文件路径），不读取 secret 文件内容。
# 用法：platform-config-check.sh <commit>
set -uo pipefail
commit=${1:?commit}
S=/volumes/kailo/ci/sources/$commit/apps/deploy/local
R=/volumes/kailo/apps/deploy/local
D=(sudo -n docker)
fail=0
bad() { echo "  FAIL: $*"; fail=1; }
ok() { echo "  ok: $*"; }
value() {
  python3 -I - "$R/.env" "$1" <<'PY'
import re, sys
for line in open(sys.argv[1], encoding="utf-8"):
    m = re.match(r"^" + re.escape(sys.argv[2]) + r"=(.*)$", line.rstrip("\n"))
    if m:
        v = m.group(1)
        print(v[1:-1] if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"" else v)
        break
PY
}
container() { "${D[@]}" ps -q --filter "label=com.docker.compose.project=platform-local" --filter "label=com.docker.compose.service=$1" | head -1; }
container_env() {  # <service> <name>：仅允许列表中的非 secret 键
  "${D[@]}" inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$(container "$1")" | sed -n "s/^$2=//p"
}

echo "== 1. 发布树镜像钉与运行镜像一致（否则 start-core.sh 会替换 Core/Worker/Web）"
[ -f "$S/compose.yaml" ] || bad "缺少发布树 $S"
for svc in core-bff worker buzz-web; do
  pinned=$(grep -A4 "^  $svc:" "$S/compose.yaml" | grep -o 'sha256:[0-9a-f]\{64\}' | head -1)
  running=$("${D[@]}" inspect -f '{{.Image}}' "$(container "$svc")" 2>/dev/null)
  [ -n "$pinned" ] && [ "$pinned" = "$running" ] && ok "$svc $running" || bad "$svc 发布树 ${pinned:-?} ≠ 运行 ${running:-?}"
done

echo "== 2. .env 键（非 secret 值）"
origins=$(value NATIVE_PAGE_ORIGINS)
public=$(cd "$R" && set -a && . ./.env >/dev/null 2>&1 && printf '%s' "${PUBLIC_ORIGIN:-}")
[ -n "$origins" ] && ok "NATIVE_PAGE_ORIGINS=$origins" || bad "NATIVE_PAGE_ORIGINS 为空"
for o in $origins; do
  [[ $o =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || bad "非精确 origin：$o"
  [ "$o" != "$public" ] || bad "NATIVE_PAGE_ORIGINS 不得包含 PUBLIC_ORIGIN"
done
for k in APPLICATION_ADAPTER_DIRECTORY_FILE ACTION_TOKEN_SIGNING_FILE ACTION_TOKEN_PUBLIC_JWKS_LOCATOR ACTION_TOKEN_JWKS_READER_ROLE \
  COMPONENT_CONFORMANCE_ENVIRONMENT_FILE COMPONENT_CONFORMANCE_FIXTURE_FILE COMPONENT_CONFORMANCE_IDENTITY_FILE; do
  v=$(value "$k"); [ -n "$v" ] && ok "$k=$v" || echo "  -- $k 未设置"
done

echo "== 3. 受控投递文件（只看元数据与公开字段）"
python3 -I - "$(value APPLICATION_ADAPTER_DIRECTORY_FILE)" "$(value ACTION_TOKEN_SIGNING_FILE)" \
  "$(value COMPONENT_CONFORMANCE_ENVIRONMENT_FILE)" "$(value COMPONENT_CONFORMANCE_FIXTURE_FILE)" "$(value COMPONENT_CONFORMANCE_IDENTITY_FILE)" <<'PY' || fail=1
import json, os, stat, sys
from pathlib import Path
directory, signing, *conformance = sys.argv[1:]
failed = False
def note(ok, text):
    global failed
    print(("  ok: " if ok else "  FAIL: ") + text)
    failed |= not ok
def readable(path):
    p = Path(path)
    if not (p.is_absolute() and p.is_file() and p.resolve() == p):
        note(False, f"{path}: 需要真实规范绝对文件"); return None
    mode = stat.S_IMODE(p.stat().st_mode)
    note(bool(mode & 0o004), f"{path}: mode {oct(mode)}（Core/Worker 容器以非宿主 uid 读取，需要 0644）")
    return json.loads(p.read_text())
if directory:
    d = readable(directory)
    if d:
        for a in d.get("adapters", []):
            print(f"     adapter {a.get('adapterServiceRef')} baseUrl={a.get('baseUrl')} mcpUrl={a.get('mcpUrl','-')} "
                  f"artifactDigest={a.get('artifactDigest','')[:12]} readers={[r.get('roleName') for r in a.get('secretReaders', [])]}")
if signing:
    s = readable(signing)
    if s:
        jwks = Path(s.get("jwksFile", ""))
        note(jwks.is_file(), f"jwksFile {jwks} 存在（--prepare-action-token 之后）")
        if jwks.is_file():
            keys = json.loads(jwks.read_text()).get("keys", [])
            note(bool(keys) and not any(set(k) & {"d", "p", "q", "k"} for k in keys), "jwksFile 仅含公钥")
            note(str(s.get("secretVersion")) in {k.get("kid") for k in keys}, "jwksFile 含 secretVersion 对应 kid")
digests = set()
for path in conformance:
    if path:
        c = readable(path)
        if c: digests.add(c.get("artifactDigest"))
if digests:
    note(len(digests) == 1, f"一致性三件 artifactDigest 一致：{sorted(d[:12] for d in digests if d)}")
sys.exit(1 if failed else 0)
PY

echo "== 4. 运行容器实际投递"
cb=$(container_env core-bff NATIVE_PAGE_ORIGINS); wb=$(container_env buzz-web NATIVE_PAGE_ORIGINS)
[ "$cb" = "$origins" ] && ok "core-bff NATIVE_PAGE_ORIGINS 与 .env 一致" || bad "core-bff NATIVE_PAGE_ORIGINS='$cb'（需 start-core.sh --no-build）"
[ "$wb" = "$origins" ] && ok "buzz-web NATIVE_PAGE_ORIGINS 与 .env 一致" || bad "buzz-web NATIVE_PAGE_ORIGINS='$wb'（需重建 buzz-web）"
for k in APPLICATION_ADAPTER_DIRECTORY_FILE ACTION_TOKEN_SIGNING_FILE COMPONENT_CONFORMANCE_ENVIRONMENT_FILE; do
  v=$(container_env core-bff "$k"); [ -n "$v" ] && ok "core-bff $k=$v" || echo "  -- core-bff 无 $k"
done
v=$(container_env worker COMPONENT_CONFORMANCE_ENVIRONMENT_FILE); [ -n "$v" ] && ok "worker COMPONENT_CONFORMANCE_ENVIRONMENT_FILE=$v" || echo "  -- worker 无一致性投递"
for k in OPENBAO_AUDIT_LOG_FILE OPENBAO_AUDIT_LOG_MAX_BYTES; do
  "${D[@]}" inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$(container core-bff)" | grep -q "^$k=." \
    && ok "core-bff 有 $k" || bad "core-bff 无 $k（binding secret 读取审计核对必然失败，binding 停在 PROVISIONING）"
done

echo "== 5. Web CSP frame-src（buzz-web Caddy）"
csp=$(curl -sS -m 15 -D - -o /dev/null "${public:-http://192.168.0.193:58090}/app/" | tr -d '\r' | grep -i '^content-security-policy:' || true)
for o in $origins; do grep -q "frame-src[^;]* $o" <<<"$csp" && ok "frame-src 含 $o" || bad "frame-src 不含 $o"; done
grep -q "frame-src[^;]*\*" <<<"$csp" && bad "frame-src 含通配" || true

echo "== 6. 组件页面嵌入头"
for o in $origins; do
  h=$(curl -sS -m 15 -D - -o /dev/null "$o/" 2>/dev/null | tr -d '\r' | grep -iE '^(content-security-policy|x-frame-options):' || true)
  if grep -qi "frame-ancestors[^;]*${public:-http://192.168.0.193:58090}" <<<"$h" && ! grep -qiE '^x-frame-options: *(sameorigin|deny)' <<<"$h"; then
    ok "$o 允许被 ${public:-58090} 嵌入"
  else
    echo "  -- $o：$(tr '\n' ' ' <<<"${h:-无 CSP/XFO 或未部署}")"
  fi
done
exit "$fail"
