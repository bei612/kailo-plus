#!/usr/bin/env bash
# Kailo CI 节点：npm（Verdaccio）与 Go 模块（Athens）依赖下载缓存。用途、数据位置与回源方式见 07-运行与运维基线.md §2.1。
#
# 用法（在 CI 节点以 ubuntu 身份，从仓库检出或固定发布树执行）：
#   tools/ci/dep-cache/setup.sh up        安装运行副本、启动/更新两个缓存并等待 healthy，再经缓存实际取一次包与模块
#   tools/ci/dep-cache/setup.sh status    读回容器、健康、数据目录与占用
#   tools/ci/dep-cache/setup.sh probe     只读：经缓存取 pnpm 的 packument 与一个 Go 模块版本列表
#   tools/ci/dep-cache/setup.sh down      停止并删除容器（数据保留；构建入口探测失败后自动回源原站）
#
# 可覆盖的环境变量：
#   DEP_CACHE_DATA            数据根（默认 /volumes/data/kailo/capacity/dep-cache，4T 容量盘；包与模块按内容只写一次、读多）
#   DEP_CACHE_RUNTIME         运行副本目录：compose.yaml、verdaccio.yaml、.env（默认 /volumes/kailo/ci/dep-cache）
#   NPM_CACHE_PORT / GO_CACHE_PORT   本机回环端口（默认 55002 / 55003，须与 build-args.sh 的缺省一致）
#   DEP_CACHE_BIND            三个缓存的监听地址（默认 10.239.0.1，Kailo dockerd 的 kailo0 网关；bridge 网络的容器与构建也可达）
#   CRATES_CACHE_PORT         crates.io 缓存端口（默认 55007）
#   CRATES_INDEX_UPSTREAM     sparse 索引上游（默认 https://rsproxy.cn/index/）
#   CRATES_DL_UPSTREAM        crate 文件上游前缀，后接 <crate>/<version>.crate（默认 https://lf9-static.rsproxy.cn/obj/rsproxy/crates/，
#                             即 rsproxy 下载跳转的目标）；失败时回源 static.crates.io。数据在 4T：$DEP_CACHE_DATA/crates
#   NPM_UPLINKS               Verdaccio 依序回源的 npm 源（空格分隔；默认 https://registry.npmmirror.com/
#                             https://mirrors.cloud.tencent.com/npm/）。11-14 实测本节点到 registry.npmjs.org 的 TLS 被重置，
#                             npmmirror 6.9 MB 0.59 s、腾讯 1.1 s。构建链：镜像构建 → Verdaccio → 这些源。
#   FILES_CACHE_PORT          构建下载文件缓存端口（默认 55008）：apt 归档 /debian/、/debian-security/，以及 /<host>/<path> 形式的
#                             固定版本下载（FILES_HOSTS 列出的站点，GitHub 的跳转由缓存跟随）。数据在 4T：$DEP_CACHE_DATA/files
#   FILES_DEBIAN_UPSTREAM     Debian 上游（默认 https://mirrors.tuna.tsinghua.edu.cn/debian/）
#   FILES_SECURITY_UPSTREAM   Debian 安全更新上游（默认 https://mirrors.tuna.tsinghua.edu.cn/debian-security/）
#   FILES_HOSTS               可经缓存下载的站点（空格分隔；默认见下方 FILES_HOSTS）
#   SCCACHE_CACHE_PORT        镜像构建共享 Rust 编译缓存端口（默认 55010）：sccache 的 WebDAV 后端（nginx dav），数据在 4T：
#                             $DEP_CACHE_DATA/sccache，容量由 hot-retention 管理
#   DOCKER_CONFIG             Docker 客户端配置（默认 /var/lib/kailo-ci/docker-config）
# 出网：缓存直连上游（路由器 OpenWrt 透明代理负责）；本脚本不读取、不写入任何代理设置（OPS-02）。
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
apps=$(cd "$here/../../.." && pwd)
export DOCKER_CONFIG=${DOCKER_CONFIG:-/var/lib/kailo-ci/docker-config}
# Always the Kailo dockerd: without DOCKER_HOST the docker CLI talks to the system dockerd, where these caches must
# never run (2026-11-14 a run without it created both containers there; they were removed).
export DOCKER_HOST=${DOCKER_HOST:-unix:///run/kailo-docker/docker.sock}
[ "$DOCKER_HOST" = unix:///run/kailo-docker/docker.sock ] || { echo "dep-cache: DOCKER_HOST must be the Kailo dockerd" >&2; exit 2; }
DEP_CACHE_DATA=${DEP_CACHE_DATA:-/volumes/data/kailo/capacity/dep-cache}
DEP_CACHE_RUNTIME=${DEP_CACHE_RUNTIME:-/volumes/kailo/ci/dep-cache}
NPM_CACHE_PORT=${NPM_CACHE_PORT:-55002}
NPM_UPLINKS=${NPM_UPLINKS:-https://registry.npmmirror.com/ https://mirrors.cloud.tencent.com/npm/}
GO_CACHE_PORT=${GO_CACHE_PORT:-55003}
CRATES_CACHE_PORT=${CRATES_CACHE_PORT:-55007}
# Listen address of all three caches: the Kailo dockerd's kailo0 gateway, reachable from the host, host-network
# builds, and bridged containers and builds (their RUN steps), but not from the LAN (OPS-03).
DEP_CACHE_BIND=${DEP_CACHE_BIND:-10.239.0.1}
CRATES_INDEX_UPSTREAM=${CRATES_INDEX_UPSTREAM:-https://rsproxy.cn/index/}
CRATES_DL_UPSTREAM=${CRATES_DL_UPSTREAM:-https://lf9-static.rsproxy.cn/obj/rsproxy/crates/}
FILES_CACHE_PORT=${FILES_CACHE_PORT:-55008}
SCCACHE_CACHE_PORT=${SCCACHE_CACHE_PORT:-55010}
FILES_DEBIAN_UPSTREAM=${FILES_DEBIAN_UPSTREAM:-https://mirrors.tuna.tsinghua.edu.cn/debian/}
FILES_SECURITY_UPSTREAM=${FILES_SECURITY_UPSTREAM:-https://mirrors.tuna.tsinghua.edu.cn/debian-security/}
# The hosts the image builds download pinned files from (kailo-macro kailo/deploy/images/files-mirror.sh keeps the same
# list), plus the hosts GitHub redirects release and archive downloads to; api.github.com serves the repository
# tarballs bun installs github: dependencies from (GITHUB_API_URL).
FILES_HOSTS=${FILES_HOSTS:-github.com api.github.com objects.githubusercontent.com release-assets.githubusercontent.com codeload.github.com repo1.maven.org static.rust-lang.org nodejs.org}

die() { printf 'dep-cache: %s\n' "$*" >&2; exit 2; }

compose() {
  docker compose --project-directory "$DEP_CACHE_RUNTIME" -f "$DEP_CACHE_RUNTIME/compose.yaml" "$@"
}

install_runtime() {
  local stamp file
  mkdir -p "$DEP_CACHE_RUNTIME"
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  for file in compose.yaml verdaccio.yaml crates-nginx.conf files-nginx.conf sccache-nginx.conf .env; do
    [ -f "$DEP_CACHE_RUNTIME/$file" ] && cp -a "$DEP_CACHE_RUNTIME/$file" "$DEP_CACHE_RUNTIME/$file.bak-$stamp"
  done
  install -m 0644 "$here/compose.yaml" "$DEP_CACHE_RUNTIME/"
  # Verdaccio's uplinks from NPM_UPLINKS, tried in order: each package rule proxies through all of them.
  python3 -I - "$here/verdaccio.yaml" "$DEP_CACHE_RUNTIME/verdaccio.yaml.tmp" $NPM_UPLINKS <<'PY'
import re, sys
src, dst, urls = sys.argv[1], sys.argv[2], sys.argv[3:]
if not urls or any(not re.fullmatch(r"https://[^\s]+", u) for u in urls):
    sys.exit("NPM_UPLINKS must list https:// registry URLs")
text = open(src).read()
start, end = text.index("uplinks:"), text.index("packages:")
names = [f"up{i + 1}" for i in range(len(urls))]
block = "uplinks:\n" + "".join(
    f"  {n}:\n    url: {u.rstrip('/')}/\n    timeout: 60s\n    maxage: 30m\n    max_fails: 5\n    fail_timeout: 2m\n    cache: true\n"
    f"    agent_options:\n      keepAlive: true\n      maxSockets: 40\n" for n, u in zip(names, urls))
text = text[:start] + block + text[end:]
text = re.sub(r"^(\s+proxy:) npmjs$", lambda m: m.group(1) + " " + " ".join(names), text, flags=re.M)
open(dst, "w").write(text)
PY
  chmod 0644 "$DEP_CACHE_RUNTIME/verdaccio.yaml.tmp"
  mv "$DEP_CACHE_RUNTIME/verdaccio.yaml.tmp" "$DEP_CACHE_RUNTIME/verdaccio.yaml"
  # crates cache: nginx.conf from the template with the configured port and upstreams.
  local resolver
  resolver=$(awk '$1 == "nameserver" { print $2; exit }' /etc/resolv.conf)
  [ -n "$resolver" ] || die "no nameserver in /etc/resolv.conf for the crates cache"
  python3 -I - "$here/crates-nginx.conf" "$DEP_CACHE_RUNTIME/crates-nginx.conf.tmp" "$CRATES_CACHE_PORT" \
    "$CRATES_INDEX_UPSTREAM" "$CRATES_DL_UPSTREAM" "$resolver" "$DEP_CACHE_BIND" <<'PY'
import re, sys
src, dst, port, index, dl, resolver, bind = sys.argv[1:8]
for url in (index, dl):
    if not re.fullmatch(r"https://[^\s;'\"]+/", url):
        sys.exit("CRATES_INDEX_UPSTREAM / CRATES_DL_UPSTREAM must be https:// URLs ending in /")
text = open(src).read()
for key, value in (("@BIND@", bind), ("@PORT@", port), ("@INDEX_UPSTREAM@", index), ("@DL_UPSTREAM@", dl), ("@RESOLVER@", resolver),
                   ("@INDEX_MAX@", "5g"), ("@FILES_MAX@", "100g")):
    text = text.replace(key, value)
open(dst, "w").write(text)
PY
  chmod 0644 "$DEP_CACHE_RUNTIME/crates-nginx.conf.tmp"
  mv "$DEP_CACHE_RUNTIME/crates-nginx.conf.tmp" "$DEP_CACHE_RUNTIME/crates-nginx.conf"
  # file cache: nginx.conf from the template with the configured port, upstreams and hosts.
  python3 -I - "$here/files-nginx.conf" "$DEP_CACHE_RUNTIME/files-nginx.conf.tmp" "$FILES_CACHE_PORT" \
    "$FILES_DEBIAN_UPSTREAM" "$FILES_SECURITY_UPSTREAM" "$resolver" "$DEP_CACHE_BIND" $FILES_HOSTS <<'PY'
import re, sys
src, dst, port, debian, security, resolver, bind, *hosts = sys.argv[1:]
for url in (debian, security):
    if not re.fullmatch(r"https://[^\s;'\"]+/", url):
        sys.exit("FILES_DEBIAN_UPSTREAM / FILES_SECURITY_UPSTREAM must be https:// URLs ending in /")
if not hosts or any(not re.fullmatch(r"[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+", h) for h in hosts):
    sys.exit("FILES_HOSTS must list host names")
text = open(src).read()
for key, value in (("@BIND@", bind), ("@PORT@", port), ("@DEBIAN_UPSTREAM@", debian), ("@SECURITY_UPSTREAM@", security),
                   ("@RESOLVER@", resolver), ("@FILE_HOSTS_RE@", "|".join(re.escape(h) for h in hosts)),
                   ("@INDEX_MAX@", "5g"), ("@FILES_MAX@", "200g")):
    text = text.replace(key, value)
if "@" in re.sub(r"location @redirect|= @redirect", "", text.split("http {", 1)[1]):
    sys.exit("files-nginx.conf: unrendered placeholder")
open(dst, "w").write(text)
PY
  chmod 0644 "$DEP_CACHE_RUNTIME/files-nginx.conf.tmp"
  mv "$DEP_CACHE_RUNTIME/files-nginx.conf.tmp" "$DEP_CACHE_RUNTIME/files-nginx.conf"
  sed -e "s/@BIND@/$DEP_CACHE_BIND/" -e "s/@PORT@/$SCCACHE_CACHE_PORT/" "$here/sccache-nginx.conf" > "$DEP_CACHE_RUNTIME/sccache-nginx.conf.tmp"
  chmod 0644 "$DEP_CACHE_RUNTIME/sccache-nginx.conf.tmp"
  mv "$DEP_CACHE_RUNTIME/sccache-nginx.conf.tmp" "$DEP_CACHE_RUNTIME/sccache-nginx.conf"
  printf 'DEP_CACHE_DATA=%s\nDEP_CACHE_USER=%s\nDEP_CACHE_BIND=%s\nNPM_CACHE_PORT=%s\nGO_CACHE_PORT=%s\nCRATES_CACHE_PORT=%s\nFILES_CACHE_PORT=%s\nSCCACHE_CACHE_PORT=%s\n' \
    "$DEP_CACHE_DATA" "$(stat -c %u:%g "$DEP_CACHE_DATA")" "$DEP_CACHE_BIND" "$NPM_CACHE_PORT" "$GO_CACHE_PORT" "$CRATES_CACHE_PORT" "$FILES_CACHE_PORT" "$SCCACHE_CACHE_PORT" \
    > "$DEP_CACHE_RUNTIME/.env.tmp"
  chmod 0600 "$DEP_CACHE_RUNTIME/.env.tmp"
  mv "$DEP_CACHE_RUNTIME/.env.tmp" "$DEP_CACHE_RUNTIME/.env"
}

cmd_probe() {
  local npm="http://$DEP_CACHE_BIND:$NPM_CACHE_PORT" go="http://$DEP_CACHE_BIND:$GO_CACHE_PORT"
  curl -fsS --noproxy '*' -m 10 -o /dev/null "$npm/-/ping" || die "npm 缓存未在 $npm 响应"
  curl -fsS --noproxy '*' -m 10 -o /dev/null "$go/healthz" || die "Go 缓存未在 $go 响应"
  local crates="http://$DEP_CACHE_BIND:$CRATES_CACHE_PORT"
  curl -fsS --noproxy '*' -m 60 "$crates/index/se/rd/serde" | grep -q '"vers":"1.0.200"' || die "crates 缓存未返回 serde 的索引"
  curl -fsS --noproxy '*' -m 120 -o /dev/null "$crates/crates/serde/1.0.200.crate" || die "crates 缓存未返回 serde 1.0.200"
  echo "crates 缓存：serde 索引与 1.0.200 文件可取"
  local files="http://$DEP_CACHE_BIND:$FILES_CACHE_PORT"
  # grep reads the whole body (no -q): an early exit would fail curl's write under pipefail.
  curl -fsS --noproxy '*' -m 60 "$files/debian/dists/bookworm/InRelease" | grep -x 'Codename: bookworm' >/dev/null \
    || die "文件缓存未返回 Debian bookworm 的 InRelease"
  curl -fsS --noproxy '*' -m 60 "$files/debian-security/dists/bookworm-security/InRelease" | grep -x 'Codename: bookworm-security' >/dev/null \
    || die "文件缓存未返回 Debian bookworm-security 的 InRelease"
  curl -fsS --noproxy '*' -m 60 "$files/static.rust-lang.org/dist/channel-rust-1.94.0.toml.sha256" | grep -E '^[0-9a-f]{64} ' >/dev/null \
    || die "文件缓存未返回 rust 1.94.0 渠道清单的校验和"
  # A GitHub release asset: a redirect to the signed asset URL, followed by the cache (keycloak extension, 1.17.0).
  curl -fsS --noproxy '*' -m 180 -o /dev/null -w '%{http_code} %{size_download}\n' \
    "$files/github.com/klausbetz/apple-identity-provider-keycloak/releases/download/1.17.0/apple-identity-provider-1.17.0.jar" \
    | awk '$1 == 200 && $2 > 10000 { ok = 1 } END { exit !ok }' || die "文件缓存未返回 GitHub release 文件（跳转跟随）"
  echo "文件缓存：Debian 与安全更新索引、rust 渠道清单、GitHub release 文件可取"
  # The compile cache answers sccache's WebDAV calls: a put under a new directory, then the same bytes back.
  local sc="http://$DEP_CACHE_BIND:$SCCACHE_CACHE_PORT" probe
  probe=".probe/$(date +%s)-$$"
  curl -fsS --noproxy '*' -m 10 -X PUT --data-binary "kailo" "$sc/$probe" >/dev/null || die "编译缓存不接受写入（$sc）"
  [ "$(curl -fsS --noproxy '*' -m 10 "$sc/$probe")" = kailo ] || die "编译缓存读回的内容不一致（$sc）"
  curl -fsS --noproxy '*' -m 10 -X DELETE "$sc/$probe" >/dev/null || true
  echo "编译缓存：WebDAV 写入与读回可用"
  # 经缓存实际取内容（未命中即回源一次）：pnpm 的 packument 必须带 npm 原站的签名，Corepack 校验依赖它
  curl -fsS --noproxy '*' -m 180 "$npm/pnpm" | python3 -I -c '
import json, sys
doc = json.load(sys.stdin)
dist = doc["versions"][doc["dist-tags"]["latest"]]["dist"]
if not dist.get("integrity") or not dist.get("signatures"):
    sys.exit("npm 缓存返回的 packument 缺少 integrity 或 signatures")
print("npm 缓存：pnpm", doc["dist-tags"]["latest"], "packument 含 integrity 与原站签名")'
  curl -fsS --noproxy '*' -m 180 "$go/github.com/google/uuid/@v/list" | grep -qx 'v1.6.0' \
    || die "Go 缓存未返回 github.com/google/uuid 的版本列表"
  echo "Go 缓存：github.com/google/uuid 版本列表可取"
}

cmd_up() {
  [ -f "$apps/tools/container-safety.sh" ] || die "找不到 tools/container-safety.sh"
  # shellcheck source=../../container-safety.sh
  . "$apps/tools/container-safety.sh"
  mkdir -p "$DEP_CACHE_DATA/npm" "$DEP_CACHE_DATA/go" "$DEP_CACHE_DATA/crates" "$DEP_CACHE_DATA/files/tmp" "$DEP_CACHE_DATA/sccache/data" "$DEP_CACHE_DATA/sccache/.tmp"
  container_require_data_path "$DEP_CACHE_DATA" >/dev/null || die "缓存数据必须位于项目数据根：$DEP_CACHE_DATA"
  grep -q "\${NPM_CACHE_PORT:-$NPM_CACHE_PORT}" "$here/build-args.sh" && grep -q "\${GO_CACHE_PORT:-$GO_CACHE_PORT}" "$here/build-args.sh" \
    || die "build-args.sh 的缺省端口与 NPM_CACHE_PORT/GO_CACHE_PORT 不一致"
  local before crates_before files_before sccache_before
  before=$(sha256sum "$DEP_CACHE_RUNTIME/verdaccio.yaml" 2>/dev/null || true)
  crates_before=$(sha256sum "$DEP_CACHE_RUNTIME/crates-nginx.conf" 2>/dev/null || true)
  files_before=$(sha256sum "$DEP_CACHE_RUNTIME/files-nginx.conf" 2>/dev/null || true)
  sccache_before=$(sha256sum "$DEP_CACHE_RUNTIME/sccache-nginx.conf" 2>/dev/null || true)
  install_runtime
  compose config --quiet
  compose up -d --wait --wait-timeout 120
  # verdaccio.yaml is a single-file bind mount: a replaced file is only seen after the container is recreated.
  if [ "$before" != "$(sha256sum "$DEP_CACHE_RUNTIME/verdaccio.yaml")" ]; then
    compose up -d --force-recreate --wait --wait-timeout 120 npm
  fi
  if [ "$crates_before" != "$(sha256sum "$DEP_CACHE_RUNTIME/crates-nginx.conf")" ]; then
    compose up -d --force-recreate --wait --wait-timeout 120 crates
  fi
  if [ -n "$files_before" ] && [ "$files_before" != "$(sha256sum "$DEP_CACHE_RUNTIME/files-nginx.conf")" ]; then
    compose up -d --force-recreate --wait --wait-timeout 120 files
  fi
  if [ -n "$sccache_before" ] && [ "$sccache_before" != "$(sha256sum "$DEP_CACHE_RUNTIME/sccache-nginx.conf")" ]; then
    compose up -d --force-recreate --wait --wait-timeout 120 sccache
  fi
  cmd_probe
  printf '依赖缓存就绪：npm %s:%s、Go %s:%s、crates %s:%s、文件 %s:%s，数据 %s，运行副本 %s\n' \
    "$DEP_CACHE_BIND" "$NPM_CACHE_PORT" "$DEP_CACHE_BIND" "$GO_CACHE_PORT" "$DEP_CACHE_BIND" "$CRATES_CACHE_PORT" "$DEP_CACHE_BIND" "$FILES_CACHE_PORT" \
    "$DEP_CACHE_DATA" "$DEP_CACHE_RUNTIME"
}

cmd_status() {
  compose ps
  du -sh "$DEP_CACHE_DATA"/npm "$DEP_CACHE_DATA"/go "$DEP_CACHE_DATA"/crates "$DEP_CACHE_DATA"/files 2>/dev/null || true
  findmnt -n -o SOURCE --target "$DEP_CACHE_DATA"
  curl -sS --noproxy '*' -m 5 -o /dev/null -w "npm /-/ping HTTP %{http_code}\n" "http://$DEP_CACHE_BIND:$NPM_CACHE_PORT/-/ping" || true
  curl -sS --noproxy '*' -m 5 -o /dev/null -w "go /healthz HTTP %{http_code}\n" "http://$DEP_CACHE_BIND:$GO_CACHE_PORT/healthz" || true
  curl -sS --noproxy '*' -m 5 -o /dev/null -w "files /healthz HTTP %{http_code}\n" "http://$DEP_CACHE_BIND:$FILES_CACHE_PORT/healthz" || true
}

case "${1:-}" in
  up) shift; cmd_up "$@" ;;
  status) shift; cmd_status "$@" ;;
  probe) shift; cmd_probe "$@" ;;
  down) shift; compose down ;;
  *) sed -n '2,17p' "$0" >&2; exit 2 ;;
esac
