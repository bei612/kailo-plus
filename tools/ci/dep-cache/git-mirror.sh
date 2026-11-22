#!/usr/bin/env bash
# Kailo CI 节点：image builds 的 git 依赖镜像（cargo / bun 锁文件里的 git 源）。用途与数据位置见 07-运行与运维基线.md §2.1。
#
# 构建不联网取 git 依赖：kailo-macro 的构建以 GIT_MIRROR=git://10.239.0.1:55009/ 把 https://github.com/<owner>/<repo>
# 改写到这里（kailo/deploy/images/git-mirror.sh，git CLI 的 url.insteadOf）。镜像是 `git clone --mirror` 的裸仓库，布局
# <data>/<host>/<owner>/<repo>.git，由宿主机 git daemon（kailo-git-mirror.service，只读、只监听 kailo0 网关）提供。
# 锁文件把每个 git 依赖固定到一个提交：部署在构建前 sync 一次，镜像缺这个提交时才回源取，已有的不联网。
#
# 用法（CI 节点，ubuntu 身份）：
#   tools/ci/dep-cache/git-mirror.sh sync <Cargo.lock|bun.lock|codex:<commit>>...
#                                     确保锁文件里每个 git 依赖的提交都在镜像里（缺仓库则 clone --mirror，缺提交则 fetch）；
#                                     codex:<commit> 取 openai/codex 该提交归档里的 codex-rs/Cargo.lock（经文件缓存）
#   tools/ci/dep-cache/git-mirror.sh refresh    所有镜像 fetch 一次（不要求，供手工更新）
#   tools/ci/dep-cache/git-mirror.sh install    安装并启动 kailo-git-mirror.service（git daemon），探测可取
#   tools/ci/dep-cache/git-mirror.sh status     服务状态、镜像清单与占用
#
# 可覆盖的环境变量：
#   GIT_MIRROR_DATA   镜像根（默认 /volumes/data/kailo/capacity/dep-cache/git，4T 容量盘）
#   GIT_MIRROR_BIND   监听地址（默认 10.239.0.1，Kailo dockerd 的 kailo0 网关；bridge 网络的构建可达，不暴露到局域网）
#   GIT_MIRROR_PORT   端口（默认 55009，须与 kailo-macro kailo-env.template 的 KAILO_GIT_MIRROR 一致）
#   FILES_MIRROR      文件缓存（默认 http://10.239.0.1:55008），codex:<commit> 取归档用
# 出网：只在 sync 缺提交时直连 github.com（路由器 OpenWrt 透明代理负责）；不读取、不写入任何代理设置（OPS-02）。
set -euo pipefail

GIT_MIRROR_DATA=${GIT_MIRROR_DATA:-/volumes/data/kailo/capacity/dep-cache/git}
GIT_MIRROR_BIND=${GIT_MIRROR_BIND:-10.239.0.1}
GIT_MIRROR_PORT=${GIT_MIRROR_PORT:-55009}
FILES_MIRROR=${FILES_MIRROR:-http://10.239.0.1:55008}
UNIT=kailo-git-mirror.service

die() { printf 'git-mirror: %s\n' "$*" >&2; exit 2; }
log() { printf 'git-mirror: %s\n' "$*"; }

# <tries> <command...>: GitHub over the node's link drops TLS sessions now and then (2026-11-22: libgit2 SSL error).
retry() {
  local n=$1 i=1; shift
  until "$@"; do
    [ "$i" -ge "$n" ] && return 1
    log "retry $i/$n in $((i * 15))s: $*"
    sleep $((i * 15)); i=$((i + 1))
  done
}

# Lock file -> "<https url> <commit>" lines (url without .git, query and fragment).
pins() {
  local f=$1
  case "$(basename "$f")" in
    Cargo.lock)
      # source = "git+https://github.com/o/r?rev=...#<sha>" | "git+https://github.com/o/r.git?branch=x#<sha>" | "...#<sha>"
      grep -oE '^source = "git\+https://[^"]+#[0-9a-f]{40}"' "$f" \
        | sed -E 's/^source = "git\+(https:\/\/[^?#"]+)[^#]*#([0-9a-f]{40})"$/\1 \2/' ;;
    bun.lock)
      # "git+https://github.com/o/r.git#<sha>"; github:o/r#<sha> is fetched as a tarball by bun, not by git
      grep -oE '"git\+https://[^"#]+#[0-9a-f]{40}"' "$f" \
        | sed -E 's/^"git\+(https:\/\/[^"#]+)#([0-9a-f]{40})"$/\1 \2/' ;;
    *) die "unsupported lock file: $f" ;;
  esac | sed -E 's#\.git ([0-9a-f]{40})$# \1#' | sort -u
}

