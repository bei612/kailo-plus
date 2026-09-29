# P0 真实 Relay 验收

[English](p0-relay-acceptance.md) | [简体中文](p0-relay-acceptance.zh-CN.md)

P0 已在 Web 客户端实现，但只有以下工作流在已授权的真实 Relay 上通过后，才能认定达到
发布验收标准。Demo 模式 E2E 仍用于回归测试，但不能替代这一门槛。

## 安全边界

使用两个已经加入社区的专用测试身份：

- 管理员身份必须具有 owner 或 admin 权限，且不能使用运维人员的主身份。
- 成员身份必须是另一个普通测试成员。
- 两个 `nsec` 只允许由本机密码管理器或 CI Secret Store 注入，明文不能出现在 Shell
  历史、已提交文件、URL、测试报告、截图或 Trace 中。

Live 测试会关闭截图、Trace、视频、重试和并行 Worker。测试会创建一个以 `web-p0-` 开头
且名称唯一的私有频道，在频道内执行真实 Relay 写入，移除测试成员，并在清理阶段归档频道。
失败的测试可能留下带此前缀的测试频道；应通过 Web 或 Desktop 的正常操作检查并归档，禁止
直接修改 Relay 存储进行清理。

## 自动化执行

先通过所选 Secret Manager 把两个专用身份注入为已有环境变量，然后执行：

```bash
cd web
BUZZ_LIVE_BASE_URL=https://buzz.example.com/app/ \
BUZZ_LIVE_ADMIN_NSEC="$TEST_ADMIN_NSEC" \
BUZZ_LIVE_MEMBER_NSEC="$TEST_MEMBER_NSEC" \
npm run test:e2e:live-p0
```

自动化场景验证：

- 两个已授权身份的 NIP-42 连接。
- owner/admin 创建频道，以及私有频道在加入前、加入后和移除后的可见性。
- guest、admin、member 角色切换和带确认的成员移除。
- 收藏和静音状态能在独立浏览器上下文中从 Relay 恢复。
- 草稿按 Relay、身份和频道隔离并在刷新后恢复。
- 频道未读实时出现、打开频道后清除，并在刷新后保持已读。
- 消息发送、Reaction、线程回复、编辑、删除，以及线程和 Reaction 关联保持完整。
- 使用与正常客户端相同的授权界面操作归档测试频道。

## 跨客户端人工门槛

自动化通过后，使用相同专用身份，在 Web 与当前 Buzz Desktop 版本之间核对：

1. 收藏、静音、归档和恢复状态能够双向最终一致。
2. 任一客户端读消息后，另一个客户端的频道和 Inbox 未读状态在重连后清除。
3. 私有频道在加入前不可见，加入后出现，移除后消失。
4. Relay 拒绝权限操作后，Web 不遗留看似成功的消息、角色、归档或 Profile 状态。
5. 身份备份、忘记、恢复和切换完成后，浏览器存储及下载诊断中不出现原始私钥材料。

记录日期、Web Commit、Desktop 版本、公开 Relay 地址、两个测试公钥和结果。禁止记录私钥
或可重复使用的邀请码。
