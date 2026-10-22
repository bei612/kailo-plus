# document-editor 混合构建：官方层核实与试构建

本记录对应 DD-132(1)、V-SCN-190。它说明 `document-editor` 产物里每一部分来自哪里，以及这些来源如何核实。产物尚未登记 digest，不能当作已部署或已验收的证据。

## 1. 官方层与 pin 的核实（2026-10-21）

- 镜像：`docker.io/onlyoffice/documentserver@sha256:e231bc62da8c1f0c1f78188f8c7e17e67716f38955d0ad1d703cf911ad6db84b`。这是 `9.4.0.1` 的 linux/amd64 manifest，index digest 为 `sha256:3ab6ebc7c605e5a32b7ae3ff19daed4925090245acc8100ce2230bd766c88212`。
- 构建号：镜像 history 记录 `PACKAGE_VERSION=9.4.0-129`；在 CI 节点实测，`dpkg-query` 报告 `onlyoffice-documentserver 9.4.0-129`，`sdkjs/cell/sdk-all-min.js` 文件头为 `Version: 9.4.0 (build:129)`。`9.4.0` 镜像（`sha256:8c114db7648a1654828d33e1f9f3b18e97c4caae6707d34bf04d793d260f7e67`）使用同一个包，`9.4.0.1` 只多一层 `apt-get upgrade`。
- 组件提交：取自各 GitHub 组件仓库的 `v9.4.0.129` tag，与 `fork/upstream.yaml` `source_components` 的 pin 逐个比较：

| 组件 | 官方 build 129 | pin | 差异 | 本产物取法 |
|---|---|---|---|---|
| core-fonts、dictionaries、document-formats、document-templates | 与 pin 同一提交 | — | 无 | 官方层 |
| core | `a016fc28` | `3250a848` | 63 个文件，全部是 `Test/Applications` 下的 C# 源码（`55e5f973` "Fix UTF-8 BOM position" 及无文件改动的合并提交） | 官方层（只取二进制） |
| server | `13142e41` | `d6df308a` | 文件树相同 | 从 pin 源码重建，含 SS-OFF-WOPI |
| web-apps | `1993a6d8` | `9c0ca538` | 文件树相同 | 从 pin 源码重建，含 SS-OFF-WOPI |
| sdkjs | `75b53d50` | `72b0421c` | pin 多 `cell/apiBuilder.js` 中导出 `ApiWorkbook` 的一行，并删除 262 个测试文件 | 从 pin 源码重建 |

各 pin 的文件树分别等于对应组件 `v9.4.0.131` tag 的文件树，因此三个重建组件统一打版本 `9.4.0`、构建号 `131`。DocsCoServer 会比较客户端与服务端的版本，三者必须一致。

`core` 的差异不进入产品包，依据有两条：
- 差异只在 `Test/Applications` 下的 Windows 测试程序（`.cs`、`.csproj`、`.sln`），core 的 `.pro`、`.pri`、CMake 或 Makefile 都没有引用它们。
- build_tools `v9.4.0.129` 的 `scripts/deploy_server.py` 只部署已构建的库和可执行文件（kernel、graphics、doctrenderer、x2t、docbuilder、allfontsgen、allthemesgen 等）以及 ICU、V8 数据。

## 2. 构建配方

`fork/packaging/Dockerfile` 按 build_tools `v9.4.0.129`（`cf4cac0846d03e2e00a6fec5d1ecd4e9463086d5`）的 `build_server.py`、`build_js.py`、`deploy_server.py` 重写，构建时只从 GitHub 按该固定提交拉取 build_tools，供 `sdkjs/common/embed/make.py` 导入 `scripts/base.py`。运行入口取代 Docker-DocumentServer `v9.4.0.129`（`8da03c96b1eaa13be94bdbe46c530b3109aea99e`）的 `run-document-server.sh`、supervisor 与 nginx 布局。

