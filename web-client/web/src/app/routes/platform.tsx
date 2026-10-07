import { createFileRoute, lazyRouteComponent, Link, notFound } from "@tanstack/react-router";
import { isPlatformSection, platformLocationSearch } from "@/app/platform-navigation";
import { t } from "@/shared/i18n";

export const Route = createFileRoute("/_platform")({
  validateSearch: platformLocationSearch,
  // The host renders admitted child content itself (the original AppShell
  // pattern), so reject an unknown child before mounting that common host.
  beforeLoad: ({ params }) => {
    if ("section" in params && (typeof params.section !== "string" || !isPlatformSection(params.section))) throw notFound();
  },
  notFoundComponent: () => <div role="alert" className="flex flex-col gap-3 p-4 text-sm">
    <p>{t("platform.loadFailed")}</p>
    <Link to="/" search={{}}>{t("platform.settings.back")}</Link>
  </div>,
  component: lazyRouteComponent(() => import("@/platform/ui/PlatformApp"), "PlatformApp"),
});
