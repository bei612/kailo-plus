import type { ComponentProps } from "react";
import {
  UserProfilePopoverBody,
  UserProfilePopoverSurface,
  type ProfilePopoverBodyProps,
} from "@client-kit/platform/react/pulse";
import { useUiT } from "@client-kit/platform/react/context";

import { useNativeSession } from "@/features/platform/activeCommunity";
import { useUserProfileQuery } from "@/features/profile/hooks";
import { useProfilePanel } from "@/shared/context/ProfilePanelContext";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";

type UserProfilePopoverProps = Omit<
  ComponentProps<typeof UserProfilePopoverSurface>,
  "onOpenProfile" | "renderBody"
>;

// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/profile/ui/UserProfilePopover.tsx. The original trigger,
// hover timing and public profile surface are shared with Web; only native
// profile reads, panel navigation and media rewriting belong to this host.
export function UserProfilePopover(props: UserProfilePopoverProps) {
  const { openProfilePanel } = useProfilePanel();
  return (
    <UserProfilePopoverSurface
      {...props}
      onOpenProfile={openProfilePanel ?? undefined}
      renderBody={(body) => <NativeProfilePopoverBody {...body} />}
    />
  );
}

function NativeProfilePopoverBody(props: ProfilePopoverBodyProps) {
  const session = useNativeSession();
  const t = useUiT();
  const scope = `${session.facts.communityHost}:${session.devicePubkey}`;
  const query = useUserProfileQuery(props.pubkey, scope);
  const profile = query.isSuccess && !query.isFetching && query.data.pubkey === props.pubkey
    ? query.data : undefined;
  const failed = query.isError || (query.isSuccess && !query.isFetching && !profile);
  return (
    <UserProfilePopoverBody
      {...props}
      profile={profile}
      mediaUrl={rewriteRelayUrl}
      status={!profile ? <p role={failed ? "alert" : "status"}>
        {t(failed ? "platform.loadFailed" : "platform.loading")}
      </p> : undefined}
    />
  );
}
