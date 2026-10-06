import { ApplicationBindingState } from "@client-kit/contracts";
import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { validBindingPage } from "./application-bindings";
import { useBffClient, useT } from "./context";
import { NativeApplicationPage } from "./native-application-page";
import { useLoad } from "./use-load";
import { Button, Notice, ReadFailure } from "./ui";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "./sidebar/sidebar";
import { SidebarMenuLabel } from "./sidebar/sidebar-menu-label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./composer/shared/ui/dialog";

/** Discovery only. Native content remains in the independent service's own page. */
export function NativeApplicationEntries({ scopeKey, workspace }: {
  scopeKey: string; workspace?: { id: string; name: string };
}) {
  const t = useT();
  return <div key={`${scopeKey}:${workspace?.id ?? ""}`}>
    <NativeApplicationScope label={t("bindings.tenant")} />
    {workspace ? <NativeApplicationScope workspaceId={workspace.id} label={workspace.name} /> : null}
  </div>;
}

function NativeApplicationScope({ workspaceId, label }: { workspaceId?: string; label: string }) {
  const client = useBffClient();
  const t = useT();
  const [offsets, setOffsets] = useState([0]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const offset = offsets[index] ?? 0;
  const [state, reload] = useLoad(`native-entries:${workspaceId ?? "tenant"}:${offset}`, () => client.applicationBindings(workspaceId, offset));
  useEffect(() => {
    const refresh = () => { setSelected(null); reload(); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [reload]);
  const page = state.status === "ok" && validBindingPage(state.data, workspaceId, offset) ? state.data : null;
  const entries = page?.bindings.filter((binding) => binding.state === ApplicationBindingState.Active && binding.hasNativePage === true) ?? [];
  const active = entries.find((binding) => binding.bindingId === selected);
  if (page && entries.length === 0 && index === 0 && page.nextOffset === undefined) return null;
  return <SidebarGroup data-testid="native-application-entries">
    <SidebarGroupLabel>{t("bindings.title")} · {label}</SidebarGroupLabel>
    {state.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : !page ? <ReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />
      : <>
        <SidebarMenu>{entries.map((binding) => <SidebarMenuItem key={binding.bindingId}>
          <SidebarMenuButton type="button" aria-label={binding.componentTypeKey} tooltip={binding.componentTypeKey} onClick={() => setSelected(binding.bindingId)}>
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            <SidebarMenuLabel>{binding.componentTypeKey}</SidebarMenuLabel>
          </SidebarMenuButton>
        </SidebarMenuItem>)}</SidebarMenu>
        {index > 0 || page.nextOffset !== undefined ? <div className="flex gap-2">
          {index > 0 ? <Button onClick={() => {setSelected(null);setIndex(index - 1);}}>{t("roles.previous")}</Button> : null}
          {page.nextOffset !== undefined ? <Button onClick={() => {
            setSelected(null);setOffsets([...offsets.slice(0, index + 1), page.nextOffset!]);setIndex(index + 1);
          }}>{t("roles.next")}</Button> : null}
        </div> : null}
      </>}
    <Dialog open={Boolean(active)} onOpenChange={(open) => {if (!open) setSelected(null);}}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader><DialogTitle>{active?.componentTypeKey}</DialogTitle></DialogHeader>
        {active ? <NativeApplicationPage key={`${active.bindingId}:${active.version}:${active.activeProjectionGeneration}`}
          bindingId={active.bindingId} onBack={() => setSelected(null)} /> : null}
      </DialogContent>
    </Dialog>
  </SidebarGroup>;
}
