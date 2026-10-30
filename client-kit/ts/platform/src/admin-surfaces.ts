// DD-138(6) (.design/07 §4.8.5): component admin surfaces in the Kailo admin area.
// Core lists only the surfaces the member freshly `manage`s; this module checks the
// shape it renders, orders them by Kailo admin category and builds the launch URL.
// Nothing here grants anything: the component server still decides admin rights.
import {
  type AdminSurfaceEntry, type AdminSurfacePage, ComponentAdminAccess, ComponentAdminCategory,
  ComponentAdminPermission, type ComponentAdminSurfaceDeclaration,
} from "@client-kit/contracts";

/** Fixed order of the admin area groups (07 §4.8.5): models, data sources, storage, indexing, integrations, system. */
export const ADMIN_CATEGORY_ORDER: readonly ComponentAdminCategory[] = [
  ComponentAdminCategory.Models, ComponentAdminCategory.DataSources, ComponentAdminCategory.Storage,
  ComponentAdminCategory.Indexing, ComponentAdminCategory.Integrations, ComponentAdminCategory.System,
];

const KEY = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){1,3}$/;
const SEGMENT = /^[A-Za-z0-9._~-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESERVED = new Set(["members", "roles", "invitations", "users", "groups", "spaces", "organizations", "tenants", "workspaces"]);

export function validAdminSurfaceKey(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && KEY.test(value) && !RESERVED.has(value.split(".")[0] ?? "");
}

/** Same rule as Core's registration check: one leading '/', unreserved segments, no '.'/'..'. */
export function validAdminSurfacePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 256 || !value.startsWith("/")) return false;
  if (value === "/") return true;
  return value.slice(1).split("/").every((segment) => segment !== "." && segment !== ".." && SEGMENT.test(segment));
}

function text(value: unknown, max: number): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 2 && ["ZH_CN", "EN"].every((locale) => {
    const item = record[locale];
    return typeof item === "string" && item.trim().length > 0 && [...item.trim()].length <= max;
  });
}

export function validAdminSurface(surface: ComponentAdminSurfaceDeclaration | undefined | null): surface is ComponentAdminSurfaceDeclaration {
  return !!surface && validAdminSurfaceKey(surface.key) && validAdminSurfacePath(surface.path)
    && ADMIN_CATEGORY_ORDER.includes(surface.adminCategory)
    && Object.values(ComponentAdminPermission).includes(surface.requiredPermission)
    && Object.values(ComponentAdminAccess).includes(surface.access)
    && text(surface.title, 60) && (surface.description === undefined || text(surface.description, 200));
}

export function validAdminSurfaceEntry(entry: AdminSurfaceEntry): boolean {
  return !!entry && UUID.test(entry.bindingId) && (entry.workspaceId === undefined || UUID.test(entry.workspaceId))
    && validAdminSurface(entry.surface);
}

/** A malformed page is a failed read, never a silently shorter list. */
export function validAdminSurfacePage(page: AdminSurfacePage): boolean {
  return !!page && Array.isArray(page.items) && page.items.every(validAdminSurfaceEntry);
}

export function adminSurfaceId(entry: Pick<AdminSurfaceEntry, "bindingId"> & { surface: Pick<ComponentAdminSurfaceDeclaration, "key"> }): string {
  return `${entry.bindingId}:${entry.surface.key}`;
}

/**
 * Tenant-scope and Workspace-scope reads both return the Tenant bindings; one entry per
 * binding and key, grouped in the fixed category order, declaration order kept inside.
 */
export function groupAdminSurfaces(entries: readonly AdminSurfaceEntry[]): { category: ComponentAdminCategory; entries: AdminSurfaceEntry[] }[] {
  const seen = new Set<string>();
  const unique = entries.filter((entry) => {
    const id = adminSurfaceId(entry);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return ADMIN_CATEGORY_ORDER
    .map((category) => ({ category, entries: unique.filter((entry) => entry.surface.adminCategory === category) }))
    .filter((group) => group.entries.length > 0);
}

/** The surface's localized title; Kailo shows the declaration only, never a component name. */
export function adminSurfaceTitle(surface: Pick<ComponentAdminSurfaceDeclaration, "title">, locale: "en" | "zh-CN"): string {
  return locale === "en" ? surface.title.EN : surface.title.ZH_CN;
}

export function adminSurfaceDescription(surface: Pick<ComponentAdminSurfaceDeclaration, "description">, locale: "en" | "zh-CN"): string | undefined {
  return surface.description ? (locale === "en" ? surface.description.EN : surface.description.ZH_CN) : undefined;
}

/**
 * The descriptor URL of an admin surface, or null unless Core issued it for exactly this
 * declared key and it points at the declared path inside the descriptor origin, with no
 * query or fragment of its own.
 */
export function adminSurfaceDescriptorUrl(page: { url: string; origin: string; adminSurface?: ComponentAdminSurfaceDeclaration },
  key: string): URL | null {
  if (!page.adminSurface || page.adminSurface.key !== key || !validAdminSurface(page.adminSurface)) return null;
  try {
    const url = new URL(page.url);
    return url.origin === page.origin && url.pathname === page.adminSurface.path && !url.search && !url.hash ? url : null;
  } catch { return null; }
}

/**
 * The frame address of an admin surface: the descriptor URL (origin + declared path, as
 * Core issued it) plus the §4.7.2 launch values and `kailo_admin_surface`, origin unchanged.
 */
export function adminSurfaceLaunchUrl(page: { url: string; origin: string; adminSurface?: ComponentAdminSurfaceDeclaration },
  key: string, presentation: { theme: string; locale: string }): string | null {
  const launch = adminSurfaceDescriptorUrl(page, key);
  if (!launch) return null;
  launch.searchParams.set("kailo_theme", presentation.theme);
  launch.searchParams.set("kailo_locale", presentation.locale);
  launch.searchParams.set("kailo_admin_surface", key);
  return launch.toString();
}
