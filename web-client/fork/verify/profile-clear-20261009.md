# 2026-10-09 原资料空值与 pending-clear 消费者恢复

本批以已推 main `70b462069b2f66e3670ae1dbf24f0eaa9d5e0196` 为起点，5 个接手时 clean 的源/检查/生成路径 `+105/-2`。原共享 ProfileSettingsCard 的真实 Web/Desktop 调用保持不变；只恢复固定原版的非空名称/头像门控、Done 草稿复原与原 pending-clear 提示。此前头像回执及所有其他 inherited 改动未纳入。源码尚未部署，没有用 9edf 浏览器实拍证明本批新字节。

## 权威、影响、副作用与异常

权威是用户要求固定原版逐处恢复；来源完整 commit `779af8886caae1317b4de962082429867ab61503`，原路径 `desktop/src/features/settings/ui/ProfileSettingsCard.tsx::ProfileSettingsCard`，实际原符号为 `updatePayload`、`hasPendingDisplayNameClearRequest`、`hasPendingAvatarClearRequest`、`handleProfileMetadataEdit`、`handleAvatarEditorDone`、`shouldShowSaveArea`。原名称/头像只有 trimmed 非空且不同于原值才写 payload；简介的空值仍允许。英文提示原句完整保留，仅新增同源中文翻译。

影响面经引用检索：Native ProfileSettingsCard 与 Web SettingsPane 的既有真实消费者都使用同一个 `client-kit/ts/platform/src/react/profile-settings.tsx`；两宿主原 installed package 的共享模块也实际同步。没有新增 props、接口、按钮或管理状态。唯一新词条 `platform.profile.clearIgnored` 沿原 `tools/gen-platform-i18n.py` 投影到 Dart；`reason_text.dart` 与正式源 cmp0，不混入契约或其它词条漂移。

副作用边界：没有更改 Core/Relay/BFF、签名、授权、上传、quota、审计或 canonical readback。原 SERVER/CLIENT 宿主与私钥边界保留；既有冻结 idempotency intent、UNKNOWN、迟到身份/scope fence 和写后真实 readback 未删除。本批只让原版不支持的名称/头像清空不产生写入，不通过第二份资料权威实现。

异常行为：已有名称/头像的空 draft 显示原提示，只有清空而无其他更改时 Done 还原原值且不发布；头像编辑开启期间原提示不展示，Done 同原恢复头像。混合修改只将原支持字段写入，简介仍可清空；原值本就为空则没有 pending-clear 提示。原 576px 容器与文字 class 原样保留。没有新持久化状态、数据库/契约迁移或六类错误映射；结果不明仍保留原请求，不能变为成功。

## 验证原件与真实边界

复用既有 `kailo-agent-receipt-xvkujx`：实查 4 CPU / 8 GiB、启动前仅 sleep，host available 11 GiB、memory PSI 0.01%；原 Node heap 3072 MiB、Vitest 4.1.11 threads 单 worker，没有新容器、依赖/工具链安装、bundle、full、镜像或 Cargo/Go。最终 top 仅 sleep，旧 `oom=2/oom_kill=2` 未增加。正式 5 输入及两宿主 2 个共享生产文件合计 9 次 cmp0，两个被破坏的私有生产文件已从正式源精确恢复。

