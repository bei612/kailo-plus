#!/usr/bin/env bash
# Kailo CI 节点：镜像构建的依赖下载缓存（npm、Go 模块、crates、构建下载文件、编译缓存、PyPI、PyTorch CPU 索引、Hugging Face）。用途、数据位置与回源方式见 07-运行与运维基线.md §2.1。
#
# 用法（在 CI 节点以 ubuntu 身份，从仓库检出或固定发布树执行）：
#   tools/ci/dep-cache/setup.sh up        安装运行副本、启动/更新各缓存并等待 healthy，再经缓存实际取一次各类样本（probe）
#   tools/ci/dep-cache/setup.sh status    读回容器、健康、数据目录与占用
#   tools/ci/dep-cache/setup.sh probe     经缓存取样本：pnpm packument、Go 版本列表、crates、Debian/rust/GitHub 文件、编译缓存读写、
#                                         PyPI six 轮子（sha256）、PyTorch +cpu 轮子元数据、HF repo_info/树列表/普通与 LFS 文件
#   tools/ci/dep-cache/setup.sh env       打印镜像构建用的 kailo.env 设置（只列健康的缓存：KAILO_PYPI_MIRROR、KAILO_TORCH_INDEX、…）
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
#   SCCACHE_CACHE_PORT        镜像构建共享 Rust 编译缓存端口（默认 55010）：sccache 的 WebDAV 后端（Apache mod_dav），数据在 4T：
#                             $DEP_CACHE_DATA/sccache，容量由 hot-retention 管理
#   PYPI_CACHE_PORT           PyPI 缓存端口（默认 55011，proxpi；简单索引 http://<bind>:<port>/index/，kailo-macro KAILO_PYPI_MIRROR）。
#                             数据在 4T：$DEP_CACHE_DATA/pypi，上限 PYPI_CACHE_BYTES（默认 60 GiB，超过按最少使用淘汰）
#   PYPI_UPSTREAM             PyPI 简单索引上游（默认 https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple/）
#   TORCH_CACHE_PORT          PyTorch CPU 轮子索引缓存端口（默认 55013，proxpi；http://<bind>:<port>/index/，KAILO_TORCH_INDEX）。
#                             数据在 4T：$DEP_CACHE_DATA/torch，上限 TORCH_CACHE_BYTES（默认 30 GiB）
#   TORCH_UPSTREAM            PyTorch 索引上游（默认 https://download.pytorch.org/whl/cpu/）
#   HF_CACHE_PORT             Hugging Face 缓存端口（默认 55012，nginx；HF_ENDPOINT http://<bind>:<port>，KAILO_HF_MIRROR）。
#                             数据在 4T：$DEP_CACHE_DATA/hf（文件 100g、API 1g 上限，nginx 按最久未用淘汰）
#   HF_UPSTREAM               Hub 上游（默认 https://hf-mirror.com；其跳转，包括到 huggingface.co 与 CDN，由缓存自己跟随）
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
PYPI_CACHE_PORT=${PYPI_CACHE_PORT:-55011}
PYPI_UPSTREAM=${PYPI_UPSTREAM:-https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple/}
PYPI_CACHE_BYTES=${PYPI_CACHE_BYTES:-64424509440}
TORCH_CACHE_PORT=${TORCH_CACHE_PORT:-55013}
TORCH_UPSTREAM=${TORCH_UPSTREAM:-https://download.pytorch.org/whl/cpu/}
TORCH_CACHE_BYTES=${TORCH_CACHE_BYTES:-32212254720}
HF_CACHE_PORT=${HF_CACHE_PORT:-55012}
HF_UPSTREAM=${HF_UPSTREAM:-https://hf-mirror.com}
FILES_DEBIAN_UPSTREAM=${FILES_DEBIAN_UPSTREAM:-https://mirrors.tuna.tsinghua.edu.cn/debian/}
FILES_SECURITY_UPSTREAM=${FILES_SECURITY_UPSTREAM:-https://mirrors.tuna.tsinghua.edu.cn/debian-security/}
# The hosts the image builds download pinned files from (kailo-macro kailo/deploy/images/files-mirror.sh keeps the same
# list), plus the hosts GitHub redirects release and archive downloads to; api.github.com serves the repository
# tarballs bun installs github: dependencies from (GITHUB_API_URL).
FILES_HOSTS=${FILES_HOSTS:-github.com api.github.com objects.githubusercontent.com release-assets.githubusercontent.com codeload.github.com repo1.maven.org static.rust-lang.org nodejs.org artifacts.opensearch.org}

die() { printf 'dep-cache: %s\n' "$*" >&2; exit 2; }

compose() {
  docker compose --project-directory "$DEP_CACHE_RUNTIME" -f "$DEP_CACHE_RUNTIME/compose.yaml" "$@"
}

install_runtime() {
  local stamp file
  mkdir -p "$DEP_CACHE_RUNTIME"
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  for file in compose.yaml verdaccio.yaml crates-nginx.conf files-nginx.conf hf-nginx.conf sccache-httpd.conf .env; do
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
  sed -e "s/@BIND@/$DEP_CACHE_BIND/" -e "s/@PORT@/$SCCACHE_CACHE_PORT/" "$here/sccache-httpd.conf" > "$DEP_CACHE_RUNTIME/sccache-httpd.conf.tmp"
  chmod 0644 "$DEP_CACHE_RUNTIME/sccache-httpd.conf.tmp"
  mv "$DEP_CACHE_RUNTIME/sccache-httpd.conf.tmp" "$DEP_CACHE_RUNTIME/sccache-httpd.conf"
  # Hugging Face cache: nginx.conf from the template with the configured port and upstream origin.
  python3 -I - "$here/hf-nginx.conf" "$DEP_CACHE_RUNTIME/hf-nginx.conf.tmp" "$HF_CACHE_PORT" "$HF_UPSTREAM" "$resolver" "$DEP_CACHE_BIND" <<'PY'
import re, sys
src, dst, port, origin, resolver, bind = sys.argv[1:7]
if not re.fullmatch(r"https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]+)?", origin):
    sys.exit("HF_UPSTREAM must be an https:// origin without a path, e.g. https://hf-mirror.com")
text = open(src).read()
for key, value in (("@BIND@", bind), ("@PORT@", port), ("@HF_ORIGIN@", origin), ("@RESOLVER@", resolver),
                   ("@API_MAX@", "1g"), ("@FILES_MAX@", "100g")):
    text = text.replace(key, value)
if re.search(r"@[A-Z_]+@", text):
    sys.exit("hf-nginx.conf: unrendered placeholder")
open(dst, "w").write(text)
PY
  chmod 0644 "$DEP_CACHE_RUNTIME/hf-nginx.conf.tmp"
  mv "$DEP_CACHE_RUNTIME/hf-nginx.conf.tmp" "$DEP_CACHE_RUNTIME/hf-nginx.conf"
  # PyPI and PyTorch caches (proxpi): configured through compose's environment from .env.
  local url
  for url in "$PYPI_UPSTREAM" "$TORCH_UPSTREAM"; do
    [[ $url =~ ^https://[^[:space:]\'\"]+/$ ]] || die "PYPI_UPSTREAM / TORCH_UPSTREAM must be https:// simple-index URLs ending in /"
  done
  [[ $PYPI_CACHE_BYTES =~ ^[1-9][0-9]*$ && $TORCH_CACHE_BYTES =~ ^[1-9][0-9]*$ ]] || die "PYPI_CACHE_BYTES / TORCH_CACHE_BYTES must be byte counts"
  {
    printf 'DEP_CACHE_DATA=%s\nDEP_CACHE_USER=%s\nDEP_CACHE_BIND=%s\nNPM_CACHE_PORT=%s\nGO_CACHE_PORT=%s\nCRATES_CACHE_PORT=%s\nFILES_CACHE_PORT=%s\nSCCACHE_CACHE_PORT=%s\n' \
      "$DEP_CACHE_DATA" "$(stat -c %u:%g "$DEP_CACHE_DATA")" "$DEP_CACHE_BIND" "$NPM_CACHE_PORT" "$GO_CACHE_PORT" "$CRATES_CACHE_PORT" "$FILES_CACHE_PORT" "$SCCACHE_CACHE_PORT"
    printf 'PYPI_CACHE_PORT=%s\nPYPI_UPSTREAM=%s\nPYPI_CACHE_BYTES=%s\nTORCH_CACHE_PORT=%s\nTORCH_UPSTREAM=%s\nTORCH_CACHE_BYTES=%s\nHF_CACHE_PORT=%s\n' \
      "$PYPI_CACHE_PORT" "$PYPI_UPSTREAM" "$PYPI_CACHE_BYTES" "$TORCH_CACHE_PORT" "$TORCH_UPSTREAM" "$TORCH_CACHE_BYTES" "$HF_CACHE_PORT"
  } > "$DEP_CACHE_RUNTIME/.env.tmp"
  chmod 0600 "$DEP_CACHE_RUNTIME/.env.tmp"
  mv "$DEP_CACHE_RUNTIME/.env.tmp" "$DEP_CACHE_RUNTIME/.env"
}

probe_python_indexes() {
  # PyPI: the simple index of six links back to this cache, and the file comes from it (200, no redirect to the
  # upstream) with the sha256 the index names.
  local pypi="http://$DEP_CACHE_BIND:$PYPI_CACHE_PORT/index" torch="http://$DEP_CACHE_BIND:$TORCH_CACHE_PORT/index"
  curl -fsS --noproxy '*' -m 10 -o /dev/null "http://$DEP_CACHE_BIND:$PYPI_CACHE_PORT/health" || die "PyPI 缓存未在 $pypi 响应"
  curl -fsS --noproxy '*' -m 10 -o /dev/null "http://$DEP_CACHE_BIND:$TORCH_CACHE_PORT/health" || die "PyTorch 索引缓存未在 $torch 响应"
  python3 -I - "$pypi" six 'six-1.17.0-py2.py3-none-any.whl' "$torch" torch <<'PY' || die "PyPI / PyTorch 索引缓存的校验未通过"
import hashlib, re, sys, urllib.request
pypi, project, filename, torch, torch_project = sys.argv[1:6]
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):  # a redirect would send the build to the upstream
        return None
strict = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect)

def links(index, name):
    # Ask as pip does (PEP 691): proxpi answers a request without a simple-index media type with 406.
    req = urllib.request.Request(f"{index}/{name}/", headers={
        "Accept": "application/vnd.pypi.simple.v1+html, text/html;q=0.01"})
    html = opener.open(req, timeout=180).read().decode()
    return re.findall(r'<a href="([^"#]+)(?:#([^"]*))?"([^>]*)>', html)

def fetch(index, name, href):
    if "://" in href:
        sys.exit(f"{index}/{name}/ links outside the cache: {href}")
    with strict.open(f"{index}/{name}/{href}", timeout=600) as r:
        if r.status != 200:
            sys.exit(f"{href}: HTTP {r.status}")
        return r.read()

found = [(h, f) for h, f, _ in links(pypi, project) if h == filename]
if not found or not found[0][1].startswith("sha256="):
    sys.exit(f"PyPI 缓存的 {project} 索引缺少 {filename}（带 sha256）")
body = fetch(pypi, project, filename)
if hashlib.sha256(body).hexdigest() != found[0][1][7:]:
    sys.exit(f"{filename} 的 sha256 与索引不一致")
print(f"PyPI 缓存：{project} 索引与 {filename}（{len(body)} 字节，sha256 一致）可取")

# PyTorch CPU index: torch's +cpu wheels are listed; the core metadata of the newest x86_64 one (a small file on
# download-r2.pytorch.org) comes through the cache with the hash the index names.
cpu = [(h, a) for h, _, a in links(torch, torch_project) if re.fullmatch(r"torch-[0-9.]+\+cpu-cp3\d+-cp3\d+-manylinux[^\"]*x86_64\.whl", h)]
meta = [(h, m.group(1)) for h, a in cpu for m in [re.search(r'data-(?:core|dist-info)-metadata="sha256=([0-9a-f]{64})"', a)] if m]
if not meta:
    sys.exit("PyTorch 索引缓存没有带元数据哈希的 torch +cpu x86_64 轮子")
href, digest = meta[-1]
body = fetch(torch, torch_project, href + ".metadata")
if hashlib.sha256(body).hexdigest() != digest:
    sys.exit(f"{href}.metadata 的 sha256 与索引不一致")
print(f"PyTorch 索引缓存：{len(cpu)} 个 torch +cpu x86_64 轮子，{href} 的元数据可取（sha256 一致）")
PY
}

probe_hf() {
  # Hugging Face: repo_info and a regular file (the Hub's relative redirect), and a small LFS/Xet file in full (the
  # CDN redirect, followed by the cache): Hub headers present, no Xet headers, content matching X-Linked-Etag (sha256).
  local hf="http://$DEP_CACHE_BIND:$HF_CACHE_PORT"
  curl -fsS --noproxy '*' -m 10 -o /dev/null "$hf/healthz" || die "Hugging Face 缓存未在 $hf 响应"
  python3 -I - "$hf" <<'PY' || die "Hugging Face 缓存的校验未通过"
import hashlib, json, sys, urllib.request
hf = sys.argv[1]
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect)

def get(path, method="GET"):
    req = urllib.request.Request(hf + path, method=method, headers={"Accept-Encoding": "identity"})
    with opener.open(req, timeout=600) as r:
        if r.status != 200:
            sys.exit(f"{path}: HTTP {r.status}")
        return r.headers, r.read()

_, body = get("/api/models/Systran/faster-whisper-small/revision/main")
sha = json.loads(body)["sha"]
_, tree = get(f"/api/models/hf-internal-testing/tiny-random-bert/tree/main")
if b'"xetHash"' in tree:
    sys.exit("树列表仍含 xetHash")
for path, lfs in (("Systran/faster-whisper-small/resolve/main/config.json", False),
                  ("hf-internal-testing/tiny-random-bert/resolve/main/pytorch_model.bin", True)):
    for method in ("HEAD", "GET"):
        headers, body = get("/" + path, method)
        if not headers.get("X-Repo-Commit") or not (headers.get("X-Linked-Etag") or headers.get("ETag")):
            sys.exit(f"{method} {path}: 缺少 X-Repo-Commit / ETag")
        if any(k.lower().startswith("x-xet-") for k in headers) or "xet" in headers.get("Link", ""):
            sys.exit(f"{method} {path}: 带有 Xet 头")
    if path.startswith("Systran/") and headers["X-Repo-Commit"] != sha:
        sys.exit(f"{path}: X-Repo-Commit {headers['X-Repo-Commit']} 与 repo_info {sha} 不一致")
    if lfs and hashlib.sha256(body).hexdigest() != headers["X-Linked-Etag"].strip('"'):
        sys.exit(f"{path}: 内容的 sha256 与 X-Linked-Etag 不一致")
    if headers.get("X-Linked-Size") and int(headers["X-Linked-Size"]) != len(body):
        sys.exit(f"{path}: 长度与 X-Linked-Size 不一致")
print(f"Hugging Face 缓存：repo_info（{sha[:12]}）、树列表、config.json 与 LFS 文件 pytorch_model.bin（{len(body)} 字节，sha256 一致）可取")
PY
}

sccache_dav() {  # curl 参数… → 打印 HTTP 状态码（连接失败为 000），不打印响应体
  curl -sS --noproxy '*' -m 10 -o /dev/null -w '%{http_code}' "$@" || true
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
  # The compile cache answers the calls sccache's WebDAV client (opendal) makes for one entry: MKCOL of the parent
  # collections, PUT, PROPFIND (stat), GET of the same bytes; then DELETE (the probe removes what it wrote).
  local sc="http://$DEP_CACHE_BIND:$SCCACHE_CACHE_PORT" probe code
  probe="$sc/.probe/$(date +%s)-$$"
  code=$(sccache_dav -X MKCOL "$sc/.probe/")
  case $code in 201|405) ;; *) die "编译缓存不接受 MKCOL（$sc/.probe/：HTTP $code）" ;; esac  # 405: exists
  code=$(sccache_dav -X MKCOL "$probe/"); [ "$code" = 201 ] || die "编译缓存不接受 MKCOL（$probe/：HTTP $code）"
  code=$(sccache_dav -X PUT --data-binary kailo "$probe/entry")
  case $code in 201|204) ;; *) die "编译缓存不接受写入（$probe/entry：HTTP $code）" ;; esac
  code=$(sccache_dav -X PROPFIND -H 'Depth: 0' "$probe/entry"); [ "$code" = 207 ] || die "编译缓存 PROPFIND 失败（HTTP $code）"
  [ "$(curl -fsS --noproxy '*' -m 10 "$probe/entry")" = kailo ] || die "编译缓存读回的内容不一致（$probe/entry）"
  code=$(sccache_dav -X DELETE "$probe/"); [ "$code" = 204 ] || die "编译缓存不接受删除（$probe/：HTTP $code）"
  code=$(sccache_dav "$probe/entry"); [ "$code" = 404 ] || die "编译缓存删除后仍可读（$probe/entry：HTTP $code）"
  echo "编译缓存：WebDAV MKCOL、PUT、PROPFIND、GET、DELETE 可用"
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
  probe_python_indexes
  probe_hf
}

