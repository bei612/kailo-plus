// DD-131(2)(3): the importer chooses this Tenant's runtime contract and model route for the new DRAFT
// (the source Tenant's references are not portable). The choices come from the same directory the
// governed version editor uses (`GET /agent-definitions/{id}/version-configuration`: Tenant-wide
// runtime profiles and the routes the caller may reference), read through a Definition the caller
// can read; Core re-validates both on `agent.definition.import` / `agent.team.import`. The preview
// lists the original fields that were discarded, never their content (allowlist keys, runtime, ...).
import * as React from "react";
import {
  AgentSnapshotDiscardedField,
  ResourceState,
  RuntimeProfileKind,
  type AgentVersionConfigurationPage,
  type RuntimeProfileDirectoryProfilesItemCapabilityContract,
} from "@client-kit/contracts";
import type { PlatformMessageKey } from "../../i18n";
import type { BffClient } from "../../client";
import { TransportError } from "../../transport";
import { useBffClient, useUiT } from "../context";
import { PersonaDropdownField } from "./PersonaDropdownField";

const DISCARDED_LABELS = {
  [AgentSnapshotDiscardedField.RespondToAllowlist]: "agentSnapshots.discarded.respondToAllowlist",
  [AgentSnapshotDiscardedField.RespondToAnyone]: "agentSnapshots.discarded.respondToAnyone",
  [AgentSnapshotDiscardedField.Runtime]: "agentSnapshots.discarded.runtime",
  [AgentSnapshotDiscardedField.Model]: "agentSnapshots.discarded.model",
  [AgentSnapshotDiscardedField.Provider]: "agentSnapshots.discarded.provider",
  [AgentSnapshotDiscardedField.NamePool]: "agentSnapshots.discarded.namePool",
  [AgentSnapshotDiscardedField.SessionPolicy]: "agentSnapshots.discarded.sessionPolicy",
  [AgentSnapshotDiscardedField.Memory]: "agentSnapshots.discarded.memory",
  [AgentSnapshotDiscardedField.TeamInstructions]: "agentSnapshots.discarded.teamInstructions",
  [AgentSnapshotDiscardedField.AvatarReference]: "agentSnapshots.discarded.avatarReference",
  [AgentSnapshotDiscardedField.Skills]: "agentSnapshots.discarded.skills",
  [AgentSnapshotDiscardedField.CapabilityRequirements]: "agentSnapshots.discarded.capabilityRequirements",
} as const satisfies Record<AgentSnapshotDiscardedField, PlatformMessageKey>;

export type ImportRuntimeProfile = { key: string; contract: RuntimeProfileDirectoryProfilesItemCapabilityContract };

export type ImportRuntimeSources = {
  profiles: ImportRuntimeProfile[];
  routes: { resourceId: string; label: string }[];
};

const MAX_SOURCE_PAGES = 20;

/** Tenant runtime profiles and referenceable model routes, read through a readable Definition. */
export async function loadImportRuntimeSources(client: Pick<BffClient, "agentDefinitions" | "agentVersionConfiguration">): Promise<ImportRuntimeSources | null> {
  const page = await client.agentDefinitions(0);
  if (!page || !Array.isArray(page.definitions)) throw new TransportError("Agent catalog unavailable");
  const source = page.definitions.find((definition) => definition?.resourceState === ResourceState.Active && !!definition.resourceId);
  if (!source) return null;
  const profiles = new Map<string, ImportRuntimeProfile>();
  const routes = new Map<string, string>();
  let offset = 0;
  for (let index = 0; index < MAX_SOURCE_PAGES; index += 1) {
    const configuration: AgentVersionConfigurationPage = await client.agentVersionConfiguration(source.resourceId, offset);
    if (!configuration || configuration.agentResourceId !== source.resourceId || !Array.isArray(configuration.profiles) || !Array.isArray(configuration.routes))
      throw new TransportError("Runtime directory unavailable");
    for (const profile of configuration.profiles)
      if (profile && typeof profile.key === "string" && profile.key.trim() && profile.kind === RuntimeProfileKind.ServerCodex
        && profile.status === "ACTIVE" && !!profile.capabilityContract && Array.isArray(profile.capabilityContract.replyPolicies)
        && Array.isArray(profile.capabilityContract.capabilityRequirements))
        profiles.set(profile.key, { key: profile.key, contract: profile.capabilityContract });
    for (const route of configuration.routes)
      if (route && typeof route.resourceId === "string" && route.resourceId)
        routes.set(route.resourceId, `${route.resourceId} · ${route.resourceVersion} · ${route.nativeRevision}`);
    if (configuration.nextOffset == null) break;
    if (!Number.isSafeInteger(configuration.nextOffset) || configuration.nextOffset <= offset) throw new TransportError("Runtime directory cursor mismatch");
    offset = configuration.nextOffset;
  }
  return { profiles: [...profiles.values()], routes: [...routes].map(([resourceId, label]) => ({ resourceId, label })) };
}

