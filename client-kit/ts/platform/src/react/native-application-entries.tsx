import { ApplicationBindingState, type ApplicationBindingPage, type ApplicationBindingView } from "@client-kit/contracts";
import { AppWindow, Database, Folder, Library } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { validBindingPage } from "./application-bindings";
import { useBffClient, useT, type Translate } from "./context";
import { useLoad } from "./use-load";
import { Notice, ReadFailure } from "./ui";
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "./sidebar/sidebar";
import { SidebarMenuLabel } from "./sidebar/sidebar-menu-label";

export type NativeCategory = "files" | "knowledge" | "data";

/**
 * DD-157: the product title and category of each discovered entry, so the component
 * page in either host labels its Kailo header exactly like its sidebar entry.
 * Display facts only; every launch still re-admits the binding (DD-138).
 */
export interface NativeEntryPresentation { title: string; category: NativeCategory | null }
const entryPresentations = new Map<string, NativeEntryPresentation>();
const entryListeners = new Set<() => void>();
function publishEntries(entries: [string, NativeEntryPresentation][]) {
  let changed = false;
  for (const [id, value] of entries) {
    const current = entryPresentations.get(id);
    if (current?.title !== value.title || current?.category !== value.category) { entryPresentations.set(id, value); changed = true; }
  }
  if (changed) for (const listener of [...entryListeners]) listener();
}
export function useNativeEntryPresentation(bindingId: string): NativeEntryPresentation | null {
  return useSyncExternalStore((listener) => { entryListeners.add(listener); return () => entryListeners.delete(listener); },
    () => entryPresentations.get(bindingId) ?? null, () => null);
}

// DD-127(4): a native page entry labels itself by its release's presentation category.
export function nativeCategory(binding: ApplicationBindingView): NativeCategory | null {
  const categories: string[] = [...binding.capabilityCategories.map((capability) => capability.category),
    ...(binding.nativePageCategory ? [String(binding.nativePageCategory)] : [])];
  return categories.includes("file_storage") ? "files" : categories.includes("knowledge") ? "knowledge"
    : categories.includes("data_query") ? "data" : null;
}

/** The entry's product name in Kailo (云盘/知识库/问数); the component type only when no category exists. */
export function nativeEntryTitle(binding: ApplicationBindingView, t: Translate): string {
  const category = nativeCategory(binding);
  return category ? t(`bindings.native.${category}`) : binding.componentTypeKey;
}

const MAX_PAGES = 20;

async function readScope(read: (workspaceId: string | undefined, offset: number) => Promise<ApplicationBindingPage>, workspaceId?: string) {
  const entries: ApplicationBindingView[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await read(workspaceId, offset);
    // A malformed page or a repeating offset is a failure, never "no entries".
    if (!validBindingPage(result, workspaceId, offset)) throw new Error("Invalid application binding page");
    entries.push(...result.bindings.filter((binding) => binding.state === ApplicationBindingState.Active && binding.hasNativePage === true));
    if (result.nextOffset === undefined) return entries;
    offset = result.nextOffset;
  }
  return entries;
}

/**
 * Ordinary Kailo navigation entries for the authorized native pages (DD-138(3)):
 * no "external service connections" heading and no separate Tenant/Workspace
 * lists. Within one presentation category the Workspace binding takes the
 * place of the Tenant one (03 resolution order), so a category appears once.
 * Discovery only: every launch freshly re-admits the binding and its origin.
 */
export function NativeApplicationEntries({ scopeKey, workspace, selectedId, onSelect, onSelectedTitle }: {
  scopeKey: string; workspace?: { id: string; name: string };
  selectedId?: string | null; onSelect: (binding: ApplicationBindingView) => void;
  /** Reports the selected entry's product name, for the host's page title. */
  onSelectedTitle?: (title: string | null) => void;
}) {
  const client = useBffClient();
  const t = useT();
  const workspaceId = workspace?.id;
  // Focus revalidation keeps the current entries mounted: a click that moves focus out of an
  // entry's iframe must not land on a list that was just swapped for a loading notice.
  const [state, reload] = useLoad(`native-entries:${scopeKey}:${workspaceId ?? "tenant"}`, async () => {
    const read = (scope: string | undefined, offset: number) => client.applicationBindings(scope, offset);
    const [tenant, local] = await Promise.all([readScope(read), workspaceId ? readScope(read, workspaceId) : Promise.resolve([])]);
    const localCategories = new Set(local.map(nativeCategory).filter((category) => category !== null));
    return [...tenant.filter((binding) => {
      const category = nativeCategory(binding);
      return category === null || !localCategories.has(category);
    }), ...local];
  }, { keepWhileRevalidating: true });
  useEffect(() => {
    const refresh = () => { reload(); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [reload]);
  const entries = state.status === "ok" ? state.data : [];
  const selected = entries.find((binding) => binding.bindingId === selectedId);
  const selectedTitle = selected ? nativeEntryTitle(selected, t) : null;
  useEffect(() => { onSelectedTitle?.(selectedTitle); }, [onSelectedTitle, selectedTitle]);
  useEffect(() => {
    if (state.status === "ok") publishEntries(state.data.map((binding) => [binding.bindingId, { title: nativeEntryTitle(binding, t), category: nativeCategory(binding) }]));
  }, [state, t]);
  if (state.status === "ok" && entries.length === 0) return null;
  return <SidebarGroup data-testid="native-application-entries">
    {state.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : state.status === "error" ? <ReadFailure error={state.error} onRetry={reload} />
      : <SidebarMenu>{entries.map((binding) => {
          const title = nativeEntryTitle(binding, t);
          const category = nativeCategory(binding);
          const Icon = category === "files" ? Folder : category === "knowledge" ? Library : category === "data" ? Database : AppWindow;
          return <SidebarMenuItem key={binding.bindingId}>
            <SidebarMenuButton type="button" aria-label={title} tooltip={title} isActive={binding.bindingId === selectedId} data-binding-id={binding.bindingId} onClick={() => onSelect(binding)}>
              <Icon className="h-4 w-4" aria-hidden="true" />
              <SidebarMenuLabel>{title}</SidebarMenuLabel>
            </SidebarMenuButton>
          </SidebarMenuItem>;
        })}</SidebarMenu>}
  </SidebarGroup>;
}
