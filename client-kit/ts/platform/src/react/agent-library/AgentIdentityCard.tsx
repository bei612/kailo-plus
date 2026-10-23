// Reused from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/agents/ui/AgentIdentityCard.tsx; governed selection only.
import type { ReactNode } from "react";

import { ProfileAvatar } from "../profile/buzz/features/profile/ui/ProfileAvatar";
import { cn } from "../profile/buzz/shared/lib/cn";
import { IdentityInitialsAvatar } from "./IdentityInitialsAvatar";

type AgentIdentityCardProps = {
  actions?: ReactNode;
  disabled?: boolean;
  ariaLabel: string;
  avatar?: ReactNode;
  avatarUrl?: string | null;
  footerAccessory?: ReactNode;
  dataTestId: string;
  label: string;
  /**
   * Second line under the agent name: the effective description when one
   * resolves (owner-authored — see `lib/agentDescription.ts`),
   * otherwise the model label. Callers compose the fallback.
   */
  subtitle?: string | null;
  onClick: () => void;
  /** Optional badge rendered below the label (e.g. "Restart required"). */
  statusBadge?: ReactNode;
};

export function AgentIdentityCard({
  actions,
  disabled = false,
  ariaLabel,
  avatar,
  avatarUrl,
  dataTestId,
  footerAccessory,
  label,
  subtitle,
  onClick,
  statusBadge,
}: AgentIdentityCardProps) {
  const trimmedAvatarUrl = avatarUrl?.trim() || null;

  return (
    <div
      className={cn(
        // DD-141 §10: Kailo identity card — card surface, brand band and aura, gentle lift.
        "group relative aspect-[4/5] w-full min-w-0 overflow-hidden rounded-xl border border-border bg-card text-left transition-[transform,box-shadow,border-color] duration-200 ease-out-expo hover:-translate-y-px hover:border-input hover:shadow-md",
      )}
      data-testid={dataTestId}
    >
      <span aria-hidden="true" className="kailo-card-aura pointer-events-none absolute inset-0" />
      <span aria-hidden="true" className="kailo-card-band pointer-events-none absolute inset-x-0 top-0 h-[3px]" />
      <button
        aria-label={ariaLabel}
        disabled={disabled}
        className="absolute inset-0 z-10 rounded-xl focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onClick}
        type="button"
      ><span className="sr-only">{ariaLabel}</span></button>

      <div className="pointer-events-none relative z-20 flex h-full w-full min-w-0 flex-col items-center justify-center gap-5 px-4 pb-12 text-center">
        <div className="flex h-24 w-24 items-center justify-center">
          {avatar ??
            (trimmedAvatarUrl ? (
              <ProfileAvatar
                avatarUrl={trimmedAvatarUrl}
                className="h-full w-full border-[3px] border-background bg-muted shadow-none"
                iconClassName="h-8 w-8"
                label={label}
                shape="squircle"
              />
            ) : (
              <IdentityInitialsAvatar
                className="shadow-none"
                label={label}
                size={96}
              />
            ))}
        </div>
      </div>

      {actions ? (
        <div className="absolute top-3 right-3 z-40">{actions}</div>
      ) : null}

      <div className="pointer-events-none absolute right-3 bottom-3 left-3 z-30 flex min-w-0 items-end gap-2 text-left text-sm leading-5">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="min-w-0 truncate font-semibold text-foreground tracking-normal">
            {label}
          </span>
          {subtitle ? (
            <span className="line-clamp-2 min-w-0 text-xs font-normal text-muted-foreground">
              {subtitle}
            </span>
          ) : null}
          {/* pointer-events-auto: the overlay button above has pointer-events-none
              on this container, but the status badge itself (a sibling of the button
              in z-order) needs hover so the restart diff tooltip can fire. */}
          {statusBadge ? (
            <div className="pointer-events-auto">{statusBadge}</div>
          ) : null}
        </div>
        {footerAccessory ? (
          <div className="shrink-0">{footerAccessory}</div>
        ) : null}
      </div>
    </div>
  );
}
