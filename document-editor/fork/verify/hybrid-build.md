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

结果见下节。试构建只在 CI 节点进行：按 GitHub 提交取码，用 `tools/upstream_manifest.py stage` 同一份输入，在受限 builder `kailo-core-data` 上 `--load` 构建；不推送 registry，也不登记 digest。
