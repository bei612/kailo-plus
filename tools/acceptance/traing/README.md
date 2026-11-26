# 列车 g 线上复验套件（traing）

源码：kailo-plus `tools/acceptance/traing/`（修改只走提交，在节点上用 `tools/acceptance/install.sh` 安装）；运行目录：CI 节点 `/volumes/kailo/acceptance/traing/`（state/、shots/、logs/、results/ 只在节点上）。由列车 e 验收（`../traine-20261121/steps/*.js`）重构而来：
同一套 playwright-core 1.62 操作，改为参数化的步骤模块 + 一个运行器，每步输出通过/失败 JSON，每步 zh-CN 截图。

## 前提

- 列车 g 已部署（本套件不启动部署栈，不动节点服务）；`/volumes/kailo/kailo-macro` 已是部署的提交。
- 浏览器在 `mcr.microsoft.com/playwright:v1.62.0-noble` 容器里，接 `kailo_internal` 网络（与列车 e 相同，经 `/run/kailo-docker/docker.sock`），
  `node_modules` 复用 `../m0/node_modules`（playwright-core 1.62）。
- 机密只经 0600 文件：内部 API key 与平台引导令牌由 `run.sh` 从 `secrets.env` 抽到 `state/.env-*`（0600，运行后清空删除）；
  测试账号密码在 `state/accounts.json`（0600，本套件生成），会话 cookie 在 `state/<user>.json`（0600），运行状态（id、URL）在 `state/run.json`（0600）。
  日志与结果不含密码、令牌。

## 运行

```bash
cd /volumes/kailo/acceptance/traing
./run.sh dry-run                  # 无需栈：语法、bash -n、步骤模块校验、helper 自测（有宿主 node 用宿主的，否则在 playwright 镜像内 --network none 只读运行）
RUN_ID=g1 ./run.sh all            # 部署后检查 + 全部浏览器步骤（并行约 50 min，--serial 约 2 h；建议 tmux / nohup）
RUN_ID=g1 ./run.sh post-deploy    # 只跑部署后检查
RUN_ID=g1 ./run.sh steps --list   # 列出步骤
RUN_ID=g1 ./run.sh steps --only 40,50   # 只重跑某几步（沿用 state/run.json 里前序步骤留下的状态）
RUN_ID=g1 ./run.sh steps --from 80 --stop-on-fail
RUN_ID=g1 ./run.sh steps --plan          # 依赖图、锁与按 est 估算的时间线（不执行）
RUN_ID=g1 ./run.sh steps --serial        # 旧行为：按文件顺序逐个执行
RUN_ID=g1 ./run.sh evidence       # 只读取证：Temporal schedule / RoutineRun、例程运行记录、TE-08 SpiceDB 检查
```

## 并行执行

步骤默认并行（`lib/schedule.mjs`）：前序步骤（模块的 `after`）结束、所需资源锁（`locks`）空闲时即开始，同时最多
`--concurrency`（默认 `ACC_CONCURRENCY` 或 4）个，剩余链最长者优先；一轮约 50 分钟（串行约 2 小时），以 `--plan` 为准。

- 锁（`RESOURCES`）：`ws:<人>` 当前工作区（切换者独占，依赖其为 W 者共享）、`chan` 本轮团队频道（22 独占新建，99 独占删除，其余共享）、
  `agent:<handle>` 同一 Agent 同时只与一步对话（51 建好例程后释放）、`quota:W` W 的额度（82 独占设置并恢复后释放）、
  `approvals` 审批收件箱、`platform-roles` 平台角色。步骤内也可只锁一段（`h.exclusive`，82 切换 bob 工作区）。
- 每步每人一个独立页面（同一人的浏览器上下文、会话共享，续登按人串行）；日志行以 `[步骤 id]` 开头，截图命名不变。
- 并行时 Agent 回复只从本消息所在话题（`[data-channel-thread-row]`）读取，不读整个频道：其他步骤的提问、回复、提醒、
  例程输出不会被算作本步的回答；找不到本话题即判失败（提示改用 `--serial`），不退回整页读取。
- `--stop-on-fail`：不再开始新步骤，正在执行的步骤跑完，其余记 skipped。`--serial` 与改造前一致（逐个、文件顺序、整页读取）。
- 90 用到的两篇个人工作区文档由 04 建（切换 alice、bob 当前工作区要独占，放在最前不阻塞其他步骤）；99 删除后清掉其状态，
  单独重跑 90 要连同 04：`--only 04,90`。

