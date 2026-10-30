// Fixed Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/local-archive/ui/LocalArchiveSettingsCard.tsx.
// DD-159: the original Personal "Local archive" section, Desktop only. Subscriptions are
// conversations the user reads now; copies are pulled through this device's own Relay session,
// sealed at rest, and removed when access is lost. Copy from the shared catalog, DD-141 roles.
// Native store: original src-tauri archive (archive_db.rs, store.rs, store_migrations.rs, sync.rs,
// mod.rs) is src-tauri/src/local_archive (one sealed SQLite per identity, schema created in place,
// paged channel sync); retention.rs's size readout is the card's size line (observer retention is not
// offered, DD-159(1)).
import * as React from "react";
import { toast } from "sonner";
import { useDeviceLocale } from "@client-kit/platform/react/context";
import { translate, type PlatformMessageKey } from "@client-kit/platform/i18n";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { useChannelsQuery } from "@/features/channels/hooks";
import { SettingsOptionGroup, SettingsOptionRow } from "@/features/settings/ui/SettingsOptionGroup";
import { SettingsSectionHeader } from "@/features/settings/ui/SettingsSectionHeader";
import {
  clearLocalArchive, getLocalArchiveStatus, subscribeLocalArchive, syncLocalArchive, unsubscribeLocalArchive,
  type LocalArchiveStatus,
} from "@/shared/api/tauriLocalArchive";
import {
  ARCHIVE_KIND_GROUPS, DEFAULT_ARCHIVE_GROUPS, formatArchiveBytes, groupsForKinds, kindsForGroups,
  subscribableChannels, summarizeSync,
} from "./localArchiveModel";

function Subcopy({ children }: { children: React.ReactNode }) {
  return <p className="text-sm font-normal text-muted-foreground" data-settings-subcopy>{children}</p>;
}

