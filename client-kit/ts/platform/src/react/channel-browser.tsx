import { useCallback, useEffect, useRef, useState } from "react";
import { LogIn } from "lucide-react";
import { toast } from "sonner";
import { Button as BuzzButton } from "./profile/buzz/shared/ui/button";
import { ActionDispatchState, ActionGateState, WorkspaceChannelCreateChannelType, WorkspaceMembershipState, type ActionCommand, type DiscoverableWorkspace } from "@client-kit/contracts";
import { newIdempotencyKey } from "../governance";
import { TransportError, writeFailure, type WriteFailure } from "../transport";
import { useBffClient, useFailureText, useT } from "./context";
import { ChannelBrowserDialog, type BrowserChannel } from "./channel-browser/ChannelBrowserDialog";
import { loadChannelDirectory } from "./channel-browser/loadChannelDirectory";
import { Button, ReadFailure } from "./ui";

/** Core controls discovery/admission; hosts only contribute already-observed
 * activity timestamps and navigate after fresh membership evidence. No Relay join. */
export function ChannelBrowser({ open, onOpenChange, onSelect, lastMessageAtByChannelId, channelType }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (workspace: DiscoverableWorkspace) => void | Promise<void>;
  lastMessageAtByChannelId?: ReadonlyMap<string, string | null>;
  channelType?: WorkspaceChannelCreateChannelType;
}) {
  const client = useBffClient();
  const t = useT();
  const failureText = useFailureText();
  const [rows, setRows] = useState<DiscoverableWorkspace[]>([]);
  const latestRows = useRef<DiscoverableWorkspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [createActionKey, setCreateActionKey] = useState<import("@client-kit/contracts").RoleWorkspacePageCreateActionKey>();
  const epoch = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current += 1; }; }, []);

  const load = useCallback(async () => {
    const generation = ++epoch.current;
    setLoading(true); setError(null);
    try {
      const items = await loadChannelDirectory(client, () => mounted.current && generation === epoch.current);
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

  const { intent, accepted, failure, busy, join: joinWorkspace } = useWorkspaceJoin(load);
  const join = (id: string) => joinWorkspace(id, rows.find((item) => item.id === id));
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

/** Original join intent shared by the browser and the channel header: the existing governed
 * workspace.join keeps one idempotency key until fresh directory evidence shows ACTIVE
 * membership; an accepted but not yet observed join is retried as a read, never resent. */
export function useWorkspaceJoin(load: () => Promise<DiscoverableWorkspace[]>) {
  const client = useBffClient();
  const [intent, setIntent] = useState<ActionCommand | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [failure, setFailure] = useState<WriteFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const join = async (id: string, row: DiscoverableWorkspace | undefined): Promise<boolean> => {
    if (running.current || (intent && intent.workspaceId !== id)) return false;
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
  return { intent, accepted, failure, busy, join };
}

/** Bounded directory re-reads after an accepted join (ms before each read). */
const JOIN_CONVERGENCE_REREAD_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const;

/** Buzz 779af8886caae1317b4de962082429867ab61503
 * desktop/src/features/channels/ui/ChannelScreenHeader.tsx showJoinButton branch: a non-member
 * of an open, unarchived channel gets the original Join control in the header. */
export function ChannelJoinButton({ workspace, onJoined }: {
  workspace: DiscoverableWorkspace;
  onJoined: (workspace: DiscoverableWorkspace) => void | Promise<void>;
}) {
  const client = useBffClient();
  const t = useT();
  const failureText = useFailureText();
  const load = useCallback(() => loadChannelDirectory(client, () => true), [client]);
  const state = useWorkspaceJoin(load);
  const joinRef = useRef(state.join);
  joinRef.current = state.join;
  const onJoinedRef = useRef(onJoined);
  onJoinedRef.current = onJoined;
  const rereads = useRef(0);
  const announced = useRef<string | null>(null);
  // An accepted join converges through MEMBERSHIP_PROJECTION. Re-read the admitted directory
  // (never re-submit) on a bounded backoff so the original header can enter the channel
  // without the user re-clicking; after the last read the original control remains.
  useEffect(() => {
    if (state.intent === null) { rereads.current = 0; return; }
    if (!state.accepted || state.busy) return;
    const delay = JOIN_CONVERGENCE_REREAD_MS[rereads.current];
    if (delay === undefined) return;
    const timer = window.setTimeout(() => {
      rereads.current += 1;
      void joinRef.current(workspace.id, workspace).then(async (ready) => {
        if (ready) await onJoinedRef.current(workspace);
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [state.intent, state.accepted, state.busy, workspace]);
  // Kailo membership is a governed projection: say so once per intent, not per re-read.
  useEffect(() => {
    if (state.failure?.kind === "rejected") toast.error(failureText(state.failure));
    else if (state.failure) toast(t("channel.browser.joinPending"));
  }, [state.failure, failureText, t]);
  // Only when the bounded re-reads end without ACTIVE does the user need to know the projection
  // is still converging; a converged or abandoned join withdraws that notice.
  const exhausted = state.accepted && state.intent !== null && !state.busy
    && rereads.current >= JOIN_CONVERGENCE_REREAD_MS.length;
  useEffect(() => {
    const key = exhausted ? state.intent?.idempotencyKey ?? null : null;
    if (key && announced.current !== key) { announced.current = key; toast(t("channel.browser.joinPending"), { id: key }); }
  }, [exhausted, state.intent, t]);
  useEffect(() => {
    if (state.intent === null && announced.current) { toast.dismiss(announced.current); announced.current = null; }
  }, [state.intent]);
  useEffect(() => () => { if (announced.current) toast.dismiss(announced.current); }, []);
  return (
    <div className="flex items-center gap-1">
      <BuzzButton data-testid="channel-header-join" disabled={state.busy} size="sm" variant="default" onClick={() => {
        void state.join(workspace.id, workspace).then(async (ready) => {
          if (ready) await onJoined(workspace);
        });
      }}>
        <LogIn className="mr-1.5 h-4 w-4" />
        {t(state.busy ? "channel.header.joining" : "channel.browser.join")}
      </BuzzButton>
    </div>
  );
}