参数（环境变量，见 `config.env.example`）：`KAILO_URL`、`RUN_ID`、`ACC_DOMAIN`、`ADMIN_ACCOUNT_FILE`、`ASK_TIMEOUT_S`、`ACC_CONCURRENCY`、
`KAILO_SRC`、`M0_DIR`、`KAILO_DOCKER_HOST`、`KAILO_SECRETS`、`PW_IMAGE`、`PW_NODE_MODULES`。

账号：默认每次新开 alice / bob / carol（同域）与 dave（另一域，局外人）。要复用一组账号，把 `state/accounts.json` 留着即可（00 步检测到就只登录）；
换新账号就先把它移走。平台管理员：引导未关闭时 02 步用部署的引导令牌在“设置→平台”成为管理员；已关闭时给
`ADMIN_ACCOUNT_FILE`（0600 JSON `{"email","password"}`，现有平台管理员，例如列车 e 的 alice），由它授予 alice。

## 结果

- `results/<RUN_ID>/00-post-deploy.json`、`results/<RUN_ID>/<step>.json`：`status`（pass / fail / error / blocked / skipped）、
  `checks[]`（名称、是否通过、证据摘要）、`failed[]`、`shots[]`、期间所见 4xx/5xx、页面错误、步骤日志。
- `results/<RUN_ID>/summary.json`：全部步骤一览；运行器全部通过时退出码 0。
- `shots/<RUN_ID>/<step>--<label>.png`：zh-CN、1440×900 截图；API 证据也渲染成截图放在同处。
- `logs/steps-<RUN_ID>.log`：控制台全文（PASS/FAIL 逐条）。

## 步骤与覆盖

