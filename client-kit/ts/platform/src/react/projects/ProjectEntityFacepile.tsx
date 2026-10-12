// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectEntityListRow.tsx::ProjectEntityFacepile.
import { resolveUserLabel, type UserProfileLookup } from "../messages/system/identity";
import { UserProfilePopover } from "../pulse/UserProfilePopover";
import { UserAvatar } from "../messages/UserAvatar";
import { cn } from "../profile/buzz/shared/lib/cn";
import { useUiT } from "../context";
export function ProjectEntityFacepile({
  interactive = false,
  participants,
  profiles,
}: {
  /** Wrap each avatar in a profile popover. Leave off when the facepile is
   * nested inside another button (nested interactive elements are invalid). */
  interactive?: boolean;
  participants: string[];
  profiles: UserProfileLookup | undefined;
}) {
  const t = useUiT();
  const shown = participants.slice(0, 4);
  const overflow = participants.length - shown.length;
  if (shown.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center">
      {shown.map((pubkey, index) => {
        const label = resolveUserLabel({ profiles, pubkey });
        const isAgent = profiles?.[pubkey]?.isAgent === true;
        const separatorClassName = cn(
          "isolate relative inline-flex before:pointer-events-none before:absolute before:-inset-0.5 before:bg-background before:content-['']",
          isAgent ? "before:rounded-squircle" : "before:rounded-full",
        );
        const avatar = (
          <UserAvatar
            avatarUrl={profiles?.[pubkey]?.avatarUrl ?? null}
            displayName={label}
            shape={isAgent ? "squircle" : "circle"}
            size="xs"
          />
        );
        if (!interactive) {
          return (
            <span
              className={cn(separatorClassName, index > 0 && "-ml-1.5")}
              key={pubkey}
              title={label}
            >
              <span className="relative z-10">{avatar}</span>
            </span>
          );
        }
        return (
          <UserProfilePopover
            key={pubkey}
            pubkey={pubkey}
            triggerClassName={cn(
              separatorClassName,
              "rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:before:opacity-0",
              index > 0 && "-ml-1.5",
            )}
            triggerElement="span"
            triggerAriaLabel={t("projects.discussion.viewProfile",{name:label})}
          >
            <span className="relative z-10" title={label}>
              {avatar}
            </span>
          </UserProfilePopover>
        );
      })}
      {overflow > 0 ? (
        <span className="-ml-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-muted text-3xs text-muted-foreground/65 ring-2 ring-background">
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}
