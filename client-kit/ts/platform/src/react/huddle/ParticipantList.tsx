// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/huddle/components/ParticipantList.tsx::{HuddleParticipantsControl,ParticipantAvatar}
// DD-125(3): the original drawer avatar strip (at most nine, speaking ring scaled by the
// sender-authored level, "+N" opening the full participant list with Speaking / Agent / In
// huddle and Remove for Agents). Kailo differences: names and avatars come from the admitted
// member directory (MemberAvatar) and the Workspace's Agent Installations; the per-agent
// voice menu belongs to the Agent speech pipeline and is not offered while speech is
// unavailable (V-SCN-160); removing an Agent is the governed huddle.agent.remove.
import * as React from "react";
import { X } from "lucide-react";
import { useLocale, useT } from "../context";
import { truncatePubkey } from "../../format";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Button } from "../profile/buzz/shared/ui/button";
import { ProfileAvatar } from "../profile/buzz/features/profile/ui/ProfileAvatar";
import { AvatarHostProvider } from "../profile/avatar-host";
import { ROUNDED_SQUIRCLE_PATH } from "../messages/thread/AvatarClipPaths";
import { MemberAvatar } from "../members";
import { Popover, PopoverContent, PopoverTrigger } from "../conversations/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../sidebar/tooltip";
import type { HuddleParent } from "./host";
import type { HuddleDirectoryEntry } from "./queries";
import { useHuddlePlural } from "./plural";

const MAX_VISIBLE_PARTICIPANTS = 9;

type ParticipantIdentity = {
  displayName: string;
  initialsLabel: string;
  isActive: boolean;
  isAgent: boolean;
  pubkey: string;
  speakerLevel: number;
  entry: HuddleDirectoryEntry | undefined;
};