| 步骤 | 内容 | 覆盖 |
|---|---|---|
| 00-post-deploy（`post-deploy.sh`） | 试用账号登录、冒烟 upload-pdf / agent-turns（含 Codex）/ default-share、spicedb verify、authz verify、model-catalog-sync 作业、official.sh | 部署后检查、TE-03 |
| 00-accounts | 开通 4 个账号，Keycloak 登录 | 环① |
| 01-onboard | 引导走完；每人恰好一个共享工作区 | TE-11 |
| 02-platform-admin | 平台管理员（引导令牌/现有管理员授予）；授予与撤销审计员 | D-03 |
| 03-workspaces | 工作区命名，记录 W | 环① |
| 04-personal-docs | alice、bob 各在个人工作区建一篇仅本人可读的文档（供 90） | TE-08、E-03 |
| 05-team-idempotent | 同一 `request_id` 连发 3 次建团队 → 同一 id，列表只 1 个 | TE-11 |
| 10-model-catalog | 目录含 flatten-tool-namespaces、complete-replayed-messages，修订由 `svc|model-catalog-sync` 写入、之后无人工修订；管理→模型 编辑→确定 无页面错误、不保存 | TE-10、TE-09 |
| 20-invite | 中文邀请框，邮件邀请 bob/carol，加入 W | 环②、TE-16 |
| 21-agents | 设置→Agent 建 3 个 Kailo Codex 团队 Agent | 环②、TE-16 |
| 22-channel | 在 W 新建本轮团队频道（`TG 客户回访 <runId>`，按新建频道对话框的请求：先建频道再邀请 2 人、加 4 Agent；按身份核对删除上轮遗留的；id 记入 `roundChannel`，99 只删这一个），三人讨论 | 环② |
| 23-chan-messages | 本轮频道：bob 在 alice 消息的话题里回复、👍 反应；alice 编辑（（已编辑））、删除（确认框），API 与 bob 视角核对 | CHAN-04 |
| 24-chan-composer | 草稿离开再回来仍在；@提及 bob + 图片附件发出；“附件”页签；消息转任务（预填标题、指派 bob） | CHAN-03、CHAN-05 |
| 25-chan-dm | 新建私信：与 bob（get_or_create_dm 为同一频道，bob 看到）、与 @文档助理（在私信里回复） | CHAN-02 |
| 26-inbox | bob 收到 24 的提及与任务指派通知（REST + 通知页中文行），标记完成后状态 done；首页、动态页 | INBOX-01 |
| 30/31/32-ring3-* | 建文档、查资料汇总、建任务（指派、截止），均非空回复且实体存在 | 环③、TE-01/02/03 |
| 33-search | 新文档被检索服务收录（POST /dss/search）、Ctrl+K 找到并打开、搜索页、收藏（文件操作→收藏）、最近 | SRCH-01 |
| 34-files | 云盘 新建→上传文件：图片、PDF、代码文件上传完成并在各自查看器渲染 | FILE-02、DOC-03 |
| 35-file-text | 34 的 PDF 文本已抽取（text-content）且按正文可检索；抽取与上传索引处理器未部署时为红 | FILE-03 |
| 36-task-time | 新建任务，“时间”记录 1h 30m、计时器开始/停止，工时 API 核对；任务看板视图 | TASK-02、TASK-01 |
| 37-project | 项目页新建项目、在项目中新建任务；/dss/initiatives 与任务“项目”属性核对 | PROJ-01 |
| 38-database | 新建数据库、界面新建记录、选择列与记录（SQL）、新建看板视图（界面英文残留记 WARN） | DB-01 |
| 39-form | 新建表单、加简答题、发布为任何人可填、无会话浏览器匿名填写、结果计数与答复页 | FORM-01 |
| 40-ring4-card | Codex 出卡可见；界面确认；同 actionId 重试为重复；换 actionId 409 `SURFACE_ALREADY_SUBMITTED`；局外人被拒；Agent 继续；审计 | 环④、TE-04/14 |
| 50-ring5-followup | 3 分钟跟进按时提醒（到点 −60 s～+180 s），审计 actor=bot | 环⑤、TE-06/07 |
| 51-ring5-routines | 对话中建一次性与周期例程，按时运行，运行审计 actor=bot；结束删除 | 环⑤、T-08 |
| 60-ring6-meter-quota | OpenMeter 计量 > 0 且无校验错误；资料员上限 1 token → 线程中文额度提示（QUOTA_BLOCKED）+ DENY 审计；恢复 | 环⑥、TE-12 |
| 70-ring7-doc-edit | @Kailo 连续两次改文档都落地；关系图 | 环⑦、TE-05 |
| 80-gov-approvals | 我的操作记录→导出事件→等待审批；alice 收件箱条目与深链 `/app/settings/approvals?approval=<id>`；批准；导出完成可下载；自审被拒 | D-04、D-05 |
| 81-gov-audit | 审计四个范围（本人/工作区/平台/实体）页面与 API 权限、导出列表 | D-05、TE-13 |
| 82-gov-quota | 管理→额度：平台工作区选择器、设额度并恢复；成员只读 | D-02/D-08 |
| 83-ws-switcher | 侧栏工作区切换器；服务端 current 与设置页一致 | TE-15 |
| 84-zh-text | 邀请框、Agent 页、例程页无英文残留 | TE-16 |
| 90-security | 资料员读不到仅属主可读文档（TE-08）；平台管理员打不开成员个人工作区文档；非成员 403、无会话 401 | TE-08、TE-16 |
| 99-cleanup | 删例程、清额度、撤回未决审批、删 Agent 建的文档与任务、删对等用例（23–39）建的文档/任务/上传/项目/数据库/表单、删本轮频道（产品无归档，只有退出与删除） | — |

对等用例（23–26、33–39）的辅助函数在 `lib/collab.mjs`（消息、通知、上传、任务属性、GraphQL 删除、测试用 PNG/PDF）；每步只读自己用一次性令牌（`TGM…`、`TGS…` 等）标记的内容，
建的实体记入运行状态由 99 删除；`kailo-macro` `kailo/parity/parity.yaml` 对应行的 `cases.playwright` 写步骤 id。

## 判定与注意

- 检查（`h.check`）决定通过与否；`WARN` 只提示（例如实体菜单的通用定位找不到“活动与审计”时，以 API 证据代替截图）。
- 等 Agent 回复的规则：消息之后出现该 Agent 名下至少 12 个可见字符、且符合本步正则，并且不含失败文本
  （没有完成 / 出错 / CONTEXT_EXHAUSTED / -32602 等）。
- 51 步要等例程到点：一次性约 12 分钟后、周期在下一个 5 分钟边界，整步约 15 分钟；建好例程后即释放 @任务协调，等待与其他步骤重叠。
- 步骤依赖前序状态（`h.need`）；缺状态的步骤记为 blocked 而不是 fail。
- 本套件不改产品代码、不改部署配置；10 步只打开编辑框，不保存修订。
