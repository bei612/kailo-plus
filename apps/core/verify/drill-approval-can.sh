#!/usr/bin/env bash
# ApprovalWorkflow continue-as-new 的真实 Server 演练（.design/06 §3、RB-04）。
#
# 生产里续跑由 Server 在 history 接近上限时建议（默认数千事件）；演练把本 namespace 的
# `limit.historyCount.suggestContinueAsNew` 临时压低，让一条真实审批在几十个事件内就
# 被建议续跑，再核验续跑前后状态与决定不丢、投影 event_id 跨 run 单调、终态照常收敛。
# 动态配置在退出时（含失败）原样还原，Temporal 按 pollInterval 重新加载，不重启。
#
# 「Core 长时间不可达、写回逐轮失败」这条路径由 worker/workflows/approval_can_test.go 在
# 测试环境里核验：审批空闲等待时没有写回，停掉 Core 不会让 history 增长，真实拓扑上
# 只能等到恰逢状态变化的那一刻才能复现。
#
# 用法（在 apps 根目录）：bash core/verify/drill-approval-can.sh <history 导出目录>
# 阈值：DRILL_CAN_HISTORY_COUNT（事件数，必须显式给出；演练记录写明取值）
set -euo pipefail
cd "$(dirname "$0")/../.."
out="$(realpath -m "${1:?用法: drill-approval-can.sh <history 导出目录>}")"
threshold="${DRILL_CAN_HISTORY_COUNT:?必须显式给出演练用的续跑阈值（事件数）}"
mkdir -p "$out"
. core/verify/integration-env.sh

# 运行中的 Temporal 实际挂载的那份动态配置（compose 非 swarm 的 configs 是 bind mount）
cfg=$(sudo -n docker inspect kailo-local-temporal-1 | python3 -c '
import json,sys
for m in json.load(sys.stdin)[0]["Mounts"]:
    if m["Destination"].endswith("/dynamicconfig/local.yaml"):
        print(m["Source"])')
[ -f "$cfg" ] || { echo "找不到 Temporal 挂载的动态配置" >&2; exit 2; }
poll=$(python3 -c '
import re,io
t=io.open("deploy/local/temporal-config.yaml",encoding="utf-8").read()
print(int(re.search(r"pollInterval:\s*(\d+)s", t).group(1)))')
backup=$(mktemp)
cp "$cfg" "$backup"
restore() {
  cp "$backup" "$cfg" && rm -f "$backup"
  echo "动态配置已还原，等待 Temporal 重新加载（${poll}s）"
  sleep $((poll + 2))
}
trap restore EXIT
cat >>"$cfg" <<EOF
limit.historyCount.suggestContinueAsNew:
  - value: $threshold
    constraints: { namespace: $TEMPORAL_NAMESPACE }
EOF
echo "续跑阈值临时压到 $threshold 个事件，等待 Temporal 重新加载（${poll}s）"
sleep $((poll + 2))

export VERIFY_DRILL_HISTORY_DIR="$out"
(cd core && cargo test -q -p kailo-core --test drill_approval_continue_as_new -- --ignored --nocapture)