# codex:<commit> -> the codex-rs lock file of that commit's archive (same URL the codex-agent image build downloads).
codex_lock() {
  local commit=$1 out=$2
  [[ $commit =~ ^[0-9a-f]{40}$ ]] || die "codex:<commit> needs a full commit id: $commit"
  retry 3 sh -c 'curl -fsSL --noproxy "*" -m 900 "$1" | tar -xzO --wildcards "*/codex-rs/Cargo.lock" > "$2"' _ \
    "${FILES_MIRROR%/}/codeload.github.com/openai/codex/tar.gz/$commit" "$out" || die "codex $commit: no codex-rs/Cargo.lock"
  [ -s "$out" ] || die "codex $commit: empty codex-rs/Cargo.lock"
}

mirror_dir() {  # https://github.com/o/r -> <data>/github.com/o/r.git
  local rest=${1#https://}
  [[ $rest =~ ^[a-z0-9.-]+/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]] || die "unexpected git URL: $1"
  printf '%s/%s.git' "$GIT_MIRROR_DATA" "$rest"
}

ensure() {  # <https url> <commit>
  local url=$1 commit=$2 dir
  dir=$(mirror_dir "$url")
  if [ -d "$dir" ] && git -C "$dir" cat-file -e "$commit^{commit}" 2>/dev/null; then
    return 0
  fi
  if [ ! -d "$dir" ]; then
    log "clone --mirror $url"
    mkdir -p "$(dirname "$dir")"
    rm -rf "$dir.tmp"
    retry 3 git clone -q --mirror "$url.git" "$dir.tmp" || die "clone failed: $url"
    # cargo fetches pinned revisions by object id; git daemon serves them only with this set.
    git -C "$dir.tmp" config uploadpack.allowAnySHA1InWant true
    git -C "$dir.tmp" config gc.auto 0
    mv "$dir.tmp" "$dir"
  else
    log "fetch $url (missing $commit)"
    retry 3 git -C "$dir" fetch -q --prune origin || die "fetch failed: $url"
  fi
  if ! git -C "$dir" cat-file -e "$commit^{commit}" 2>/dev/null; then
    # A commit no branch or tag reaches any more (force-pushed branch): GitHub still serves it by id.
    retry 3 git -C "$dir" fetch -q origin "$commit" || true
    git -C "$dir" cat-file -e "$commit^{commit}" 2>/dev/null || die "$url has no commit $commit"
    git -C "$dir" update-ref "refs/kailo/pinned/$commit" "$commit"
  fi
  # git daemon exports a repository only with this marker (no --export-all).
  touch "$dir/git-daemon-export-ok"
}

cmd_sync() {
  [ $# -gt 0 ] || die "sync needs lock files"
  local tmp f n=0 url commit
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' RETURN
  for f in "$@"; do
    case "$f" in
      codex:*) codex_lock "${f#codex:}" "$tmp/Cargo.lock"; f=$tmp/Cargo.lock ;;
      *) [ -f "$f" ] || die "no such lock file: $f" ;;
    esac
    pins "$f" >> "$tmp/pins"
  done
  sort -u -o "$tmp/pins" "$tmp/pins"
  while read -r url commit; do
    ensure "$url" "$commit"; n=$((n + 1))
  done < "$tmp/pins"
  log "$n pinned git dependencies present ($(cut -d' ' -f1 "$tmp/pins" | sort -u | wc -l) repositories)"
}