- 不用 pkg 打包 server：DocService 由 node 20 直接运行源码与锁定的 npm 树（官方 pkg 目标即 `node20`）。9.4 社区版在 DocService 内运行转换器，不需要 converter 进程、数据库或 RabbitMQ（`Common/sources/runtime/profile.js`、`DocService/sources/embeddedConverter.js`）。
- 字体、主题和 x2t JS 缓存在构建时针对重建后的 sdkjs 生成，做法与 `documentserver-generate-allfonts.sh` 相同；`cmap.bin` 取自重建的 sdkjs，与 `deploy_server.py` 一致。
- 删除的内容：`sdkjs-plugins`、`pluginsmanager`、示例、管理面板、打包脚本，以及 nginx 中的 AI 代理路由（DD-35）。最终镜像从 `scratch` 平铺，官方镜像的下层不进入产物。
- 运行时：入口先核对 DD-132(3) 不变式，再把 token secret 写入 tmpfs，供 DocService 原生的 `secret.*.file` 读取。缓存签名 secret 只通过 node-config 的 `local-production-linux.json` 叠加，`frame-ancestors` 精确写成 `'self'` 加部署声明的宿主 origin。

## 3. 试构建

试构建只在 CI 节点进行：按 GitHub 提交取码，用 `tools/upstream_manifest.py stage` 同一份输入，在受限 builder `kailo-core-data` 上 `--load` 构建；不推送 registry，也不登记 digest。

固定提交 `f23f22ef3ca84ac13c1a5f3300cecbcfb44bc7ef` 的试构建结果：

- 构建成功。本地镜像 `local/document-editor-trial:f23f22ef3ca8`，image ID `sha256:665ad4de140c7fd0d92a540d32654662eee8362edc5bd10cacfa40741ee93c6a`，大小 1,320,038,618 字节，只有 1 层（从 scratch 平铺）。web-apps 的 grunt 构建没有加 `--force`，用时约 400 秒。
- 产物内容：
  - `sdkjs/cell/sdk-all.js` 含 `ApiWorkbook` 导出；文件头为 `9.4.0 (build:131)`；`commondefines.js` 为 `9.4.0`/`131`。
  - `editor-wopi.ejs` 含 SS-OFF-WOPI 映射。
  - 以下内容均不存在：`sdkjs-plugins`、`pluginsmanager`、示例、`documentserver-pluginsmanager.sh`、`run-document-server.sh`。
  - x2t 的 V8 snapshot 与 JS cache（word、cell、slide 的 `sdk-all.bin`、`sdk-all.cache`）都已生成，字体 218 个，node 为 `v20.20.2`。
- 渲染器与部署脚本：`native-config.py apply document-editor` 生成 `local.json`，再次 `check` 结果为语义相同；`start.sh --check` 通过。
- 冒烟运行：按 compose 同样的挂载、secret 与 tmpfs，在 loopback 端口上运行，非生产。
  - 容器 healthy，DocService 报告 `Version: 9.4.0. Build: 131` 并在进程内启动转换器。
  - `/healthcheck` 返回 `true`。discovery 共 472 个 action，全部在实例 origin 上。
  - `frame-ancestors 'self' http://192.168.0.193:58092 http://192.168.0.193:58090` 出现在 discovery 与 `api.js` 的响应中。
  - `/`、`/ai-proxy/`、`/sdkjs-plugins/`、`/welcome/` 均返回 404，`/info/` 返回 403，`/plugins.json` 返回空列表。按缓存标签访问编辑器 bundle 返回 200。
  - 出站拒绝：`wopisrc` 指向非 Cells host 时，ipfilter 以 403 拒绝 CheckFileInfo；指向 Cells host 的其他端口时，DocService 报 "Block external request"。
- 冒烟容器已删除；镜像没有推送，也没有登记 digest。

## 4. 一体化呈现：白标、Kailo 主题与法律声明（DD-132(7)、DD-133）

### 构建输入与产物改动

- 新增构建输入 `client-kit/embed/kailo-theme-tokens.css` 与 `web-client/web/public/app-icon.png`，构建上下文因此改为仓库根。令牌文件取自 `feat/platform-embed` 的 `03993cc5`，内容逐字节相同，合并该分支时不会冲突。
- 优先使用 web-apps 原生的品牌参数（Gruntfile.js 的 `jsreplacements` 与 api 任务）：
  - `APP_TITLE_TEXT`、`COMPANY_NAME`、`APP_CUSTOMER_NAME` 取构建参数 `PLATFORM_DISPLAY_NAME`；
  - 帮助、反馈、支持、发布方与 API 文档等链接参数取 `about:blank`；
  - 发布方与销售联系方式取 `-`。
