# Agents 原完整页面框架与两端宿主恢复

2026-10-11，固定官方 Buzz `779af8886caae1317b4de962082429867ab61503`。
原依据为 `desktop/src/features/agents/ui/AgentsView.tsx::AgentsView` 的滚动区、
最大宽度容器与区块编排，`desktop/src/shared/ui/PageHeader.tsx::PageHeader` 的
标题/说明/尾部动作结构，以及 `desktop/src/features/agents/ui/AgentsScreen.tsx::AgentsScreen`
的双层 flex 视口。关联 REQ-23、DD-75 与用户全量原版一致性要求。

## 四步影响结论

1. 当前共享页省去原 h1，Web 外加 h12 页头/p4，Desktop 外加 h1/px6/pt14，
   与原模块不一致。恢复的不是新布局：`AgentsPageFrame` 直接共享原 class/DOM，
   接现存 `AgentDefinitionsPage`，两宿主只保留原视口、不再重复标题或 padding。
2. 实际读写者仍是原 Definition/Version/Installation 管理与受治理 BFF。只移动
   呈现外壳，不改身份、scope、权限、分页、订阅、准入或动作字段，不新增公开包
   export、schema、API、数据迁移。共享现存动作组件仍持续挂载，不因对话框关闭
   而丢失 UNKNOWN 意图。Mobile 不是这个 React 页面的消费端，无新增入口。
3. 页面层级变化不把安装记录伪装成运行成功、不把定义映射为独立的 Agent 身份。
   空目录、未授权、错误、撤权、过期版本及并发写锁继续走原消费者；没有新状态
   或外部副作用。Web 修改仅两个 layout 条件，不碰主线刷新请求链。
4. 当前刷新按钮和治理表单保留原既有调用，不能因此把它们归为与官方完全一致。
   原 defaults/bulk stop、UnifiedAgentsSection runtime/persona 分组、Teams、catalog、
   snapshot 与完整 profile 路由尚缺实际执行接缝；未生成空按钮，也未移除既有治理
   功能冒充原版。该批是完整页面框架恢复，不是整个 Agents 产品功能已恢复。

## 实际验证与反证

复用 `kailo-web-thread-tooltip-sdk`（4 CPU / 8 GiB memory+swap、none网络、
Data私有输入），开始时仅sleep、MemAvailable36GiB。未新建镜像或全量构建。

```text
node node_modules/vitest/vitest.mjs run test/agent-library.test.tsx test/agent-library-dialogs.test.tsx --pool=threads --maxWorkers=1 --no-file-parallelism
node node_modules/vitest/vitest.mjs run src/platform/ui/PlatformApp.test.tsx --pool=threads --maxWorkers=1 --no-file-parallelism
```

- 共享真实定义/安装/原对话框消费者：26 passed，exit0。仅私有frame把h1改为div，
  新断言确实失败exit1（其余14项skip）；原字节还原后26 passed，exit0。
- Web实际PlatformApp宿主（SSR隔离数据子组件）：47 passed，exit0。仅私有宿主
  恢复旧Agents p4视口，预期class断言失败exit1（其余46项skip）。按候选字节还原
  后原47项套件再次全部通过，exit0。
- jsdom原 scrollTo 未实现警告保留。未跑规范TS/完整Desktop原生宿主用例、
  Windows安装包或Mobile检查；没有用Web SSR声称原生验收。
- 工作区全局 diff --check 仍发现其他既有五文件空白行问题；不修改无关文件，
  本批私有候选单独检查。

原件目录 `/volumes/data/kailo/tmp/web-profile-frame.QTuuqK`：
`agents-frame-positive.log`、`agents-frame-negative.log`、`agents-frame-restored.log`、
`agents-host-positive.log`、`agents-host-negative.log`、`agents-host-restored.log`。

## 实拍与交付边界

同目录 `agents-current.png` 已打开复核，正常SSO线上确实只有紧贴顶部说明/卡片，
没有原页面h1。浏览器build-info仍是032b9来源f530ffa，不包含本候选。没有部署
未提交树；修复后的宽窄屏截图、实际滚动和完整原生端仍未验收。四分类为原结构
保留与共享迁移；未恢复的业务模块仍是缺失，不能一概称授权治理差异。
