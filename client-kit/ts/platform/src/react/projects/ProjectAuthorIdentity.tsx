// Fixed Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectAuthorIdentity.tsx.
import { useUiT } from "../context";
import type { UserProfileLookup } from "../messages/system/identity";
import { UserProfilePopover } from "../pulse/UserProfilePopover";
import { normalizePubkey } from "../conversations/pubkey";
import { Tooltip, TooltipContent, TooltipTrigger } from "../sidebar/tooltip";
import { UserAvatar } from "../messages/UserAvatar";

/** Compact work-item author identity with a minimal hover summary. */
export function ProjectAuthorIdentity({
  label,
  labelClassName,
  profiles,
  pubkey,
  testId,
}: {
  label: string;
  labelClassName?: string;
  profiles?: UserProfileLookup;
  pubkey: string;
  testId?: string;
}) {
  const t = useUiT();
  const profile = profiles?.[normalizePubkey(pubkey)];
  const roleLabel =
    profile?.isAgent === true
      ? t("projects.author.agent")
      : t("projects.author.person");

  return (
    <span className="inline-flex align-middle">
      <UserProfilePopover
        enableHoverPopover={false}
        pubkey={pubkey}
        triggerElement="span"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label={label}
              className="relative z-10 inline-flex items-center gap-1 rounded-sm hover:underline focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
              data-testid={testId}
              type="button"
            >
              <UserAvatar
                accent={profile?.isAgent === true}
                avatarUrl={profile?.avatarUrl ?? null}
                displayName={label}
                shape={profile?.isAgent ? "squircle" : "circle"}
                fallbackDelayMs={0}
                size="xs"
                testId={testId ? `${testId}-avatar` : undefined}
              />
              <span
                className={labelClassName}
                data-testid={testId ? `${testId}-label` : undefined}
              >
                {label}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent
            className="flex items-center gap-2 px-2.5 py-2"
            data-testid={testId ? `${testId}-rollover` : undefined}
            side="top"
          >
            <UserAvatar
              accent={profile?.isAgent === true}
              avatarUrl={profile?.avatarUrl ?? null}
              displayName={label}
              shape={profile?.isAgent ? "squircle" : "circle"}
              fallbackDelayMs={0}
              size="sm"
            />
            <span className="min-w-0">
              <span className="block truncate font-medium">{label}</span>
              <span className="block text-secondary-foreground/70">
                {roleLabel}
              </span>
            </span>
          </TooltipContent>
        </Tooltip>
      </UserProfilePopover>
    </span>
  );
}
