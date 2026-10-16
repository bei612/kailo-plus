// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/presence/ui/PresenceBadge.tsx.
import type * as React from "react";

import { useUiT } from "../../context";
import { cn } from "../../profile/buzz/shared/lib/cn";
import {
  getPresenceDotClassName,
  getPresenceLabelKey,
  type PresenceStatus,
} from "../lib/presence";

type PresenceBadgeProps = {
  status: PresenceStatus;
  className?: string;
  label?: string;
} & React.HTMLAttributes<HTMLSpanElement>;

export function PresenceDot({
  status,
  className,
  ...props
}: {
  status: PresenceStatus;
  className?: string;
} & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-2.5 w-2.5 shrink-0 rounded-full",
        getPresenceDotClassName(status),
        className,
      )}
      {...props}
    />
  );
}

export function PresenceBadge({
  status,
  className,
  label,
  ...props
}: PresenceBadgeProps) {
  const t = useUiT();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border/80 bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground",
        className,
      )}
      {...props}
    >
      <PresenceDot status={status} />
      <span>{label ?? t(getPresenceLabelKey(status))}</span>
    </span>
  );
}

/**
 * The original member-card corner dot (MembersSidebarMemberCard): only rendered for an
 * actual presence fact, labelled for assistive technology.
 */
export function PresenceCornerDot({
  status,
  testId,
}: {
  status: PresenceStatus | undefined;
  testId?: string;
}) {
  const t = useUiT();
  if (!status) return null;
  return (
    <span
      aria-label={t(getPresenceLabelKey(status))}
      className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-background"
      data-presence-status={status}
      data-testid={testId}
      role="img"
    >
      <PresenceDot className="h-2 w-2" status={status} />
    </span>
  );
}