export function HuddleParticipantsControl({
  parent,
  participants,
  directory,
  activeSpeakers,
  speakerLevels,
  agentPubkeys,
  onRemoveAgent,
  className,
}: {
  parent: HuddleParent;
  participants: string[];
  directory: Map<string, HuddleDirectoryEntry> | undefined;
  activeSpeakers?: string[];
  speakerLevels?: Record<string, number>;
  agentPubkeys?: string[];
  onRemoveAgent?: (pubkey: string) => void;
  className?: string;
}) {
  const t = useT();
  const plural = useHuddlePlural();
  const identities = React.useMemo<ParticipantIdentity[]>(() => {
    const agentSet = new Set((agentPubkeys ?? []).map((pubkey) => pubkey.toLowerCase()));
    const activeSet = new Set((activeSpeakers ?? []).map((pubkey) => pubkey.toLowerCase()));
    const levels = new Map(Object.entries(speakerLevels ?? {}).map(([pubkey, level]) =>
      [pubkey.toLowerCase(), Math.min(1, Math.max(0, level))] as const));
    return participants.map((pubkey) => {
      const normalized = pubkey.toLowerCase();
      const entry = directory?.get(normalized);
      const isAgent = agentSet.has(normalized) || entry?.kind === "agent";
      const authoredName = entry?.displayName.trim();
      const keyLabel = truncatePubkey(pubkey);
      const displayName = authoredName || (isAgent ? t("huddle.agentFallback", { key: keyLabel }) : t("huddle.participantFallback", { key: keyLabel }));
      const speakerLevel = levels.get(normalized) ?? (activeSet.has(normalized) ? 0.55 : 0);
      return {
        displayName,
        initialsLabel: authoredName || keyLabel,
        isActive: activeSet.has(normalized) || speakerLevel > 0.04,
        isAgent,
        pubkey,
        speakerLevel,
        entry,
      };
    });
  }, [activeSpeakers, agentPubkeys, directory, participants, speakerLevels, t]);

  if (participants.length === 0) return null;
  const visible = identities.slice(0, MAX_VISIBLE_PARTICIPANTS);
  const hidden = identities.length - visible.length;

  const strip = (
    <div className={cn("relative flex h-12 max-w-full shrink items-center justify-start gap-1 overflow-x-auto px-1", className)}
      data-testid="huddle-participant-strip">
      {visible.map((participant) => (
        <Tooltip key={participant.pubkey}>
          <TooltipTrigger asChild>
            <span className="inline-flex shrink-0 rounded-full">
              <ParticipantAvatar parent={parent} participant={participant} size="bar" />
            </span>
          </TooltipTrigger>
          <TooltipContent className="buzz-huddle-tooltip" side="top">{participant.displayName}</TooltipContent>
        </Tooltip>
      ))}
      {hidden > 0 ? (
        <PopoverTrigger asChild>
          <Button aria-label={plural("huddle.showAllParticipants", participants.length)}
            className="relative z-10 h-9 min-w-9 shrink-0 rounded-full border-2 border-black bg-white/15 px-1 text-2xs font-semibold text-white shadow-none tabular-nums hover:bg-white/25 hover:text-white"
            type="button" variant="ghost">+{hidden}</Button>
        </PopoverTrigger>
      ) : null}
    </div>
  );

  if (hidden === 0) return strip;

  return (
    <Popover>
      {strip}
      <PopoverContent align="end" className="buzz-huddle-drawer buzz-huddle-popover w-72 p-3 text-foreground" side="top" sideOffset={10}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium">{t("huddle.participantsTitle")}</h2>
          <span className="shrink-0 text-xs text-foreground/60">{plural("huddle.participants", participants.length)}</span>
        </div>
        <ul className="flex max-h-64 list-none flex-col gap-1 overflow-y-auto">
          {identities.map((participant) => (
            <li className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5" key={participant.pubkey}>
              <ParticipantAvatar parent={parent} participant={participant} size="list" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{participant.displayName}</div>
                <div className="truncate text-xs text-foreground/60">
                  {participant.isActive ? t("huddle.speaking") : participant.isAgent ? t("huddle.agent") : t("huddle.inHuddle")}
                </div>
              </div>
              {participant.isAgent && onRemoveAgent ? (
                <Button aria-label={t("huddle.removeAgent", { name: participant.displayName })}
                  className="h-7 w-7 shrink-0 text-foreground/65 hover:bg-destructive/15 hover:text-destructive"
                  onClick={() => onRemoveAgent(participant.pubkey)} size="icon" type="button" variant="ghost">
                  <X className="h-4 w-4" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function ParticipantAvatar({ parent, participant, size }: { parent: HuddleParent; participant: ParticipantIdentity; size: "bar" | "list" }) {
  const locale = useLocale();
  const sizeClass = size === "bar" ? "h-9 w-9" : "h-8 w-8";
  const speakerLevel = Math.min(1, Math.max(0, participant.speakerLevel));
  const speakerStyle = {
    "--buzz-huddle-speaker-opacity": speakerLevel > 0.04 ? (0.45 + speakerLevel * 0.55).toFixed(3) : "0",
    "--buzz-huddle-speaker-scale": (1.02 + speakerLevel * 0.14).toFixed(3),
  } as React.CSSProperties;
  const entry = participant.entry;
  const avatarClass = "h-full w-full border-2 border-black text-2xs";
  return (
    <span className={cn("buzz-huddle-speaking-avatar relative z-0 inline-flex shrink-0",
      participant.isAgent ? "buzz-huddle-speaking-avatar-agent" : "rounded-full", sizeClass)}
      data-testid="huddle-participant-avatar" style={speakerStyle}>
      {participant.isAgent ? (
        <svg aria-hidden="true" className="buzz-huddle-speaking-squircle pointer-events-none absolute inset-0 h-full w-full overflow-visible text-[hsl(142_71%_45%)]"
          data-testid="huddle-agent-speaking-ring" focusable="false" viewBox="0 0 1 1">
          <path d={ROUNDED_SQUIRCLE_PATH} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : null}
      {entry?.kind === "human" ? (
        <MemberAvatar className={avatarClass} label={participant.displayName}
          target={parent.kind === "workspace"
            ? { workspaceId: parent.workspaceId, principalId: entry.principalId, pubkey: participant.pubkey,
              alternatePubkeys: entry.alternatePubkeys, displayName: entry.displayName }
            : { conversationId: parent.conversationId, principalId: entry.principalId, pubkey: participant.pubkey,
              alternatePubkeys: entry.alternatePubkeys, displayName: entry.displayName }} />
      ) : (
        <AvatarHostProvider value={{ locale, rewriteMediaUrl: (url) => url }}>
          <ProfileAvatar avatarUrl={null} className={avatarClass} initialsLabel={participant.initialsLabel}
            label={participant.displayName} shape={participant.isAgent ? "squircle" : "circle"} />
        </AvatarHostProvider>
      )}
    </span>
  );
}
