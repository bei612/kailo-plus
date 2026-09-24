// 平台页与原生登录引导的文案。key 只在这里定义一次：Web 的消息表把它并入自己的表
// （同一个 key 不在两处各写一份），Desktop 直接用这里的翻译。

export type PlatformLocale = "en" | "zh-CN";

export const platformMessages = {
  "platform.title": { en: "Kailo", "zh-CN": "Kailo" },
  "platform.workspace": { en: "Workspace", "zh-CN": "工作区" },
  "platform.tab.members": { en: "Members", "zh-CN": "成员" },
  "platform.tab.audit": { en: "Audit", "zh-CN": "审计" },
  "platform.tab.devices": { en: "Devices", "zh-CN": "设备" },
  "platform.signOut": { en: "Sign out", "zh-CN": "退出" },
  "platform.sessionUnavailable": { en: "Session unavailable", "zh-CN": "会话不可用" },
  "platform.loading": { en: "Loading…", "zh-CN": "载入中…" },
  "platform.loadingWorkspaces": { en: "Loading workspaces…", "zh-CN": "正在载入工作区…" },
  "platform.noWorkspace": {
    en: "You have no workspace you can enter in this tenant",
    "zh-CN": "你在该 Tenant 下还没有可进入的工作区",
  },
  "platform.loadFailed": {
    en: "Couldn't load this — the result is unknown.",
    "zh-CN": "未能载入，结果不明。",
  },
  "platform.retry": { en: "Try again", "zh-CN": "重试" },
  "platform.member": { en: "Member", "zh-CN": "成员" },
  "platform.state": { en: "State", "zh-CN": "状态" },
  "platform.protocolIdentity": { en: "Protocol identity", "zh-CN": "协议身份" },
  "platform.time": { en: "Time", "zh-CN": "时间" },
  "platform.type": { en: "Type", "zh-CN": "类型" },
  "platform.action": { en: "Action", "zh-CN": "动作" },
  "platform.result": { en: "Result", "zh-CN": "结果" },
  "platform.audit.none": { en: "No actions recorded yet.", "zh-CN": "还没有记录到动作。" },
  "platform.members.none": {
    en: "This workspace has no members.",
    "zh-CN": "该工作区没有成员。",
  },
  "platform.devices.none": {
    en: "No devices yet. Sign in to Kailo Desktop or Mobile to add one.",
    "zh-CN": "还没有设备。在 Kailo Desktop 或 Mobile 上登录即可添加。",
  },
  "platform.devices.explain": {
    en: "Each device holds its own key. Revoking one stops only that device.",
    "zh-CN": "每台设备各持自己的密钥。撤销只停用那一台设备。",
  },
  "platform.devices.added": { en: "Added", "zh-CN": "添加于" },
  "platform.devices.thisDevice": { en: "This device", "zh-CN": "本机" },
  "platform.devices.revoke": { en: "Revoke", "zh-CN": "撤销" },
  "platform.devices.revokeUnknown": {
    en: "The revocation result is unknown (operation {operation}). Reload to check.",
    "zh-CN": "撤销结果不明（操作 {operation}）。请刷新后确认。",
  },
  "platform.devices.revokeRejected": {
    en: "The revocation was rejected ({reason}).",
    "zh-CN": "撤销被拒绝（{reason}）。",
  },

  "native.config.title": { en: "Connect to Kailo", "zh-CN": "连接 Kailo" },
  "native.config.explain": {
    en: "Enter the addresses your administrator gave you. Nothing is filled in for you: a guessed address would receive your sign-in and device key.",
    "zh-CN": "填写管理员提供的地址。这里不预填任何值：猜测的地址会拿到你的登录与设备密钥。",
  },
  "native.config.nativeApiUrl": { en: "Kailo native entry URL", "zh-CN": "Kailo 原生入口地址" },
  "native.config.oidcIssuer": { en: "Sign-in issuer (OIDC)", "zh-CN": "登录 issuer（OIDC）" },
  "native.config.oidcClientId": { en: "Client ID", "zh-CN": "客户端 ID" },
  "native.config.save": { en: "Save and continue", "zh-CN": "保存并继续" },
  "native.config.saving": { en: "Saving…", "zh-CN": "正在保存…" },
  "native.config.edit": { en: "Change connection settings", "zh-CN": "修改连接设置" },
  "native.config.rejected": {
    en: "These settings were not accepted: {message}",
    "zh-CN": "设置未被接受：{message}",
  },
  "native.signIn.title": { en: "Sign in to Kailo", "zh-CN": "登录 Kailo" },
  "native.signIn.explain": {
    en: "Sign-in opens in your system browser. Come back here when it is done.",
    "zh-CN": "登录会在系统浏览器中打开，完成后回到这里。",
  },
  "native.signIn.start": { en: "Sign in", "zh-CN": "登录" },
  "native.signIn.waiting": {
    en: "Waiting for sign-in to finish in your browser…",
    "zh-CN": "正在等待浏览器中的登录完成…",
  },
  "native.signIn.cancel": { en: "Cancel", "zh-CN": "取消" },
  "native.signIn.failed": { en: "Sign-in did not complete: {message}", "zh-CN": "登录未完成：{message}" },
  "native.device.registering": {
    en: "Registering this device…",
    "zh-CN": "正在登记本机…",
  },
  "native.device.pending": {
    en: "This device is being added ({state}). This usually takes a moment.",
    "zh-CN": "正在添加本机（{state}），通常片刻即可完成。",
  },
  "native.device.unknown": {
    en: "The registration result is unknown{operation}. Check again before doing anything else.",
    "zh-CN": "登记结果不明{operation}。请先重新确认，再做其他操作。",
  },
  "native.device.rejected": {
    en: "This device could not be registered ({reason}).",
    "zh-CN": "本机无法登记（{reason}）。",
  },
  "native.device.revoked": {
    en: "This device's key has been revoked. It cannot be used again; ask your administrator.",
    "zh-CN": "本机密钥已被撤销，不能再次使用；请联系管理员。",
  },
  "native.device.check": { en: "Check again", "zh-CN": "重新确认" },
  "native.community.loading": {
    en: "Finding your community…",
    "zh-CN": "正在获取 Community 连接信息…",
  },
  "native.community.failed": {
    en: "Couldn't get your community's connection details{reason}.",
    "zh-CN": "未能取得 Community 连接信息{reason}。",
  },
  "native.connect.failed": {
    en: "Couldn't connect to your community: {message}",
    "zh-CN": "未能连接 Community：{message}",
  },
} as const;

export type PlatformMessageKey = keyof typeof platformMessages;

export function resolveLocale(languages?: readonly string[]): PlatformLocale {
  const preferred =
    languages ??
    (typeof navigator === "undefined"
      ? []
      : navigator.languages.length
        ? navigator.languages
        : [navigator.language]);
  return preferred[0]?.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function translate(
  locale: PlatformLocale,
  key: PlatformMessageKey,
  variables: Record<string, string | number> = {},
): string {
  return platformMessages[key][locale].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(variables[name] ?? ""),
  );
}