cmd_refresh() {
  local dir
  find "$GIT_MIRROR_DATA" -mindepth 3 -maxdepth 3 -type d -name '*.git' | while read -r dir; do
    log "fetch ${dir#"$GIT_MIRROR_DATA"/}"
    retry 3 git -C "$dir" fetch -q --prune origin || log "fetch failed: $dir"
  done
}

cmd_install() {
  mkdir -p "$GIT_MIRROR_DATA"
  local user group
  user=$(stat -c %U "$GIT_MIRROR_DATA"); group=$(stat -c %G "$GIT_MIRROR_DATA")
  sudo -n tee "/etc/systemd/system/$UNIT" >/dev/null <<EOF
[Unit]
Description=Kailo CI git dependency mirror (read-only git daemon over $GIT_MIRROR_DATA)
Documentation=file://$(cd "$(dirname "$0")" && pwd)/git-mirror.sh
After=network-online.target
Wants=network-online.target
RequiresMountsFor=$GIT_MIRROR_DATA

[Service]
User=$user
Group=$group
ExecStart=/usr/bin/git daemon --reuseaddr --base-path=$GIT_MIRROR_DATA --listen=$GIT_MIRROR_BIND --port=$GIT_MIRROR_PORT --max-connections=64 --timeout=300 --init-timeout=30 $GIT_MIRROR_DATA
# No user configuration (ProtectHome hides it): git reads none instead of warning on every request.
Environment=HOME=/var/empty XDG_CONFIG_HOME=/var/empty GIT_CONFIG_NOSYSTEM=1
Restart=always
RestartSec=5
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ReadOnlyPaths=$GIT_MIRROR_DATA
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_INET AF_UNIX
LockPersonality=yes
MemoryMax=1G

[Install]
WantedBy=multi-user.target
EOF
  sudo -n systemctl daemon-reload
  sudo -n systemctl enable -q "$UNIT"
  sudo -n systemctl restart "$UNIT"
  sleep 1
  systemctl is-active -q "$UNIT" || die "$UNIT is not active"
  cmd_probe
}

cmd_probe() {
  local first
  first=$(find "$GIT_MIRROR_DATA" -mindepth 3 -maxdepth 3 -type d -name '*.git' -print -quit)
  if [ -z "$first" ]; then log "git daemon up on git://$GIT_MIRROR_BIND:$GIT_MIRROR_PORT/ (no mirrors yet)"; return 0; fi
  git ls-remote "git://$GIT_MIRROR_BIND:$GIT_MIRROR_PORT/${first#"$GIT_MIRROR_DATA"/}" HEAD >/dev/null \
    || die "git daemon does not serve ${first#"$GIT_MIRROR_DATA"/}"
  log "git daemon serves git://$GIT_MIRROR_BIND:$GIT_MIRROR_PORT/${first#"$GIT_MIRROR_DATA"/}"
}

cmd_status() {
  systemctl status --no-pager -n 0 "$UNIT" || true
  find "$GIT_MIRROR_DATA" -mindepth 3 -maxdepth 3 -type d -name '*.git' -printf '%P\n' | sort
  du -sh "$GIT_MIRROR_DATA" 2>/dev/null || true
}

case "${1:-}" in
  sync) shift; cmd_sync "$@" ;;
  refresh) shift; cmd_refresh ;;
  install) shift; cmd_install ;;
  probe) shift; cmd_probe ;;
  status) shift; cmd_status ;;
  *) sed -n '2,22p' "$0" >&2; exit 2 ;;
esac
