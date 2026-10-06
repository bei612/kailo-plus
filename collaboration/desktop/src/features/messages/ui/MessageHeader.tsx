import type * as React from "react";
import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";
export { MessageHeaderRow, MessageAuthorText } from "@client-kit/platform/react/messages";

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
