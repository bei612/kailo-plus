import type { DiscoverableWorkspace } from "@client-kit/contracts";
import { ChannelJoinButton } from "@client-kit/platform/react/channel-browser";
import { useDeviceLocale } from "@client-kit/platform/react/context";
import { ChatHeader } from "@client-kit/platform/react/messages/chat-header";
import { translate } from "@client-kit/platform/i18n";
import { toast } from "sonner";

import { ChannelGlyph } from "@/features/channels/ui/ChannelGlyph";
import { writeTextToClipboard } from "@/shared/lib/clipboard";

/**
 * Buzz 779af8886caae1317b4de962082429867ab61503
 * desktop/src/features/channels/ui/ChannelScreenHeader.tsx showJoinButton branch for a native
 * route to an open channel this identity has not joined. A governed channel's timeline is
 * roster-read only, so the body states the membership requirement instead of previewing it.
 */
export function ChannelJoinScreen({ workspace, onJoined }: {
  workspace: DiscoverableWorkspace;
  onJoined: (workspace: DiscoverableWorkspace) => void | Promise<void>;
}) {
  const locale = useDeviceLocale();
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-testid="channel-join-screen">
      <ChatHeader belowSystemChrome transparentChrome title={workspace.channel.name}
        description={workspace.channel.description ?? undefined} channelType={workspace.channel.channelType}
        visibility={workspace.visibility}
        leadingContent={<ChannelGlyph channel={{ channelType: workspace.channel.channelType, visibility: workspace.visibility }}
          className="h-4 w-4 translate-y-px text-muted-foreground" />}
        actions={<ChannelJoinButton key={workspace.id} workspace={workspace} onJoined={onJoined} />}
        onCopyTitle={async (title) => {
          try {
            await writeTextToClipboard(title);
            toast.success(translate(locale, "platform.profile.copied"));
          } catch {
            toast.error(translate(locale, "platform.profile.copyFailed"));
          }
        }} />
      <p className="px-6 py-4 text-sm font-medium" role="status">{translate(locale, "platform.channel.membershipRequired")}</p>
    </div>
  );
}
