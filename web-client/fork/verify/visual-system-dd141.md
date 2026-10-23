# DD-141 Kailo 视觉设计系统：实现与验证记录

对应 `DD-141`、`V-SCN-238`，设计权威 `.design/20-Kailo视觉设计系统.md`（design-authority
`37e698fc6`、`66ba55b23`）。口径：功能对照固定 Buzz 上游，视觉对照 `.design/20` 与开发态样张。
本记录只说明源码写入与 CI/CD 节点上的验证，**没有部署**，也没有重建组件镜像或安装包。

## 写入范围（分支 `feat/kailo-visual-system`）

| 批次 | 内容 |
|---|---|
| 1 令牌与外壳 | `client-kit/ts/platform/src/theme/kailo-tokens.ts` 为唯一令牌源（Iris/Violet/Orchid 三方向色阶、紫调中性色、语义色、明暗角色、阴影、动效、字体栈），生成 `src/styles/kailo-tokens.css` 与 `client-kit/embed/kailo-theme-tokens.css`；首方主题（`buzz`/`buzz-dark` id 保留）改用 Kailo 令牌并固定品牌强调色；`theme.css` 画布、`kailo-shell.css` 外壳（顶栏品牌标识、侧栏行/分组/搜索/选中、贴边内容平面、频道头、日期分隔、消息行、输入器、骨架屏、焦点环、图标线宽）；`tailwind.config.js` 字体、阴影、品牌与语义色；Button/Input/Badge/弹层表面；Kailo 标识替换黄蜂图标（Web favicon/应用图标、Desktop 图标集与启动背景） |
| 2 组件与页面 | `kailo-components.css`（菜单/列表框、遮罩与居中弹窗、通知、表格、原生表单控件、设置卡片、正文链接、引导与冷启动背景、Projects 贴边、Agent 卡片色带与光晕）；选中导航令牌改为 brand-soft；Tooltip、Switch、Toast、设置分组标题、页面标题、会话加载页；Agent/Skill 身份卡与首字母色；加载/存活/引导标识改画 Kailo 字形；组件页面铺满内容平面；用户可见文案去掉 Buzz 字样并同步重生成 Mobile `platform_text.dart` |
| 3 嵌入组件 | Cells（MD3/MUI 选中容器取 Kailo selected，首页壁纸改为品牌光晕，MUI 阴影/圆角）、WeKnora（TDesign 品牌 1–10 与选中/链接角色）、Wren（antd 主色阶与 info/success/warning）；ONLYOFFICE 主题仍由 `kailo-themes.py` 从同一令牌文件生成 |

开发态样张 `web-client/web/design.html`（`src/design-spec/`）只由 Vite 开发服务器提供，生产构建入口仍只有 `index.html`。

## 验证（CI/CD 节点，`~/scratch/visual`，原检查镜像 `local/kailo-check`）

| 项 | 结果 |
|---|---|
| `pnpm -r typecheck`、Web `npm run typecheck` | exit 0 |
| `pnpm -r --no-bail test`（含 `kailo-tokens`、`embed-tokens` 漂移与 WCAG AA 测试） | 135 文件 / 1802 用例全部通过 |
| Web `npm test` | 47 文件 / 713 用例全部通过 |
| Web `vite build`（`VITE_BASE_PATH=/app/`） | exit 0 |
| Biome（样张与改动的 Web UI 文件，error 级） | exit 0 |
| Desktop `tsc --noEmit` | exit 2，59 个错误全部是检查镜像缺 `@tauri-apps/*` 依赖等既有环境问题，与改动前基线同数，无新增 |
| 组件前端：Cells vitest（含 `KailoTheme.test.js`）、WeKnora `tsx --test` 与 `vue-tsc` | 28/28、31/31 通过，vue-tsc exit 0 |
| 组件前端：Wren jest、`next lint`、`tsc` | jest 18/18、lint 无告警；tsc 1 个错误位于既有 `nativeQueryDelivery.test.ts`，与改动前一致 |
| ONLYOFFICE `kailo-themes.py` 读新令牌文件 | 生成 `theme-kailo-light`、`theme-kailo-dark`，exit 0 |
| `tools/check-docs.sh`（设计取 `66ba55b23`） | DD-141 行、V-SCN-238 映射与链接通过；计数项失败只因他人新增的 DD-142–149、V-SCN-232–237/240–246 与实体尚未在本分支归属，需随合并更新 `DESIGN_COMMIT` 与这些行 |

## 截图（CI/CD 节点 `~/kailo-acceptance/visual/`）

- `before/`：改造前生产 Web（qa-1，明暗各一套），兼作 Buzz 反例；CJK 字形以补装的 Noto Sans CJK SC Regular/Medium 渲染（节点原只有 Bold，旧图保留在 `before-boldcjk/`）。
- `spec/`：样张，含三方向明暗对比 `00-directions-light-dark.png` 与选用方向分区图。
- `after-1/`、`after-2/`、`after-3/`：各批改造后。登录与数据取自生产，文档 bundle 由本分支本地构建经 Playwright 路由替换（不部署）；`after-3` 另把本分支令牌文件、Cells 覆盖层与应用图标路由给已部署的组件页，组件镜像未重建，WeKnora/Wren 编译进 bundle 的覆盖层改动不在截图中。

全部截图已逐张打开复核。

## 未覆盖与后续

- Desktop 只做了类型检查与共源样式，未做安装包或设备截图；Tauri `productName` 仍为上游名，改名影响安装与数据目录，留给打包负责人。
- 组件镜像（Cells、WeKnora、Wren、document-editor）与 Web 镜像需按新源码重建后才能在生产看到；`web-client/web/public/app-icon.png` 是三个组件页产物的构建输入，其 `source_digest` 随之变化。
- 内部标识（`buzz-*` CSS 类名、存储键、证据枚举名）未改名，它们不出现在界面上。
