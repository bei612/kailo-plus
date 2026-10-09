# 2026-10-09 原 Profile 默认名称与 accessibility 消费者恢复

本批接手时七个路径均 clean，源/检查/同源生成合计 `+100/-13`；不纳入其它 inherited dirty，不修改旧实拍回执或提交索引。共享 Web/Desktop 原 Card 与 Avatar 实际读方恢复，尚未部署，本批新源码截图为 0。

## 权威、影响与边界

固定官方 `779af8886caae1317b4de962082429867ab61503:desktop/src/features/settings/ui/ProfileSettingsCard.tsx` 的 `ProfileSettingsCard`（`resolvedName`、头像按钮/emoji 标签）、`EditProfileMetadataButton`、`IdentityRow`，以及同 commit `desktop/src/features/profile/ui/ProfileAvatar.tsx::ProfileAvatar` 是逐项来源：

- 原最终回退为 `Your profile`，不再误用页面标题 `Profile`；原草稿→canonical 名称→可信 host fallback 的优先级不改。
- 原按钮 aria/title 为 `Edit profile info` / `Done editing profile info`，分区标题仍为 `Profile info`；头像按钮为 `Saving profile photo`，原 Spinner 的 sr-only 文本仍为 `Saving avatar`。
- emoji aria 与真实图片 alt 均保留原 `{name} avatar`；原 `NIP-05 handle` / `Copy NIP-05 handle` 不再改名为 Nostr address。

引用检索覆盖 shared Card、Native ProfileSettingsCard、Web SettingsPane、真实 ProfileAvatarPreview 及 `useAvatarText` 的 13 个调用点。现有 `avatar-host.tsx::useAvatarText` 只透传原 `translate` 的可选变量，保留 locale memo 与全部既有无变量调用；真实 Avatar 消费姓名变量，英文/中文及包含 `$&` 的原姓名均不会丢失或被替换指令解释。六个实际使用的新词条、原 NIP-05 标签及无读方旧 saving key 的收缩由 `tools/gen-platform-i18n.py` 同源生成 Dart，`reason_text.dart` cmp0，无契约/数据库迁移。

差异具体归类：上述原英文与实际字段消费者是缺失恢复后共享迁移；中文是用户明确授权的适配。其余原 class、布局、动画、菜单顺序未改，不把整个文件归为已授权。没有改 Core/Relay/BFF、认证、scope、SERVER/CLIENT 私钥、quota、审批、审计、上传或写后读取链；空名只走原回退，不捏造身份，UNKNOWN/迟到身份与原冻结请求不变。没有新持久状态、副作用或错误分类，本轮 UI 检查也不写业务数据。

## 实际命令与终态

原受限 `kailo-agent-receipt-xvkujx` 实查 4 CPU / 8 GiB、Node heap 3072 MiB、单 worker，启动/结束仅 sleep，旧 `oom=2/oom_kill=2` 未增；宿主 available 21 GiB、memory PSI 0，Data 271 GiB。无新 SDK、依赖安装、bundle/full、镜像或 Cargo/Go。

命令与日志原件目录：
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/profile-accessibility-20261009.Nfaa54/`

`positive.sh`、`shared-final.sh`、`final-positive.sh`、`shared-corrected.sh`、`negative.sh`、`restore.sh` 保留每条原调用及独立 exit 输出。原 Vitest 4.1.11 入口均为 `node node_modules/vitest/vitest.mjs run <原 ProfileSettings 目标> --pool=threads --maxWorkers=1 -t <本批实际消费者>`；不改 timeout、断言或原 runner。

| 实际句柄 | 终态与证据 |
| --- | --- |
| 17405 | 联合 exit1；原生成/--check 均 0、Web 1 passed/15 filtered；shared 4 passed/2 failed/27 filtered，图片 Image 夹具未给 Radix 所需 naturalWidth；三 host tsc 各独立 0。 |
| 85544 | exit1，shared 4 passed/2 failed；实际加载图片后姓名 alt 消失，抓到本批旧 useAvatarText 未传变量的生产错误，已修原真实消费者，不删检查。 |
| 5550 | 联合 exit1，shared 6 passed/1 failed/26 filtered；最后失败是新增检查误读 Spinner 的 aria 属性，固定官方实际输出 sr-only，已校准实际 DOM 读方；Web 1/1 与最终生产源三 host tsc 各独立 0。 |
| 96961 | exit0，最终 shared 7 passed/26 filtered；中英默认/metadata/emoji/图片 alt 与真实头像 ACK 后关闭态均通过。 |
| 61105 | 真实私有生产破坏 exit1；恢复旧 Profile 回退且抹除姓名变量，shared 4 failed/3 passed/26 filtered，实际 Web SettingsPane 1 failed/15 filtered，非 worker 启动失败。 |
| 48816 | 两生产文件由正式原字节还原后 exit0；同目标 shared 7 passed/26 filtered、Web 1 passed/15 filtered。 |

`negative-production.patch` 是精确私有变异；正式七输入与候选七输入、两宿主四个共享文件共 15 次 cmp0。三 host types 只证明共享/Web/Desktop 源类型，不证明 Desktop 安装包或设备。JSDOM 仅补真实浏览器缺省 Image 加载 API，没有 mock 原 Avatar/Card；未执行的 26/15 项均明确过滤，旧 Web UNKNOWN 全目标 5s 超时及前批 shared worker 0 case 不因本批定向通过而抹掉。正式选定 diff --check0。

## 剩余与未验

不把旧 9edf 头像成功、29 张旧 UI 实拍称作本批新标签验收；未发布，Windows/Mobile 未实机。原 SignOutSection 的本机 wipe/末次备份消费者仍缺失，不接普通 logout、不实际擦除私钥；此前 Native PrivateKeyBackupRow 已恢复的事实保留。完整 Card 原 Profile description 字段标题当前仍为 About，以及原头像录制/背景色三处 `t(...).replace(...)` 变量读方尚未修复，本批不冒称整个 Profile/Avatar 双语闭合。全量 diff 台账未在本批重新扫描，历史分类快照不能冒充当前 main 全量一致性；七源不是 100% Buzz 还原或生产就绪。
