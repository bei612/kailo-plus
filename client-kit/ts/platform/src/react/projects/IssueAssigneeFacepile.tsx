// Fixed Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/IssueAssigneesRow.tsx::IssueAssigneeFacepile.
import {useUiT} from "../context";
import {normalizePubkey} from "../conversations/pubkey";
import {resolveUserLabel,type UserProfileLookup} from "../messages/system/identity";
import {UserAvatar} from "../messages/UserAvatar";
import {cn} from "../profile/buzz/shared/lib/cn";
/** Compact overlapping assignee avatars for issue list rows. */
export function IssueAssigneeFacepile({
  assignees,
  profiles,
}: {
  assignees: string[];
  profiles?: UserProfileLookup;
}) {
  const t = useUiT();
  if (assignees.length === 0) return null;
  return (
    <span
      className="flex shrink-0 -space-x-1"
      data-testid="project-issue-assignees"
    >
      {assignees.slice(0, 3).map((pubkey) => {
        const profile = profiles?.[normalizePubkey(pubkey)];
        const label = resolveUserLabel({pubkey,profiles});
        return (
          <span
            className={cn(
              "inline-flex ring-1 ring-background",
              profile?.isAgent ? "rounded-squircle" : "rounded-full",
            )}
            key={pubkey}
            title={t("projects.sheet.assignedTo",{name:label})}
          >
            <UserAvatar
              accent={profile?.isAgent === true}
              avatarUrl={profile?.avatarUrl ?? null}
              displayName={label}
              shape={profile?.isAgent ? "squircle" : "circle"}
              size="xs"
            />
          </span>
        );
      })}
    </span>
  );
}
