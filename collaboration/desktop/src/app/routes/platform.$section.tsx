import { createFileRoute, notFound } from "@tanstack/react-router";
import { translate, resolveLocale } from "@client-kit/platform/i18n";
import {
  ApprovalsPage,
  TasksPage,
} from "@client-kit/platform/react/governance";
import { WorkflowsPage } from "@client-kit/platform/react/workflows";
import { TenantInvitations } from "@client-kit/platform/react/invitations";
import {
  AgentDefinitionsPage,
  AuditPage,
  DevicesPage,
  WorkspaceMembersPage,
} from "@client-kit/platform/react/pages";

import {
  isPlatformSection,
  PLATFORM_SECTION_LABEL,
  type PlatformSection,
} from "@/features/platform/platformSections";
import { useNativeSession } from "@/features/platform/activeCommunity";
import { PulseScreen } from "@/features/platform/PulseScreen";

export const Route = createFileRoute("/platform/$section")({
  params: {
    parse: ({ section }) => {
      if (!isPlatformSection(section)) throw notFound();
      return { section };
    },
    stringify: ({ section }) => ({ section }),
  },
  component: PlatformRouteComponent,
});

/**
 * 平台页：与 Buzz Web 渲染的是同一份组件（共用包，ADR-09），数据经
 * Rust 侧的 `platform_api` 到 BFF。本机设备在设备页里被标出。
 */
function PlatformRouteComponent() {
  const { section } = Route.useParams();
  return <PlatformScreen section={section} />;
}

function PlatformScreen({ section }: { section: PlatformSection }) {
  const session = useNativeSession();
  if (section === "pulse") return <PulseScreen />;
  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-auto px-6 pb-6 pt-14"
      data-testid={`platform-${section}`}
    >
      <h1 className="mb-4 text-lg font-semibold">
        {translate(resolveLocale(), PLATFORM_SECTION_LABEL[section])}
      </h1>
      {section === "members" ? (
        // 邀请属于 Tenant：只对 admin 出现（由邀请列表的 403 决定）
        <div className="flex flex-col gap-6">
          <WorkspaceMembersPage />
          <TenantInvitations />
        </div>
      ) : section === "agents" ? (
        <AgentDefinitionsPage />
      ) : section === "workflows" ? (
        <WorkflowsPage />
      ) : section === "tasks" ? (
        <TasksPage />
      ) : section === "approvals" ? (
        <ApprovalsPage />
      ) : section === "audit" ? (
        <AuditPage />
      ) : (
        <DevicesPage currentDevicePubkey={session.devicePubkey} />
      )}
    </div>
  );
}
