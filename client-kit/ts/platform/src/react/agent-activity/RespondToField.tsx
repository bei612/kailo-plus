// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/agents/ui/RespondToField.tsx
// (CreateAgentRespondToField + AllowlistPicker), original DOM/classes. Kailo differences (DD-125(6)):
// - Only two modes: "Only me (default)" and "Selected people". "Anyone" does not exist.
// - The allowlist is a set of Workspace members from the Installation use page (Principals, not
//   raw keys), so the original "Paste pubkeys" entry and direct-pubkey row are not offered.
// - The Agent runs on the platform server, so the access warning uses the original remote wording.
import * as React from "react";
import { AlertTriangle, Search, X } from "lucide-react";
import { AgentRespondToMode, type AgentInstallationUsePage } from "@client-kit/contracts";

import { useUiT } from "../context";
import { Input } from "../composer/shared/ui/input";
import { UserAvatar } from "../messages/UserAvatar";

type Member = AgentInstallationUsePage["members"][number];

export function CreateAgentRespondToField({
  mode,
  allowlist,
  members,
  onModeChange,
  onAllowlistChange,
  disabled,
  disabledReason,
}: {
  mode: AgentRespondToMode;
  /** Selected member Principal IDs. */
  allowlist: string[];
  members: readonly Member[];
  onModeChange: (mode: AgentRespondToMode) => void;
  onAllowlistChange: (allowlist: string[]) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const t = useUiT();
  const [query, setQuery] = React.useState("");
  const deferredQuery = React.useDeferredValue(query.trim());
  const allowlistSet = React.useMemo(() => new Set(allowlist), [allowlist]);
  const searchResults = React.useMemo(() => {
    const needle = deferredQuery.toLowerCase();
    if (!needle) return [];
    return members.filter((member) => !allowlistSet.has(member.principalId) && member.canGrant
      && member.displayName.toLowerCase().includes(needle)).slice(0, 8);
  }, [allowlistSet, deferredQuery, members]);

  const warningText = mode === AgentRespondToMode.Allowlist ? t("respondTo.warning") : null;
  const accessWarning = warningText ? (
    <div
      className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning-bg px-3 py-2.5"
      data-testid="agent-access-warning"
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <p aria-live="polite" className="text-xs leading-5 text-warning">{warningText}</p>
    </div>
  ) : null;

  return (
    <div className="space-y-2" data-testid="agent-respond-to">
      <label className="text-sm font-medium" htmlFor="agent-respond-to">
        {t("respondTo.label")}
      </label>
      <select
        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs"
        data-testid="agent-respond-to-select"
        disabled={disabled}
        id="agent-respond-to"
        onChange={(e) => onModeChange(e.target.value === AgentRespondToMode.Allowlist ? AgentRespondToMode.Allowlist : AgentRespondToMode.OwnerOnly)}
        value={mode}
      >
        <option value={AgentRespondToMode.OwnerOnly}>{t("respondTo.option.ownerOnly")}</option>
        <option value={AgentRespondToMode.Allowlist}>{t("respondTo.option.allowlist")}</option>
      </select>
      {disabledReason ? (
        <p className="text-xs text-muted-foreground" data-testid="agent-respond-to-disabled-reason">{disabledReason}</p>
      ) : null}
      {mode === AgentRespondToMode.OwnerOnly ? (
        <p className="text-xs text-muted-foreground">{t("respondTo.ownerOnlyHint")}</p>
      ) : null}
      {mode === AgentRespondToMode.Allowlist ? (
        <div className="space-y-2.5 rounded-xl border border-border/80 bg-muted/15 p-3" data-testid="agent-respond-to-allowlist">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{t("respondTo.selectedTitle")}</span>
            <span className="rounded-full bg-background px-2 py-1 text-2xs font-medium leading-none text-muted-foreground">
              {t("respondTo.selectedCount", { count: allowlist.length })}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{t("respondTo.alwaysYou")}</p>
          <div className="rounded-lg border border-border/80 bg-background">
            <div className="flex items-center gap-2 px-2.5 py-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                className="h-auto border-0 px-0 py-0 shadow-none focus-visible:ring-0"
                data-testid="agent-respond-to-search"
                disabled={disabled}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("respondTo.searchPlaceholder")}
                value={query}
              />
            </div>
            {allowlist.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 border-t border-border/70 px-2.5 py-2">
                {allowlist.map((principalId) => {
                  const member = members.find((row) => row.principalId === principalId);
                  const name = member?.displayName ?? principalId;
                  return (
                    <div
                      className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-muted/60 px-2.5 py-1 text-2xs leading-none"
                      data-testid={`agent-respond-to-chip-${principalId}`}
                      key={principalId}
                    >
                      <UserAvatar avatarUrl={null} displayName={name} size="xs" />
                      <span>{name}</span>
                      <button
                        aria-label={t("respondTo.remove", { name })}
                        className="text-muted-foreground transition-colors hover:text-foreground"
                        disabled={disabled || (member?.requested === true && !member.canRevoke)}
                        onClick={() => onAllowlistChange(allowlist.filter((id) => id !== principalId))}
                        type="button"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}
            {deferredQuery.length > 0 ? (
              <div className="border-t border-border/70 px-2 py-2">
                {searchResults.length > 0 ? (
                  <div className="max-h-44 space-y-1 overflow-y-auto">
                    {searchResults.map((result) => (
                      <button
                        className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
                        data-testid={`agent-respond-to-result-${result.principalId}`}
                        key={result.principalId}
                        onClick={() => {
                          onAllowlistChange([...allowlist, result.principalId]);
                          setQuery("");
                        }}
                        type="button"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <UserAvatar avatarUrl={null} displayName={result.displayName} shape="circle" size="xs" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium leading-5">{result.displayName}</p>
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground">{t("respondTo.add")}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="px-2 py-1 text-sm text-muted-foreground">{t("respondTo.noMatch")}</p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {accessWarning}
    </div>
  );
}
