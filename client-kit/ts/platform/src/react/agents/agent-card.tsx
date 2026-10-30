// DD-170 (.design/20 §16.2(1)): identity objects (Agents, installations, Skills) are a card grid.
// A card is compact — avatar, name, one line of description and a status — so a page of cards
// reads at a glance instead of a column of tall portraits. The whole card opens the detail.
import type { ReactNode } from "react";
import { ProfileAvatar } from "../profile/buzz/features/profile/ui/ProfileAvatar";
import { IdentityInitialsAvatar } from "../agent-library/IdentityInitialsAvatar";

export const CARD_GRID_CLASS = "grid w-full grid-cols-[repeat(auto-fill,minmax(15.5rem,1fr))] gap-3";

export function AgentCard({ testId, label, description, avatar, avatarUrl, status, meta, ariaLabel, disabled, onClick }: {
  testId: string;
  label: string;
  /** One line under the name (description, or `$slug` for a Skill). */
  description?: ReactNode;
  /** A custom avatar node (e.g. the Skill glyph); otherwise the image or initials. */
  avatar?: ReactNode;
  avatarUrl?: string | null;
  status?: ReactNode;
  /** A muted trailing line (owner, version). */
  meta?: ReactNode;
  ariaLabel: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const url = avatarUrl?.trim() || null;
  return <div data-testid={testId}
    className="group relative flex min-h-[5.5rem] min-w-0 items-start gap-3 rounded-xl border border-border bg-card p-3.5 text-left transition-[box-shadow,border-color] duration-150 hover:border-input hover:shadow-sm">
    <button type="button" aria-label={ariaLabel} disabled={disabled} onClick={onClick}
      className="absolute inset-0 z-10 rounded-xl focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed">
      <span className="sr-only">{ariaLabel}</span>
    </button>
    <span aria-hidden className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[0.875rem]">
      {avatar ?? (url
        ? <ProfileAvatar avatarUrl={url} label={label} shape="squircle" className="h-full w-full bg-muted shadow-none" iconClassName="h-5 w-5" />
        : <IdentityInitialsAvatar label={label} size={44} className="shadow-none" />)}
    </span>
    <span className="pointer-events-none relative flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate text-sm font-semibold text-foreground">{label}</span>
      </span>
      {description ? <span className="line-clamp-1 min-w-0 text-xs text-muted-foreground">{description}</span> : null}
      {status || meta ? <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {status}{meta ? <span className="min-w-0 truncate">{meta}</span> : null}
      </span> : null}
    </span>
  </div>;
}
