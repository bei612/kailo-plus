// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/channels/ui/ChannelComposerActivityAccessory.tsx, original DOM/classes over the
// shared ComposerActivityAccessory and TypingIndicatorRow. The original CardMintComposerChip is not
// rendered: Agent card minting is a Desktop-local feature with no Kailo source.
import type { ComponentProps } from "react";

import { ComposerActivityAccessory } from "../messages/ComposerActivityAccessory";
import { TypingIndicatorRow } from "../messages/TypingIndicatorRow";
import { BotActivityComposerAction } from "./BotActivityBar";

type ChannelComposerActivityAccessoryProps = {
  agents: ComponentProps<typeof BotActivityComposerAction>["agents"];
  channelId: string | null;
  channel: ComponentProps<typeof TypingIndicatorRow>["channel"];
  currentPubkey: ComponentProps<typeof TypingIndicatorRow>["currentPubkey"];
  onOpenAgentSession: ComponentProps<typeof BotActivityComposerAction>["onOpenAgentSession"];
  openAgentSessionPubkey: ComponentProps<typeof BotActivityComposerAction>["openAgentSessionPubkey"];
  profiles: ComponentProps<typeof TypingIndicatorRow>["profiles"];
  resolveMediaUrl?: (url: string) => string | undefined;
  typingPubkeys: string[];
  visible: boolean;
  workingBotPubkeys: string[];
};

export function ChannelComposerActivityAccessory({
  agents,
  channelId,
  channel,
  currentPubkey,
  onOpenAgentSession,
  openAgentSessionPubkey,
  profiles,
  resolveMediaUrl,
  typingPubkeys,
  visible,
  workingBotPubkeys,
}: ChannelComposerActivityAccessoryProps) {
  return (
    <ComposerActivityAccessory
      className="px-5"
      testId="channel-composer-activity-row"
      visible={visible}
    >
      <div className="flex w-full items-center gap-2 overflow-visible pl-2">
        {workingBotPubkeys.length > 0 ? (
          <div className="flex min-w-0 flex-1 overflow-visible">
            <BotActivityComposerAction
              agents={agents}
              channelId={channelId}
              onOpenAgentSession={onOpenAgentSession}
              openAgentSessionPubkey={openAgentSessionPubkey}
              resolveMediaUrl={resolveMediaUrl}
              workingBotPubkeys={workingBotPubkeys}
              variant="inline"
            />
          </div>
        ) : null}
        {typingPubkeys.length > 0 ? (
          <TypingIndicatorRow
            channel={channel}
            className="min-w-0 flex-1 py-0 pl-[calc(0.75rem+1px)] pr-0 sm:pl-[calc(1rem+1px)]"
            currentPubkey={currentPubkey}
            profiles={profiles}
            resolveMediaUrl={resolveMediaUrl}
            typingPubkeys={typingPubkeys}
          />
        ) : null}
      </div>
    </ComposerActivityAccessory>
  );
}
