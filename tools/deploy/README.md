# 部署脚本（CI/CD 节点）

`b02-deploy.sh [--rehearse] <main 提交>`、`b02-rehearse.sh`、`b02-rollback.sh <快照目录> [目标提交]`：
Kailo 在 CI/CD 节点上的批次部署、演练与快照回退（步骤、耗时与历次记录见 `运维/CI-CD部署测试手册.md`）。

- 部署第 0 步在停任何服务之前执行 `up.sh preflight`（G-09）：用新镜像与线上渲染后的 compose 环境逐个服务跑
  `--check-config`，并检查 compose 的全部必填项（`${VAR:?}`），一次列出所有问题；失败即检出回原提交并退出，旧版本照常服务。
- `probe-timer.sh`（两个脚本共用，G-10）：部署/回退期间暂停 `kailo-probe.timer`，结束时（无论成败）保证它已
  enable 且 active，即使开始时是关闭的；部署最后一步断言这一点。

节点上的运行副本在 `/volumes/kailo/deploy/work/`，只从本仓库安装，不在节点上直接改：

```bash
git -C /volumes/kailo/apps fetch -q origin main   # 节点上已有的 kailo-plus 检出
git -C /volumes/kailo/apps archive FETCH_HEAD tools/deploy | tar -x --strip-components=2 -C /volumes/kailo/deploy/work
```

2026-11-21 起纳入版本库（此前只在节点上，TE-10 排查时发现无从审阅与追溯）。
