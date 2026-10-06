import { useCallback, useEffect, useRef, useState } from "react";
import { ActionDispatchState, ActionGateState, ChannelType, WorkspaceMembershipState, WorkspaceVisibility, type ActionCommand, type DiscoverableWorkspace } from "@client-kit/contracts";
import { newIdempotencyKey } from "../governance";
import { TransportError, writeFailure, type WriteFailure } from "../transport";
import { useBffClient, useFailureText, useT } from "./context";
import { ChannelBrowserDialog, type BrowserChannel } from "./channel-browser/ChannelBrowserDialog";
import { Button, ReadFailure } from "./ui";

/** Core controls discovery/admission; hosts only contribute already-observed
 * activity timestamps and navigate after fresh membership evidence. No Relay join. */
export function ChannelBrowser({ open, onOpenChange, onSelect, lastMessageAtByChannelId, channelType }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (workspace: DiscoverableWorkspace) => void | Promise<void>;
  lastMessageAtByChannelId?: ReadonlyMap<string, string | null>;
  channelType?: ChannelType;
}) {
  const client = useBffClient();
  const t = useT();
  const failureText = useFailureText();
  const [rows, setRows] = useState<DiscoverableWorkspace[]>([]);
  const latestRows = useRef<DiscoverableWorkspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [createActionKey, setCreateActionKey] = useState<import("@client-kit/contracts").CreateActionKey>();
  const [intent, setIntent] = useState<ActionCommand | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [failure, setFailure] = useState<WriteFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const epoch = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current += 1; }; }, []);

  const load = useCallback(async () => {
    const generation = ++epoch.current;
    setLoading(true); setError(null);
    try {
      const items: DiscoverableWorkspace[] = [];
      const cursors = new Set<string>();
      const ids = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await client.discoverableWorkspaces(cursor);
        if (!page || !Array.isArray(page.items)) throw new TransportError("Invalid workspace directory");
        for (const item of page.items) {
          if (!item || typeof item.id !== "string" || ids.has(item.id)
            || !Object.values(WorkspaceVisibility).includes(item.visibility)
            || !item.channel || !Object.values(ChannelType).includes(item.channel.channelType)
            || typeof item.channel.name !== "string" || typeof item.channel.archived !== "boolean"
            || typeof item.isMember !== "boolean" || !Number.isSafeInteger(item.memberCount) || item.memberCount < 0
            || (item.membershipState !== undefined && !Object.values(WorkspaceMembershipState).includes(item.membershipState))
            || (item.joinActionKey !== undefined && item.joinActionKey !== "workspace.join"))
            throw new TransportError("Invalid workspace directory");
          ids.add(item.id); items.push(item);
        }
        cursor = page.nextCursor;
        if (cursor !== undefined && (typeof cursor !== "string" || !cursor || cursors.has(cursor))) throw new TransportError("Invalid workspace cursor");
        if (cursor) cursors.add(cursor);
      } while (cursor && mounted.current && generation === epoch.current);
      if (!mounted.current || generation !== epoch.current) return [];
      setRows(items);
      latestRows.current = items;
      return items;
    } catch (cause) {
      if (mounted.current && generation === epoch.current) { setError(cause); setRows([]); latestRows.current = []; }
      throw cause;
    } finally { if (mounted.current && generation === epoch.current) setLoading(false); }
  }, [client]);
  useEffect(() => {
    if (!open) return;
    void load().catch(() => undefined);
    let current = true;
    setCreateActionKey(undefined);
    void client.roleWorkspaces().then((page) => { if (current) setCreateActionKey(page.createActionKey); }, () => { if (current) setCreateActionKey(undefined); });
    return () => { current = false; };
  }, [open, client, load]);

  const join = async (id: string): Promise<boolean> => {
    if (running.current || (intent && intent.workspaceId !== id)) return false;
    const row = rows.find((item) => item.id === id);
    if (!intent && (!row || row.joinActionKey !== "workspace.join")) return false;
    const command = intent ?? { actionKey: "workspace.join", workspaceId: id, idempotencyKey: newIdempotencyKey() };
    running.current = true; setBusy(true); setFailure(null); setIntent(command);
    let recorded = accepted;
    try {
      if (!accepted) {
        const result = await client.submitAction(command);
        if (!result || result.actionKey !== command.actionKey || !result.actionExecutionId || !result.operationId
          || !Object.values(ActionGateState).includes(result.gateState)
          || !Object.values(ActionDispatchState).includes(result.dispatchState)) throw new TransportError("Missing admission receipt");
        if (result.gateState !== ActionGateState.Allowed || result.dispatchState === ActionDispatchState.Aborted) {
          throw new TransportError("Membership admission not terminal");
        }
        recorded = true;
        if (mounted.current) setAccepted(true);
      }
      const observed = (await load()).find((item) => item.id === id);
      if (!mounted.current) return false;
      if (observed?.isMember && observed.membershipState === WorkspaceMembershipState.Active) {
        setIntent(null); setAccepted(false);
        return true;
      }
      return false;
    } catch (cause) {
      if (mounted.current) {
        const failed = writeFailure(cause); setFailure(failed);
        if (failed.kind !== "unknown" && !recorded) setIntent(null);
      }
      return false;
    } finally { running.current = false; if (mounted.current) setBusy(false); }
  };
  const channels: BrowserChannel[] = rows.map((row) => ({ ...row,
    name: row.channel.name, description: row.channel.description ?? "", channelType: row.channel.channelType,
    archivedAt: row.channel.archived, lastMessageAt: lastMessageAtByChannelId?.get(row.channel.channelId) ?? null,
  }));
  return <ChannelBrowserDialog channels={channels} open={open} channelTypeFilter={channelType}
    createActionKey={createActionKey} busy={busy || loading} onOpenChange={onOpenChange} onJoinChannel={join}
    onSelectChannel={(id) => {
      const row = latestRows.current.find((item) => item.id === id);
      if (row?.isMember) void Promise.resolve(onSelect(row)).catch((cause) => setError(cause));
    }} status={<div className="px-1 pb-3 text-sm">
      {loading ? <p role="status">{t("platform.loading")}</p> : null}
      <Button disabled={loading || busy} onClick={() => void load().catch(() => undefined)}>{t("platform.refresh")}</Button>
      {error ? <ReadFailure error={error} onRetry={() => void load().catch(() => undefined)} /> : null}
      {intent ? <div role="status">{t("channel.browser.joinPending")}
        <Button data-testid="channel-join-status" disabled={busy || loading} onClick={() => { void join(intent.workspaceId!).then((ready) => {
          if (ready) { onOpenChange(false); const row = latestRows.current.find((item) => item.id === intent.workspaceId); if (row) void Promise.resolve(onSelect(row)).catch(setError); }
        }); }}>{t(accepted ? "platform.refresh" : "platform.retry")}</Button>
      </div> : null}
      {failure ? <p role="alert">{failure.kind === "rejected" ? failureText(failure) : t("channel.browser.joinPending")}</p> : null}
    </div>} />;
}