日志目录为 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/profile-clear-20261009.8vK40h/`。原命令分别保存在 `positive-command.txt`、`continue-command.txt`、`negative-command.txt`、`restored-command.txt`：

- 初次原生成 exit1：`generation-initial.log` 是 `FAIL: Dart formatter unavailable`；既有 `/usr/lib/dart/bin/dart` 可执行，只把它加入 login shell 内的 PATH，不下载/替换 Dart。随后原生成及 `--check` 均成功，后者原输出 `PASS: Mobile platform and reason catalogs match the shared TypeScript source`。
- `43531` exit1：shared 原 `test/profile-settings.test.tsx` threads worker 启动超时，60.45s、0 case，不计通过。
- `8388` exit1：Web 原 `src/platform/ui/ProfileSettings.test.tsx` 实际 14 passed/1 failed（15 项），新增真实 blank-name/UI 无 BFF 写检查通过；失败为既有 UNKNOWN 切页检查的 5000ms 超时，保留原日志、不改 timeout。三宿主原 `tsc --noEmit` 命令随后均执行完，日志无诊断，但 shell 将各失败汇入此前已为 1 的同一 result，未单独采集退出码；不能据零字节日志或联合 exit1 宣称三项 exit0，此项退出码证据未闭合。
- 正式实现后，仅在私有 shared 源及 Web 真安装包撤掉原名称/头像的非空条件。`59578` 两目标分别 exit1：shared 仍 61.04s worker 启动超时、0 case，不计负向命中；Web 原 `-t "blank-name"` 真实 1 failed/14 skipped，原 SettingsPane 消费者观察到一次 `displayName: ""` BFF 写入，`not.toHaveBeenCalled` 正确失败，不是编译/环境失败。
- 原生产字节还原 cmp0；`87650` 同 Web 原 blank-name 目标 exit0，1 passed/14 skipped（4.66s）。没有第三次冷启动 shared，没有重跑旧 UNKNOWN 超时；shared 新增的 4 个 case 未实际运行，不能冒称它们通过。此批 Web blank-name 正向/实际生产破坏/同字节还原闭合，不等于整个目标/full 全绿。

实际原目标命令为：

```text
node node_modules/vitest/vitest.mjs run test/profile-settings.test.tsx --pool=threads --maxWorkers=1
node node_modules/vitest/vitest.mjs run src/platform/ui/ProfileSettings.test.tsx --pool=threads --maxWorkers=1
node node_modules/vitest/vitest.mjs run src/platform/ui/ProfileSettings.test.tsx --pool=threads --maxWorkers=1 -t "blank-name"
node node_modules/typescript/bin/tsc --noEmit
python3 tools/gen-platform-i18n.py --check
```

没有因为超时改原断言/runner或虚报通过。owned `git diff --check` 与完整 source patch reverse check 均为 0。主代理负责精选提交、文档门禁及集中发布；本批没有真实运行新源码的 Playwright/Windows/Mobile 证据。

## 精确 owned 源

| 路径 | SHA256 |
| --- | --- |
| client-kit/ts/platform/src/react/profile-settings.tsx | e38dc8f9d884b42dab1ce1e7663a7a412fce6034102d4effe9afa72dd84c2107 |
| client-kit/ts/platform/src/i18n.ts | d8cc77901f1cdb53aad1e9e8c5fccec4907c819495edc22484711af55d428fcd |
| client-kit/ts/platform/test/profile-settings.test.tsx | 587adb64bc01b3f422102ab489a82d9b1ecac96a9dca7a7aafa814a3d661d214 |
| web-client/web/src/platform/ui/ProfileSettings.test.tsx | 8bcb6afa103dafde9846480ef2c17785b207bd3abf1c99e1ecaa1c24f66d397b |
| client-kit/dart/lib/shared/platform/platform_text.dart | 325b074054473c042ba67cf0ef410e8adba75574691b335f3e6d8a82de69aba9 |

四类差异仅按本批真实语句：非空门控/Done 复原/提示布局属于恢复后共享迁移；原提示中英与生成属于用户授权语言适配；原 UNKNOWN/身份与 BFF 签名路径是保留的已授权治理，不把整模块笼统归成治理改造。未重新扫描全树，历史完整账仍不能冒充当前全量功能/视觉已验收。

完整原 Card 仍有必需恢复项。固定 `779af8886caae1317b4de962082429867ab61503:desktop/src/features/settings/ui/SignOutSection.tsx::openDialog/handleSignOut` 是本机私钥与本地数据擦除/restart，含末次 raw-nsec/备份确认和 `SIGNOUT_CONFIRM_PHRASE` 门槛；现有 Web `bff-client.ts::signOut` 与 Native `NativeBootstrap.tsx::signOut/platform_sign_out` 只是已定平台 session/token 退出。不得把 “Delete my data” 接普通 logout 并虚报擦除，Web 不承载 raw nsec；本批保留该真实缺口，不生成假 section/按钮，不执行 wipe。此前已入库的 Native PrivateKeyBackupRow 与 `tauriIdentity.ts::getNsec(expectedPubkey)` 不是因此被否定为不存在。原默认 `Your profile` 与当前 Profile 回退及部分 accessibility 文案仍在整模块恢复队列；以上五源不能称完整 Profile、全量 Buzz 还原或生产就绪。
