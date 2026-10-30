// DD-138(6) (.design/07 §4.8.5, 20 §13.2): the component admin surfaces inside the Kailo
// admin area. Groups follow Kailo admin categories, never components; an entry shows the
// declared title, the source's presentation category name and a read-only badge. Opening
// one loads that single admin function in the content area with the native page shell.
import { type AdminSurfaceEntry, ComponentAdminAccess, NativePageCategory, type WorkspaceView } from "@client-kit/contracts";
import { adminSurfaceDescription, adminSurfaceId, adminSurfaceTitle, groupAdminSurfaces, validAdminSurfacePage } from "../admin-surfaces";
import { useOptionalBffClient, useLocale, useT } from "./context";
import { type Loaded, useLoad } from "./use-load";
import { ADMIN_CATEGORY_LABELS, AdminCategoryIcon, AdminReadOnlyBadge } from "./native-page-shell";
import { NativeApplicationPage } from "./native-application-page";
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "./sidebar/primitives";

/** Bounded fan-out: one Tenant read plus one read per Workspace the member can enter. */
export const ADMIN_SURFACE_MAX_WORKSPACES = 50;

/**
 * Every admin surface the member freshly manages: Tenant-scope bindings and the bindings of
 * each Workspace the member can enter. A failed or malformed read fails the whole list.
 */
export function useAdminSurfaces(): [Loaded<{ entries: AdminSurfaceEntry[]; workspaces: WorkspaceView[] }>, () => void] {
  const client = useOptionalBffClient();
  return useLoad(`admin-surfaces:${client ? "session" : "none"}`, async () => {
    if (!client) return { entries: [], workspaces: [] };
    const tenant = await client.adminSurfaces();
    if (!validAdminSurfacePage(tenant)) throw new Error("Invalid admin surface list");
    const workspaces = (await client.workspaces()).slice(0, ADMIN_SURFACE_MAX_WORKSPACES);
    const entries = [...tenant.items];
    for (const workspace of workspaces) {
      const page = await client.adminSurfaces(workspace.id);
      if (!validAdminSurfacePage(page)) throw new Error("Invalid admin surface list");
      entries.push(...page.items);
    }
    return { entries, workspaces };
  });
}

/** The source label: the presentation category name, plus the Workspace for a Workspace binding. */
export function useAdminSurfaceSource(): (entry: AdminSurfaceEntry, workspaces: WorkspaceView[]) => string {
  const t = useT();
  return (entry, workspaces) => {
    const category = entry.nativePageCategory === NativePageCategory.FileStorage ? t("bindings.native.files")
      : entry.nativePageCategory === NativePageCategory.Knowledge ? t("bindings.native.knowledge")
        : entry.nativePageCategory === NativePageCategory.DataQuery ? t("bindings.native.data") : "";
    const workspace = entry.workspaceId ? workspaces.find((item) => item.id === entry.workspaceId)?.name : undefined;
    return [category, workspace].filter(Boolean).join(" · ");
  };
}

/**
 * Sidebar groups of the admin area, one per Kailo admin category with entries. Nothing is
 * rendered while loading, on failure or without any surface (the group does not exist).
 */
export function AdminSurfaceNavigation({ state, selected, onSelect }: {
  state: Loaded<{ entries: AdminSurfaceEntry[]; workspaces: WorkspaceView[] }>;
  selected: string | null;
  onSelect: (entry: AdminSurfaceEntry) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const source = useAdminSurfaceSource();
  if (state.status !== "ok") return null;
  const groups = groupAdminSurfaces(state.data.entries);
  return <>{groups.map((group) => <SidebarGroup key={group.category} data-testid={`admin-surface-group-${group.category}`}>
    <SidebarGroupLabel>{t(ADMIN_CATEGORY_LABELS[group.category])}</SidebarGroupLabel>
    <SidebarGroupContent><SidebarMenu>
      {group.entries.map((entry) => {
        const id = adminSurfaceId(entry);
        const label = source(entry, state.data.workspaces);
        const description = adminSurfaceDescription(entry.surface, locale);
        return <SidebarMenuItem key={id}><SidebarMenuButton type="button" aria-pressed={id === selected} isActive={id === selected}
          title={description} data-testid="admin-surface-entry" onClick={() => onSelect(entry)}>
          <AdminCategoryIcon category={group.category} className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{adminSurfaceTitle(entry.surface, locale)}</span>
          {entry.surface.access === ComponentAdminAccess.ReadOnly ? <span className="sr-only">{t("admin.readOnly")}</span> : null}
          {label ? <span className="shrink-0 text-[0.75rem] text-muted-foreground">{label}</span> : null}
        </SidebarMenuButton></SidebarMenuItem>;
      })}
    </SidebarMenu></SidebarGroupContent>
  </SidebarGroup>)}</>;
}

/** One admin surface in the content area: the single admin function under the Kailo shell. */
export function AdminSurfaceContent({ entry }: { entry: AdminSurfaceEntry }) {
  return <div className="flex min-h-0 flex-1 flex-col" data-testid="admin-surface-content">
    <NativeApplicationPage key={adminSurfaceId(entry)} bindingId={entry.bindingId} adminSurface={entry.surface.key} />
  </div>;
}

export { AdminReadOnlyBadge };
