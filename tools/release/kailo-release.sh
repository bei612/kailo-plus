#!/usr/bin/env bash
# Kailo 统一发布入口（ADR-20）：plan / run / status。
#
# 在开发机以 root 运行（持有 CI 节点的 SSH 身份；Git 以工作树属主执行）。开发机只编排：
# 构建与 full 检查经已登记的 CI 任务，备份、部署与回读由 CI 节点执行固定发布树内的
# tools/release/node.py。阶段与恢复语义见 orchestrator.py 与 docs/adr/ADR-20-release-entry.md。
#
#   tools/release/kailo-release.sh plan [--commit SHA] [--json]
#   tools/release/kailo-release.sh run  [--commit SHA] [--until STAGE] [--dry-run] [--retry-failed] [--trailer T]
#   tools/release/kailo-release.sh status [--commit SHA]
set -euo pipefail
exec python3 -I -B "$(dirname "$(realpath "$0")")/orchestrator.py" "$@"
