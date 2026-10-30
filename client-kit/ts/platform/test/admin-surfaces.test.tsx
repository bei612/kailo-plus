// DD-138(6) (07 §4.8.5): component admin surfaces in the Kailo admin area
// (V-SCN-229, V-SCN-269, V-SCN-270).
import type { AdminSurfaceEntry, ComponentAdminSurfaceDeclaration } from "@client-kit/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adminSurfaceLaunchUrl, groupAdminSurfaces, validAdminSurface, validAdminSurfacePage, validAdminSurfacePath,
} from "../src/admin-surfaces";
import { createBffClient } from "../src/client";
import type { BffRequest } from "../src/transport";
import { PlatformProvider } from "../src/react/context";
import { WorkspaceManagementPanels } from "../src/react/pages";
import { SidebarProvider } from "../src/react/sidebar/sidebar";
import { click, render, settle, until } from "./render";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

const text = (zh: string, en: string) => ({ ZH_CN: zh, EN: en });
const models = { key: "models.catalog", adminCategory: "MODELS", path: "/platform/admin/models",
  requiredPermission: "BINDING_MANAGE", access: "READ_ONLY", title: text("模型", "Models"),
  description: text("由 Kailo 模型路由提供", "Provided by Kailo model routing") } as unknown as ComponentAdminSurfaceDeclaration;
const source = { key: "dataSources.connection", adminCategory: "DATA_SOURCES", path: "/kailo-admin/data-source",
  requiredPermission: "BINDING_MANAGE", access: "EDITABLE", title: text("数据源连接", "Data source connection") } as unknown as ComponentAdminSurfaceDeclaration;
const skills = { key: "answers.skills", adminCategory: "INTEGRATIONS", path: "/platform/admin/skills",
  requiredPermission: "TENANT_MANAGE", access: "EDITABLE", title: text("问答技能", "Answer skills") } as unknown as ComponentAdminSurfaceDeclaration;
const KNOWLEDGE = "10000000-0000-4000-8000-000000000001";
const DATA = "10000000-0000-4000-8000-000000000002";
const entry = (bindingId: string, surface: ComponentAdminSurfaceDeclaration, category: string, workspaceId?: string) =>
  ({ bindingId, surface, nativePageCategory: category, ...(workspaceId ? { workspaceId } : {}) }) as unknown as AdminSurfaceEntry;

afterEach(() => { vi.unstubAllGlobals(); });

describe("admin surface declarations", () => {
  it("accepts Kailo admin categories, fixed paths and Kailo permissions only", () => {
    expect(validAdminSurface(models)).toBe(true);
    expect(validAdminSurface(source)).toBe(true);
    for (const bad of [{ ...models, key: "members.directory" }, { ...models, key: "models" }, { ...models, adminCategory: "MEMBERS" },
      { ...models, requiredPermission: "DISCOVER" }, { ...models, access: "WRITE" }, { ...models, path: "/admin?x=1" },
      { ...models, path: "/admin/../settings" }, { ...models, path: "admin" }, { ...models, title: { ZH_CN: "模型" } }])
      expect(validAdminSurface(bad as ComponentAdminSurfaceDeclaration)).toBe(false);
    expect(validAdminSurfacePath("/")).toBe(true);
    expect(validAdminSurfacePath("//evil.example/x")).toBe(false);
    expect(validAdminSurfacePage({ items: [entry(KNOWLEDGE, models, "knowledge"), entry("not-a-uuid", models, "knowledge")] })).toBe(false);
  });

  it("groups by Kailo admin category in the fixed order and drops the Tenant binding repeated per Workspace", () => {
    const groups = groupAdminSurfaces([entry(KNOWLEDGE, skills, "knowledge"), entry(DATA, source, "data_query"),
      entry(KNOWLEDGE, models, "knowledge"), entry(KNOWLEDGE, models, "knowledge")]);
    expect(groups.map((group) => group.category)).toEqual(["MODELS", "DATA_SOURCES", "INTEGRATIONS"]);
    expect(groups[0]!.entries).toHaveLength(1);
  });

  it("launches the declared path with the presentation and the admin surface key, nothing else", () => {
    const page = { url: "https://knowledge.example.test/platform/admin/models", origin: "https://knowledge.example.test", adminSurface: models };
    const launch = new URL(adminSurfaceLaunchUrl(page, "models.catalog", { theme: "dark", locale: "en" })!);
    expect(launch.origin).toBe(page.origin);
    expect(launch.pathname).toBe("/platform/admin/models");
    expect([...launch.searchParams]).toEqual([["kailo_theme", "dark"], ["kailo_locale", "en"], ["kailo_admin_surface", "models.catalog"]]);
    expect(adminSurfaceLaunchUrl(page, "answers.skills", { theme: "dark", locale: "en" })).toBeNull();
    expect(adminSurfaceLaunchUrl({ ...page, url: "https://knowledge.example.test/platform/knowledge-bases" }, "models.catalog", { theme: "dark", locale: "en" })).toBeNull();
    expect(adminSurfaceLaunchUrl({ ...page, url: "https://other.example.test/platform/admin/models" }, "models.catalog", { theme: "dark", locale: "en" })).toBeNull();
  });
});