- 开源版不读取 `customization` 中的品牌项（`server/Common/sources/license.js` 的 `branding/customization=false`，以及各编辑器 `Main.js` 的 `canBranding`）。因此下面这些改动直接放在 fork 源码中，由 `upstream_manifest.py diff` 可查：
  - `apps/api/wopi/editor-wopi.ejs`：页标题为文件名，favicon 为 Kailo 图标；`thm=1/2` 映射到 `theme-kailo-light/dark`；`about`、`help`、`feedback`、`macros`、`plugins` 固定为 false，放在宿主 `docs_api_config` 之后合并；`UserExtraInfo.avatar` 作为 `user.image`；新增宿主消息 `Kailo_Presentation`。
  - 五个编辑器的 `Main.js`：去掉开源版强制显示“关于”的分支。
  - `common/main/lib/controller/Themes.js`：URL 指定 Kailo 主题时锁定主题选择，并接受同源写入的 Kailo 主题即时换肤。
  - `common/main/lib/view/Header.js`、`header.less`、`about.less`：logo 改为 Kailo 图标，不再链接到外站。
  - `MacrosDialog.js`：去掉上游文档链接与提示词中的产品名（宏已按 DD-35 关闭）。
  - 页面模板（`*.deploy` 与源 html）的静态标题、forms 页头链接，六种语言中 `textNoLicenseTitle` 的产品名，以及 forms 葡萄牙语、日语错误信息中的上游 API 链接。
  - sdkjs 拼写检查例外词中的产品名。
  - `server/Common/config/default.json`：AI 插件 CORS 来源清空（DD-35），许可证到期通知不再指向上游销售邮箱。
- 产物中不再包含：内置帮助、移动端与嵌入版前端、上游页头和关于页 logo、DocService 的开发配置（`development-*.json`），以及 supervisor 中的 `APPLICATION_NAME`。
- 主题：`kailo-themes.py` 在构建时读取令牌文件，生成 `theme-kailo-light.json` 与 `theme-kailo-dark.json`，DocService 的 `/themes.json` 会列出它们。编辑器变量与 Kailo 令牌的对应表只在该脚本中维护；没有映射的变量（如文档页面底色）保持编辑器自身的明暗默认值。
- 法律声明：`/kailo-legal/` 包含以下内容，依据见 DD-132(7)②；源码获取地址是必填部署事实 `DOCUMENT_EDITOR_SOURCE_OFFER_URL`，缺失即拒绝启动。
  - 原始开发者 Ascensio System SIA 与原始软件名称，只有文字；
  - 修改说明：显示名、构建时间与源码 commit 来自 `build_facts`；
  - AGPLv3 与 Additional Terms 全文（`LICENSE.txt`）、第三方许可（`3rd-Party.txt`）、CC BY-SA 4.0 链接与无担保声明；
  - 对应源码获取地址。
- `/favicon.ico` 返回 Kailo 图标；discovery 的 `favIconUrl*` 也指向它。

### 品牌扫描（构建最后一步，`brand-scan.py`）

扫描范围：`web-apps`、`sdkjs`、`server`（含 node_modules）、`document-formats`、`document-templates`、`/etc/nginx`、`/etc/onlyoffice`、`/etc/kailo-ds`、`/usr/local/lib/kailo-ds`、`/var/www/onlyoffice/kailo-legal`。

每处命中归入以下一类；不属于任何一类的命中使构建失败：

| 类别 | 含义 |
|---|---|
| legal | 许可证文件、`/kailo-legal/`、版权或许可证注释块，以及 `package.json` 的 homepage 等来源声明（Additional Terms 1 要求保留） |
| comment | 代码包中的非许可注释（从不渲染） |
| identifier | 登记的代码标识、文档格式命名空间与协议键，只在代码中允许，大小写须完全一致。`ONLYOFFICE`、`OnlyOffice` 这类显示拼写和上游站点域名永远不算。JSON 配置只多允许小写配置键 |
| path | 官方层的安装路径（`/var/www/onlyoffice` 等），只出现在服务端配置中 |

HTML、SVG、CSS 与 locale 不享有 comment 类的放行。