cmd_up() {
  [ -f "$apps/tools/container-safety.sh" ] || die "找不到 tools/container-safety.sh"
  # shellcheck source=../../container-safety.sh
  . "$apps/tools/container-safety.sh"
  mkdir -p "$DEP_CACHE_DATA/npm" "$DEP_CACHE_DATA/go" "$DEP_CACHE_DATA/crates" "$DEP_CACHE_DATA/files/tmp" "$DEP_CACHE_DATA/sccache/data" "$DEP_CACHE_DATA/sccache/.tmp" \
    "$DEP_CACHE_DATA/pypi" "$DEP_CACHE_DATA/torch" "$DEP_CACHE_DATA/hf/tmp"
  container_require_data_path "$DEP_CACHE_DATA" >/dev/null || die "缓存数据必须位于项目数据根：$DEP_CACHE_DATA"
  grep -q "\${NPM_CACHE_PORT:-$NPM_CACHE_PORT}" "$here/build-args.sh" && grep -q "\${GO_CACHE_PORT:-$GO_CACHE_PORT}" "$here/build-args.sh" \
    || die "build-args.sh 的缺省端口与 NPM_CACHE_PORT/GO_CACHE_PORT 不一致"
  local port_var
  for port_var in PYPI_CACHE_PORT TORCH_CACHE_PORT HF_CACHE_PORT; do
    grep -q "\${$port_var:-${!port_var}}" "$here/build-args.sh" || die "build-args.sh 的缺省端口与 $port_var 不一致"
  done
  local before crates_before files_before sccache_before hf_before
  before=$(sha256sum "$DEP_CACHE_RUNTIME/verdaccio.yaml" 2>/dev/null || true)
  crates_before=$(sha256sum "$DEP_CACHE_RUNTIME/crates-nginx.conf" 2>/dev/null || true)
  files_before=$(sha256sum "$DEP_CACHE_RUNTIME/files-nginx.conf" 2>/dev/null || true)
  sccache_before=$(sha256sum "$DEP_CACHE_RUNTIME/sccache-httpd.conf" 2>/dev/null || true)
  hf_before=$(sha256sum "$DEP_CACHE_RUNTIME/hf-nginx.conf" 2>/dev/null || true)
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
  if [ -n "$sccache_before" ] && [ "$sccache_before" != "$(sha256sum "$DEP_CACHE_RUNTIME/sccache-httpd.conf")" ]; then
    compose up -d --force-recreate --wait --wait-timeout 120 sccache
  fi
  if [ -n "$hf_before" ] && [ "$hf_before" != "$(sha256sum "$DEP_CACHE_RUNTIME/hf-nginx.conf")" ]; then
    compose up -d --force-recreate --wait --wait-timeout 120 hf
  fi
  cmd_probe
  printf '依赖缓存就绪：npm %s:%s、Go %s:%s、crates %s:%s、文件 %s:%s、PyPI %s:%s、PyTorch %s:%s、Hugging Face %s:%s，数据 %s，运行副本 %s\n' \
    "$DEP_CACHE_BIND" "$NPM_CACHE_PORT" "$DEP_CACHE_BIND" "$GO_CACHE_PORT" "$DEP_CACHE_BIND" "$CRATES_CACHE_PORT" "$DEP_CACHE_BIND" "$FILES_CACHE_PORT" \
    "$DEP_CACHE_BIND" "$PYPI_CACHE_PORT" "$DEP_CACHE_BIND" "$TORCH_CACHE_PORT" "$DEP_CACHE_BIND" "$HF_CACHE_PORT" \
    "$DEP_CACHE_DATA" "$DEP_CACHE_RUNTIME"
}

