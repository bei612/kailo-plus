import type * as React from "react";

import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";

import { cn } from "@/shared/lib/cn";

type MessageHeaderRowProps = {
  children: React.ReactNode;
  className?: string;
};

export function MessageHeaderRow({
  children,
  className,
}: MessageHeaderRowProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0 leading-message-author",
        className,
      )}
      data-testid="message-header"
    >
      {children}
    </div>
  );
}

type MessageAuthorTextProps = {
  as?: "div" | "h3" | "span";
  children: React.ReactNode;
  className?: string;
  hoverUnderline?: boolean;
};

export function MessageAuthorText({
  as: Component = "span",
  children,
  className,
  hoverUnderline = false,
}: MessageAuthorTextProps) {
  return (
    <Component
      className={cn(
        "truncate text-message font-semibold leading-message-author tracking-normal",
        hoverUnderline && "hover:underline",
        className,
      )}
      data-testid="message-author"
    >
      {children}
    </Component>
  );
}

/** Author name that opens the author's profile. */
export function MessageAuthorIdentity({
  pubkey,
  children,
}: {
  pubkey?: string | null;
  children: React.ReactNode;
}) {
  return pubkey ? (
    <UserProfilePopover pubkey={pubkey} triggerClassName="min-w-0 max-w-full">
      <button
        className="truncate rounded leading-message-author focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        type="button"
      >
        {children}
      </button>
    </UserProfilePopover>
  ) : (
    children
  );
}
