// 平台页入口（SS-WEB-01 的原生端对应）：成员、本人任务、待我审批、本人审计、
// 本人设备。页面本身是共用平台包里的同一份组件（ADR-09）。一期只有这五项；
// 未启用的能力不生成入口。
import type { PlatformMessageKey } from "@client-kit/platform/i18n";

export const PLATFORM_SECTIONS = [
  "members",
  "tasks",
  "approvals",
  "audit",
  "devices",
] as const;

export type PlatformSection = (typeof PLATFORM_SECTIONS)[number];

export function isPlatformSection(value: unknown): value is PlatformSection {
  return PLATFORM_SECTIONS.includes(value as PlatformSection);
}

export const PLATFORM_SECTION_LABEL: Record<
  PlatformSection,
  PlatformMessageKey
> = {
  members: "platform.tab.members",
  tasks: "platform.tab.tasks",
  approvals: "platform.tab.approvals",
  audit: "platform.tab.audit",
  devices: "platform.tab.devices",
};
