#!/usr/bin/env bash
# 分支检查的源码暂存（07 §2.1）：把 GitHub 上某分支（或 40 位 commit）的固定树放到 NVMe 热数据根，
# 供检查容器以只读或私有副本挂载。源码只经 GitHub 流转：在 CI 源仓库 fetch，再 git archive 解到新目录，
# 不 rsync 工作树、不写 SMR 机械盘（/volumes/data）。
#
# 用法（CI 节点，ubuntu）：
#   tools/ci/branch-stage.sh <分支|40 位 commit> <名字> [路径...]
#     名字     [a-z0-9-]+；暂存在 /var/lib/kailo-ci/branch/<名字>/apps（整体替换），commit 写入同目录 commit
#     路径     只导出这些路径（缺省整棵树）
# 输出最后一行：<暂存目录> <commit>。旧暂存在新树完整解出后才被替换（原子 rename），失败不留半棵树。
# 环境：BRANCH_STAGE_ROOT（缺省 /var/lib/kailo-ci/branch）、BRANCH_STAGE_REPO（缺省 CI 配置 source_repository）。
# 闲置超过 24 小时的暂存由定时保留（tools/ci/retention/）删除；正在使用的不会被删。
set -euo pipefail
ref=${1:?用法：branch-stage.sh <分支|commit> <名字> [路径...]}
name=${2:?用法：branch-stage.sh <分支|commit> <名字> [路径...]}
shift 2
[[ $name =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "名字只能是 [a-z0-9-]：$name" >&2; exit 2; }
root=${BRANCH_STAGE_ROOT:-/var/lib/kailo-ci/branch}
repo=${BRANCH_STAGE_REPO:-$(python3 -I -c 'import json; print(json.load(open("/volumes/kailo/ci/config.json"))["source_repository"])')}
case "$(realpath -m -- "$root")" in
  /var/lib/kailo-ci/*) ;;
  *) echo "暂存根必须位于 NVMe 热数据根 /var/lib/kailo-ci：$root" >&2; exit 2 ;;
esac
mkdir -p -- "$root"
if [[ $ref =~ ^[0-9a-f]{40}$ ]]; then
  git -C "$repo" cat-file -e "$ref^{commit}" 2>/dev/null || git -C "$repo" fetch -q origin "$ref"
  commit=$ref
else
  git check-ref-format --branch "$ref" >/dev/null || { echo "不是合法分支名：$ref" >&2; exit 2; }
  git -C "$repo" fetch -q origin "+refs/heads/$ref:refs/remotes/origin/$ref"
  commit=$(git -C "$repo" rev-parse --verify "refs/remotes/origin/$ref^{commit}")
fi
target=$root/$name
staging=$(mktemp -d "$root/.$name.XXXXXX")
trap 'rm -rf -- "$staging"' EXIT
mkdir "$staging/apps"
git -C "$repo" archive --format=tar "$commit" -- "$@" | tar -xf - -C "$staging/apps"
printf '%s\n' "$commit" > "$staging/commit"
chmod 0755 "$staging"
if [ -e "$target" ]; then
  old=$(mktemp -d "$root/.$name.old.XXXXXX")
  mv -T -- "$target" "$old/tree"
  mv -T -- "$staging" "$target"
  rm -rf -- "$old"
else
  mv -T -- "$staging" "$target"
fi
trap - EXIT
printf '%s %s\n' "$target/apps" "$commit"