describe("Kailo admin area with component admin surfaces", () => {
  async function mount(items: AdminSurfaceEntry[]) {
    const requests: string[] = [];
    const send = async (request: BffRequest) => {
      requests.push(request.path);
      if (request.path === "/api/v1/admin-surfaces") return { status: 200, body: { items } };
      if (request.path === "/api/v1/workspaces") return { status: 200, body: [] };
      if (request.path.startsWith(`/api/v1/application-bindings/${KNOWLEDGE}/native-page`))
        return { status: 200, body: { bindingId: KNOWLEDGE, projectionGeneration: 3, url: "https://knowledge.example.test/platform/admin/models",
          origin: "https://knowledge.example.test", allowedOrigins: ["https://knowledge.example.test"], adminSurface: models } };
      return { status: 200, body: { bindings: [], canCreate: false } };
    };
    const client = createBffClient({ send });
    const host = await render(<PlatformProvider client={client} locale="zh-CN"><SidebarProvider>
      <WorkspaceManagementPanels><p>Directory</p></WorkspaceManagementPanels>
    </SidebarProvider></PlatformProvider>);
    await settle();
    return { host, requests };
  }

  it("lists surfaces by Kailo admin category without component names and opens one under the Kailo header", async () => {
    const { host, requests } = await mount([entry(KNOWLEDGE, models, "knowledge"), entry(DATA, source, "data_query")]);
    expect(host.querySelector('[data-testid="admin-surface-group-MODELS"]')?.textContent).toContain("模型");
    expect(host.querySelector('[data-testid="admin-surface-group-DATA_SOURCES"]')?.textContent).toContain("数据源连接");
    expect(host.querySelector('[data-testid="admin-surface-group-MODELS"]')?.textContent).toContain("知识库");
    for (const name of ["weknora", "wren", "cells", "外部服务", "已连接"]) expect(host.textContent).not.toContain(name);
    await click(host.querySelector<HTMLElement>('[data-testid="admin-surface-group-MODELS"] [data-testid="admin-surface-entry"]')!);
    await until(() => host.querySelector("iframe") !== null, "admin surface frame");
    expect(requests).toContain(`/api/v1/application-bindings/${KNOWLEDGE}/native-page?adminSurface=models.catalog`);
    const launch = new URL(host.querySelector("iframe")!.src);
    expect(launch.pathname).toBe("/platform/admin/models");
    expect(launch.searchParams.get("kailo_admin_surface")).toBe("models.catalog");
    const header = host.querySelector('[data-testid="native-page-header"]')!;
    expect(header.textContent).toContain("管理");
    expect(header.textContent).toContain("模型");
    expect(header.querySelector('[data-testid="admin-read-only"]')?.textContent).toBe("由 Kailo 管理 · 只读");
  });

  it("shows no admin surface group to a member who manages none", async () => {
    const { host } = await mount([]);
    expect(host.querySelector('[data-testid^="admin-surface-group-"]')).toBeNull();
    expect(host.textContent).toContain("Directory");
  });
});