cmd_status() {
  compose ps
  du -sh "$DEP_CACHE_DATA"/npm "$DEP_CACHE_DATA"/go "$DEP_CACHE_DATA"/crates "$DEP_CACHE_DATA"/files \
    "$DEP_CACHE_DATA"/pypi "$DEP_CACHE_DATA"/torch "$DEP_CACHE_DATA"/hf 2>/dev/null || true
  findmnt -n -o SOURCE --target "$DEP_CACHE_DATA"
  curl -sS --noproxy '*' -m 5 -o /dev/null -w "npm /-/ping HTTP %{http_code}\n" "http://$DEP_CACHE_BIND:$NPM_CACHE_PORT/-/ping" || true
  curl -sS --noproxy '*' -m 5 -o /dev/null -w "go /healthz HTTP %{http_code}\n" "http://$DEP_CACHE_BIND:$GO_CACHE_PORT/healthz" || true
  curl -sS --noproxy '*' -m 5 -o /dev/null -w "files /healthz HTTP %{http_code}\n" "http://$DEP_CACHE_BIND:$FILES_CACHE_PORT/healthz" || true
  curl -sS --noproxy '*' -m 5 -o /dev/null -w "pypi /health HTTP %{http_code}\n" "http://$DEP_CACHE_BIND:$PYPI_CACHE_PORT/health" || true
  curl -sS --noproxy '*' -m 5 -o /dev/null -w "torch /health HTTP %{http_code}\n" "http://$DEP_CACHE_BIND:$TORCH_CACHE_PORT/health" || true
  curl -sS --noproxy '*' -m 5 -o /dev/null -w "hf /healthz HTTP %{http_code}\n" "http://$DEP_CACHE_BIND:$HF_CACHE_PORT/healthz" || true
}

case "${1:-}" in
  up) shift; cmd_up "$@" ;;
  status) shift; cmd_status "$@" ;;
  probe) shift; cmd_probe "$@" ;;
  down) shift; compose down ;;
  env) shift; . "$here/build-args.sh"; dependency_cache_kailo_env ;;
  *) sed -n '2,11p' "$0" >&2; exit 2 ;;
esac
