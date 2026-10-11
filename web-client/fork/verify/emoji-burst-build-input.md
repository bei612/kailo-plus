# Web 双宿主 Context 检查的固定构建输入

2026-10-11，固定提交 `dcd6ed4dbc97a4c910ba6d2c2514c508dccc101b`
沿原 `tools/build-upstream.sh web-client` 构建，作业 95306 实际退出 1。
原日志位于 `/volumes/data/kailo/tmp/web-main-dcd6ed4-release.UJZtl7/` 的
`build-root.log` 与 `build-web-client.f2jdvm.log`。#18 原命令为
`npm run build` → `tsc && vite build`，tsc 报：

```text
src/main.test.tsx(94,30): error TS2307: Cannot find module '../../../collaboration/desktop/src/shared/ui/EmojiBurstProvider' or its corresponding type declarations.
```

## 原因与影响面

1. 权威为 REQ-24、DD-74/75 的完整页面共源恢复。固定 Buzz
   `779af8886caae1317b4de962082429867ab61503` 的
   `desktop/src/shared/ui/EmojiBurstProvider.tsx::EmojiBurstProvider` 已迁到共享 TS，
   Desktop 原路径为八行转发。Web `main.test.tsx` 实际通过该转发验证两宿主
   `EmojiBurstProvider` 与 `useEmojiBurst` 是同一对象，不是两套 React Context。
2. 全仓检查能找到此文件，独立 Web artifact 的 inputs、Docker 同名 ignore 与
   COPY 均未投递它。转发唯一依赖是已有 `@client-kit/platform/react/emoji-burst`，
   该 export 及其原实现已经在 Web inputs 中，不需要引入整个 Desktop 工程。
3. 本次给三个既有投递点增加这个精确文件。COPY 位于 npm ci 之后，保留既有安装层。
   独立镜像只在 Web 目录安装依赖，外部 Desktop 转发不能向上找到它；构建根
   node_modules 链接至这唯一安装目录，让两宿主解析同一包，不安装第二份依赖。
   保留真实双宿主断言，不排除测试、
   不调整 tsconfig、依赖锁或 React Context，不改变页面、权限、传输和外部动作。
   该文件参与来源摘要；生产 Vite 入口不导入它，不新增浏览器运行期 Desktop IPC。
4. 缺输入继续构建失败，不降级返回假成功。没有协议、数据库、状态机、迁移、
   新错误码或历史数据兼容变化；六类运行期错误边界不受本次构建输入修正影响。

原空闲 SDK `kailo-web-thread-tooltip-sdk`（4 CPU、8 GiB 内存与 swap、network none）
用已安装 TypeScript 6.0.3 的 `resolveModuleName` 实测：仅 Web 目录 node_modules
时，外部转发的包解析为 null；添加构建根到同一安装目录的相对链接后，两宿主
均解析到同一 `@client-kit/platform/src/react/profile/buzz/shared/ui/EmojiBurstProvider.tsx`，
两次检查均 exit 0。独立输入位于 Data 的
`web-tooltip-shared.zzIWe9/web-module-resolution.NCHAKT`；这仅证明解析闭合，不替代完整构建。

首轮固定构建保留失败且未产出新 artifact，未部署。修正后的正式构建在本批提交后
沿同一受限 builder 与 Data 缓存运行；本回执不提前宣称构建、视觉或生产验收通过。
