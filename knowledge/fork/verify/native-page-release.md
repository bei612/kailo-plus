# 知识库原生页面 release 版本（DD-127、DD-133(5)）

## 1.3.0-native-page（2026-10-23，验收批次 3）

`weknora@1.2.0-native-page`（release `2d153bbf-00f5-508e-bf1d-cfa9dee12719`）登记于提交 `8b8dfd4e7`，当时
`knowledge/fork/upstream.yaml` 的 `knowledge-native-ui` 为 `sha256:24b11bdb…`；之后 `06a3226f1` 起改为并部署
`sha256:52d8232b…`（CI 节点只读回读：`kailo-knowledge-frontend-1` 运行该 digest），release 记录的产物摘要与实际
部署不一致。`fork/release/manifest.native-page.json` 升到 `1.3.0-native-page`（release id
`9a641509-28f0-5d1f-8c60-52b7d9b3afb4`），下一次发布后按当时的 digest 重新登记并换绑。

版本号由什么驱动（`tools/component-release/render.mjs`）：

- `version` 只来自仓库内手工维护的 `<组件>/fork/release/manifest.native-page.json`，没有任何从镜像、commit
  或构建自动推导的成分。release id = `uuidv5(434ca4dc-…, "<componentTypeKey>@<version>")`，同一版本永远是同一 id。
- 该 manifest 的 `adapterBuildRef` 槽填的是**实际提供原生页面的服务产物摘要**（`nativeServiceArtifact`），
  缺省取当时 `<组件>/fork/upstream.yaml` 中该产物的 `artifact_digest`（或 `--receipt` 显式给出）；
  `sourceCommit`、`bindingConfigSchemaDigest` 同样随渲染变化。
- Core 对同一 id 下任何内容变化都拒绝（TargetStateConflict，`component-register.mjs`：“a different manifest is
  registered under this id/version; bump the version”）。所以**原生页面服务镜像每次重建并部署后，都要递增
  manifest 版本**，再按新版本渲染、登记、审批并把 binding 换绑到新 release；旧 release 与旧 binding 不受影响。
- 顺序：所有会改变该 UI 镜像的分支合并 → CI 重建并回填 `upstream.yaml` 的 `artifact_digest` → 发布部署并回读
  运行容器 digest 与 `upstream.yaml` 一致 → `render.mjs --material native-page --source-commit <部署 commit>`
  → 登记/审批 → 换绑。若登记前又有改动该镜像的合并，再递增一次版本，不复用已登记的版本。
