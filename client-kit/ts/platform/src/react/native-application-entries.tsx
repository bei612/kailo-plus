import { ApplicationBindingState, type ApplicationBindingView } from "@client-kit/contracts";
import { AppWindow, Database, Folder, Library } from "lucide-react";
import { useEffect, useState } from "react";
import { validBindingPage } from "./application-bindings";
import { useBffClient, useT } from "./context";
import { useLoad } from "./use-load";
import { Button, Notice, ReadFailure } from "./ui";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "./sidebar/sidebar";
import { SidebarMenuLabel } from "./sidebar/sidebar-menu-label";

/** Discovery only. Native content remains in the independent service's own page. */
export function NativeApplicationEntries({ scopeKey, workspace, selectedId, onSelect }: {
  scopeKey: string; workspace?: { id: string; name: string };
  selectedId?: string | null; onSelect: (binding: ApplicationBindingView) => void;
}) {
  const t = useT();
  return <div key={`${scopeKey}:${workspace?.id ?? ""}`}>
    <NativeApplicationScope label={t("bindings.tenant")} selectedId={selectedId} onSelect={onSelect} />
    {workspace ? <NativeApplicationScope workspaceId={workspace.id} label={workspace.name} selectedId={selectedId} onSelect={onSelect} /> : null}
  </div>;
}

function NativeApplicationScope({ workspaceId, label, selectedId, onSelect }: {
  workspaceId?: string; label: string; selectedId?: string | null; onSelect: (binding: ApplicationBindingView) => void;
}) {
  const client = useBffClient();
  const t = useT();
  const [offsets, setOffsets] = useState([0]);
  const [index, setIndex] = useState(0);
  const offset = offsets[index] ?? 0;
  const [state, reload] = useLoad(`native-entries:${workspaceId ?? "tenant"}:${offset}`, () => client.applicationBindings(workspaceId, offset));
  useEffect(() => {
    const refresh = () => { reload(); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [reload]);
  const page = state.status === "ok" && validBindingPage(state.data, workspaceId, offset) ? state.data : null;
  const entries = page?.bindings.filter((binding) => binding.state === ApplicationBindingState.Active && binding.hasNativePage === true) ?? [];
  if (page && entries.length === 0 && index === 0 && page.nextOffset === undefined) return null;
  return <SidebarGroup data-testid="native-application-entries">
    <SidebarGroupLabel>{t("bindings.title")} · {label}</SidebarGroupLabel>
    {state.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : !page ? <ReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />
      : <>
        <SidebarMenu>{entries.map((binding) => {
          const categories = binding.capabilityCategories.map((capability) => capability.category);
          const category = categories.includes("file_storage") ? "files" : categories.includes("knowledge") ? "knowledge" : categories.includes("data_query") ? "data" : null;
          const title = category ? t(`bindings.native.${category}`) : binding.componentTypeKey;
          const Icon = category === "files" ? Folder : category === "knowledge" ? Library : category === "data" ? Database : AppWindow;
          return <SidebarMenuItem key={binding.bindingId}>
          <SidebarMenuButton type="button" aria-label={title} tooltip={binding.componentTypeKey} isActive={binding.bindingId === selectedId} onClick={() => onSelect(binding)}>
            <Icon className="h-4 w-4" aria-hidden="true" />
            <SidebarMenuLabel>{title}</SidebarMenuLabel>
          </SidebarMenuButton>
        </SidebarMenuItem>;})}</SidebarMenu>
        {index > 0 || page.nextOffset !== undefined ? <div className="flex gap-2">
          {index > 0 ? <Button onClick={() => {setIndex(index - 1);}}>{t("roles.previous")}</Button> : null}
          {page.nextOffset !== undefined ? <Button onClick={() => {
            setOffsets([...offsets.slice(0, index + 1), page.nextOffset!]);setIndex(index + 1);
          }}>{t("roles.next")}</Button> : null}
        </div> : null}
      </>}
  </SidebarGroup>;
}
