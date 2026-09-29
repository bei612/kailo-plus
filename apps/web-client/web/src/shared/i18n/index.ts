import { platformMessages } from "@kailo/platform/i18n";

export type AppLocale = "en" | "zh-CN";

// 平台页（成员、审计、设备）与共用外壳的文案由 Kailo 共用包定义（ADR-09），并入这里
// 而不在本表另写一份：同一个 key 只有一个来源。
const messages = {
  ...platformMessages,
  "message.attachmentImage": { en: "Attachment image", "zh-CN": "附件图片" },
  "message.imageFailed": { en: "Image failed to load", "zh-CN": "图片加载失败" },
  "app.title": { en: "Platform", "zh-CN": "平台" },
  "platform.tab.channel": { en: "Channel", "zh-CN": "频道" },
  "platform.loadingIdentity": { en: "Resolving identity…", "zh-CN": "正在解析身份…" },
  "platform.stream.connecting": { en: "Connecting", "zh-CN": "连接中" },
  "platform.stream.synced": { en: "Synced", "zh-CN": "已同步" },
  "platform.stream.revoked": {
    en: "Session is no longer valid — sign in again",
    "zh-CN": "会话已失效，请重新登录",
  },
  "platform.stream.reconnecting": {
    en: "Connection interrupted, reconnecting",
    "zh-CN": "连接中断，重连中",
  },
  "platform.stream.ended": {
    en: "Disconnected — reload to reconnect",
    "zh-CN": "连接已断开，刷新页面重连",
  },
  "platform.attach": { en: "Attach image or video", "zh-CN": "添加图片或视频" },
  "platform.attachments": { en: "Attachments", "zh-CN": "附件" },
  "platform.removeAttachment": { en: "Remove", "zh-CN": "移除" },
  "platform.uploading": { en: "Uploading…", "zh-CN": "上传中…" },
  "platform.uploadFailed": {
    en: "Upload failed — the result is unknown. Try again.",
    "zh-CN": "上传失败，结果不明。请重试。",
  },
  "platform.uploadTooLarge": { en: "That file is too large.", "zh-CN": "文件过大。" },
  "platform.newMessages": { en: "New", "zh-CN": "新消息" },
  "platform.star": { en: "Star this workspace", "zh-CN": "收藏此工作区" },
  "platform.mute": {
    en: "Mute this workspace (no unread count in the tab title)",
    "zh-CN": "静音此工作区（标签页标题不显示未读数）",
  },
  "platform.sendFailed": { en: "Send failed", "zh-CN": "发送失败" },
  "platform.sendUnknown": {
    en: "Delivery not confirmed yet. If the message shows up in the channel, it was delivered. Reference: {operation}",
    "zh-CN": "发送结果待确认：若消息稍后出现在频道中，即已送达。操作号 {operation}",
  },
  "platform.sendRejected": { en: "The message was rejected", "zh-CN": "消息被拒绝" },
  "platform.message": { en: "Message", "zh-CN": "消息" },
  "platform.send": { en: "Send", "zh-CN": "发送" },
  "error.attachmentImagePrepare": {
    en: "We couldn't prepare this image for upload.",
    "zh-CN": "无法处理此图片以上传。",
  },
  "error.attachmentMediaUnsupported": {
    en: "This media format isn't supported for upload.",
    "zh-CN": "暂不支持上传此媒体格式。",
  },
} as const;

export type MessageKey = keyof typeof messages;

export function resolveLocale(languages?: readonly string[]): AppLocale {
  const preferred =
    languages ??
    (typeof navigator === "undefined"
      ? ["en"]
      : navigator.languages.length
        ? navigator.languages
        : [navigator.language]);
  return preferred[0]?.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function getLocale(): AppLocale {
  return resolveLocale();
}

export function t(key: MessageKey, variables: Record<string, string | number> = {}): string {
  if (key === "app.title" || key === "platform.title") {
    const name = document.querySelector<HTMLMetaElement>('meta[name="platform-display-name"]')?.content.trim();
    if (!name) throw new Error("PLATFORM_DISPLAY_NAME is missing");
    return name;
  }
  const template = messages[key][getLocale()];
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(variables[name] ?? ""));
}

export function initializeDocumentLanguage(): void {
  document.documentElement.lang = getLocale();
  document.title = t("app.title");
}