export type SourcesState = { status: "pending" } | { status: "ok"; data: ImportRuntimeSources | null } | { status: "error" };

export function useImportRuntimeSources(enabled: boolean) {
  const client = useBffClient();
  const [round, setRound] = React.useState(0);
  const [state, setState] = React.useState<SourcesState>({ status: "pending" });
  React.useEffect(() => {
    if (!enabled) return;
    let current = true;
    setState({ status: "pending" });
    loadImportRuntimeSources(client).then((data) => { if (current) setState({ status: "ok", data }); },
      () => { if (current) setState({ status: "error" }); });
    return () => { current = false; };
  }, [client, enabled, round]);
  return { state, reload: () => setRound((value) => value + 1) };
}

export function SnapshotImportRuntimeFields({ sources, onReload, profileKey, routeId, onProfileChange, onRouteChange, disabled, testIdPrefix }: {
  sources: SourcesState;
  onReload: () => void;
  profileKey: string;
  routeId: string;
  onProfileChange: (value: string) => void;
  onRouteChange: (value: string) => void;
  disabled: boolean;
  testIdPrefix: string;
}) {
  const t = useUiT();
  return (
    <section className="space-y-3 rounded-md border border-border p-3" data-testid={`${testIdPrefix}-runtime`}>
      <div>
        <p className="text-sm font-medium">{t("agentSnapshots.runtimeTitle")}</p>
        <p className="text-xs text-muted-foreground">{t("agentSnapshots.runtimeHint")}</p>
      </div>
      {sources.status === "pending" ? <p className="text-sm text-muted-foreground" role="status">{t("platform.loading")}</p>
        : sources.status === "error" ? <p className="text-sm text-destructive" role="alert">{t("platform.loadFailed")}{" "}
          <button className="underline" onClick={onReload} type="button">{t("platform.retry")}</button></p>
        : !sources.data || sources.data.profiles.length === 0 || sources.data.routes.length === 0
          ? <p className="text-sm text-muted-foreground" role="status">{t("agentSnapshots.runtimeUnavailable")}</p>
          : <>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor={`${testIdPrefix}-runtime-profile`}>{t("agents.version.runtimeProfile")}</label>
              <PersonaDropdownField disabled={disabled} id={`${testIdPrefix}-runtime-profile`} onValueChange={onProfileChange}
                options={sources.data.profiles.map((profile) => ({ value: profile.key, label: profile.key }))} placeholder={t("agents.automation.select")} value={profileKey} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor={`${testIdPrefix}-model-route`}>{t("agents.version.modelRoute")}</label>
              <PersonaDropdownField disabled={disabled} id={`${testIdPrefix}-model-route`} onValueChange={onRouteChange}
                options={sources.data.routes.map((route) => ({ value: route.resourceId, label: route.label }))} placeholder={t("agents.automation.select")} value={routeId} />
            </div>
          </>}
    </section>
  );
}

export function DiscardedFields({ fields, testId }: { fields: readonly AgentSnapshotDiscardedField[]; testId: string }) {
  const t = useUiT();
  const unique = [...new Set(fields)];
  if (unique.length === 0) return null;
  return (
    <div className="space-y-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400" data-testid={testId}>
      <p className="font-medium">{t("agentSnapshots.discardedTitle")}</p>
      <ul className="list-disc space-y-0.5 pl-5 text-xs">
        {unique.map((field) => <li data-field={field} key={field}>{t(DISCARDED_LABELS[field] ?? "agentSnapshots.discarded.unknown")}</li>)}
      </ul>
    </div>
  );
}
