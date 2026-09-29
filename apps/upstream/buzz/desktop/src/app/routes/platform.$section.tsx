import { createFileRoute, notFound } from "@tanstack/react-router";
import { translate, resolveLocale } from "@kailo/platform/i18n";
import { ApprovalsPage, TasksPage } from "@kailo/platform/react/governance";
import { TenantInvitations } from "@kailo/platform/react/invitations";
import {
  AuditPage,
  DevicesPage,
  WorkspaceMembersPage,
} from "@kailo/platform/react/pages";

import {
  isPlatformSection,
  PLATFORM_SECTION_LABEL,
  type PlatformSection,
} from "@/features/kailo/platformSections";
import { useKailoSession } from "@/features/kailo/activeCommunity";

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
 * Kailo 平台页：与 Buzz Web 渲染的是同一份组件（Kailo 共用包，ADR-09），数据经
 * Rust 侧的 `kailo_api` 到 BFF。本机设备在设备页里被标出。
 */
function PlatformRouteComponent() {
  const { section } = Route.useParams();
  return <PlatformScreen section={section} />;
}

function PlatformScreen({ section }: { section: PlatformSection }) {
  const session = useKailoSession();
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