export function LocalArchiveSettingsCard() {
  const locale = useDeviceLocale();
  const t = React.useCallback((key: PlatformMessageKey, variables?: Record<string, string>) =>
    translate(locale, key, variables), [locale]);
  const channelsQuery = useChannelsQuery();
  const channels = channelsQuery.data ?? [];
  const nameById = React.useMemo(() => new Map(channels.map((channel) => [channel.id, channel.name])), [channels]);
  const [status, setStatus] = React.useState<LocalArchiveStatus | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState("");
  const [groups, setGroups] = React.useState<string[]>([...DEFAULT_ARCHIVE_GROUPS]);
  const [confirmClear, setConfirmClear] = React.useState(false);

  const reload = React.useCallback(async () => {
    try {
      setStatus(await getLocalArchiveStatus());
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);
  React.useEffect(() => { void reload(); }, [reload]);

  const subscribedIds = status?.subscriptions.map((sub) => sub.channelId) ?? [];
  const candidates = subscribableChannels(channels, subscribedIds);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    try { await action(); } finally { setBusy(null); }
  };

  const add = () => run("add", async () => {
    try {
      setStatus(await subscribeLocalArchive(selected, kindsForGroups(groups)));
      setSelected("");
      toast.success(t("localArchive.added"));
    } catch {
      toast.error(t("localArchive.addFailed"));
    }
  });
  const remove = (channelId: string) => run(`remove:${channelId}`, async () => {
    try {
      setStatus(await unsubscribeLocalArchive(channelId));
      toast.success(t("localArchive.removed"));
    } catch {
      toast.error(t("localArchive.actionFailed"));
    }
  });
  const sync = () => run("sync", async () => {
    try {
      const summary = summarizeSync(await syncLocalArchive());
      const message = t(summary.key, summary.variables);
      if (summary.tone === "negative") toast.error(message); else toast.success(message);
    } catch {
      toast.error(t("localArchive.actionFailed"));
    }
    await reload();
  });
  const clear = () => run("clear", async () => {
    try {
      await clearLocalArchive();
      setConfirmClear(false);
      toast.success(t("localArchive.cleared"));
    } catch {
      toast.error(t("localArchive.actionFailed"));
    }
    await reload();
  });

  const resultLabel = (result: string): string => result === "ok" ? t("localArchive.result.ok")
    : result === "retry" ? t("localArchive.result.retry") : t("localArchive.result.never");

  return (
    <section className="min-w-0" data-testid="settings-local-archive">
      <SettingsSectionHeader title={t("platform.settings.localArchive")} description={t("localArchive.description")} />

      {loadFailed ? (
        <SettingsOptionGroup title={t("localArchive.subscriptions")}>
          <SettingsOptionRow role="alert">
            <Subcopy>{t("localArchive.unavailable")}</Subcopy>
            <Button variant="outline" size="sm" onClick={() => void reload()}>{t("platform.retry")}</Button>
          </SettingsOptionRow>
        </SettingsOptionGroup>
      ) : (
        <SettingsOptionGroup title={t("localArchive.subscriptions")} description={status
          ? t("localArchive.size", { size: formatArchiveBytes(status.bytes) }) : undefined}
          headerAction={<Button size="sm" variant="outline" disabled={busy !== null || !status?.subscriptions.length}
            onClick={() => void sync()} data-testid="local-archive-sync">{t("localArchive.syncNow")}</Button>}>
          {status === null ? <SettingsOptionRow role="status"><Subcopy>{t("platform.loading")}</Subcopy></SettingsOptionRow>
            : status.subscriptions.length === 0 ? <SettingsOptionRow><Subcopy>{t("localArchive.empty")}</Subcopy></SettingsOptionRow>
            : status.subscriptions.map((sub) => (
              <SettingsOptionRow key={sub.channelId} data-testid={`local-archive-sub-${sub.channelId}`}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{nameById.get(sub.channelId) ?? sub.channelId}</p>
                  <Subcopy>{t("localArchive.subscriptionDetail", {
                    count: String(sub.eventCount),
                    groups: groupsForKinds(sub.kinds).map((id) => t(ARCHIVE_KIND_GROUPS.find((g) => g.id === id)!.label)).join(" · "),
                    result: resultLabel(sub.lastResult),
                  })}</Subcopy>
                </div>
                <Button variant="outline" size="sm" disabled={busy !== null}
                  aria-label={t("localArchive.removeFor", { name: nameById.get(sub.channelId) ?? sub.channelId })}
                  onClick={() => void remove(sub.channelId)}>{t("localArchive.remove")}</Button>
              </SettingsOptionRow>
            ))}
        </SettingsOptionGroup>
      )}

      {!loadFailed && status ? (
        <SettingsOptionGroup title={t("localArchive.addTitle")}>
          <SettingsOptionRow>
            <select className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t("localArchive.channel")} data-testid="local-archive-channel" value={selected}
              onChange={(event) => setSelected(event.target.value)}>
              <option value="">{t("localArchive.choose")}</option>
              {candidates.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
            </select>
          </SettingsOptionRow>
          {ARCHIVE_KIND_GROUPS.map((group) => (
            <SettingsOptionRow key={group.id}>
              <label className="flex items-center gap-2 text-sm text-foreground" htmlFor={`local-archive-group-${group.id}`}>
                <Checkbox id={`local-archive-group-${group.id}`} data-testid={`local-archive-group-${group.id}`}
                  checked={groups.includes(group.id)}
                  onCheckedChange={(checked) => setGroups((current) => checked === true
                    ? [...new Set([...current, group.id])] : current.filter((id) => id !== group.id))} />
                {t(group.label)}
              </label>
            </SettingsOptionRow>
          ))}
          <SettingsOptionRow>
            <Subcopy>{t("localArchive.addHint")}</Subcopy>
            <Button size="sm" disabled={busy !== null || !selected || groups.length === 0}
              onClick={() => void add()} data-testid="local-archive-add">{t("localArchive.add")}</Button>
          </SettingsOptionRow>
        </SettingsOptionGroup>
      ) : null}

      {!loadFailed && status ? (
        <SettingsOptionGroup title={t("localArchive.clearTitle")}>
          <SettingsOptionRow>
            <Subcopy>{t(confirmClear ? "localArchive.clearConfirm" : "localArchive.clearHint")}</Subcopy>
            <div className="flex shrink-0 items-center gap-2">
              {confirmClear ? <Button variant="outline" size="sm" onClick={() => setConfirmClear(false)}>{t("platform.cancel")}</Button> : null}
              <Button variant="destructive" size="sm" disabled={busy !== null} data-testid="local-archive-clear"
                onClick={() => confirmClear ? void clear() : setConfirmClear(true)}>
                {t(confirmClear ? "localArchive.clearConfirmAction" : "localArchive.clear")}
              </Button>
            </div>
          </SettingsOptionRow>
        </SettingsOptionGroup>
      ) : null}
    </section>
  );
}
