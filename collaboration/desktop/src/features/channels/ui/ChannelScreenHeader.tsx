import { Copy } from "lucide-react";
import { translate } from "@client-kit/platform/i18n";
import { useDeviceLocale } from "@client-kit/platform/react/context";
import type * as React from "react";
import { toast } from "sonner";

import { getChannelDescription } from "@/features/channels/lib/channelDescription";
import type { EphemeralChannelDisplay } from "@/features/channels/lib/ephemeralChannel";
import { ChannelGlyph } from "@/features/channels/ui/ChannelGlyph";
import { ChannelHeaderStatusBadge } from "@/features/channels/ui/ChannelHeaderStatusBadge";
import type { Channel } from "@/shared/api/types";
import { channelChrome } from "@/shared/layout/chromeLayout";
import { writeTextToClipboard } from "@/shared/lib/clipboard";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";

type ChannelScreenHeaderProps = {
  activeChannel: Channel;
  activeChannelEphemeralDisplay: EphemeralChannelDisplay | null;
  chromeWrapperRef?: React.Ref<HTMLDivElement>;
};

export function ChannelScreenHeader({
  activeChannel,
  activeChannelEphemeralDisplay,
  chromeWrapperRef,
}: ChannelScreenHeaderProps) {
  const title = activeChannel.name;
  const locale = useDeviceLocale();
  const trimmedDescription = getChannelDescription(activeChannel)?.trim() ?? "";

  async function handleCopyTitle() {
    const value = title.trim();
    if (!value) return;

    try {
      await writeTextToClipboard(value);
      toast.success(translate(locale, "platform.profile.copied"));
    } catch {
      toast.error(translate(locale, "platform.profile.copyFailed"));
    }
  }

  return (
    <div
      ref={chromeWrapperRef}
      className={cn(
        "pointer-events-none relative z-40 overflow-visible rounded-tl-xl bg-transparent",
        channelChrome.negativeMargin,
      )}
    >
      <header
        className="pointer-events-auto relative z-30 min-w-0 shrink-0 cursor-default select-none bg-transparent px-5 py-2 transition-[margin,padding] duration-200 ease-linear"
        data-testid="chat-header"
        data-tauri-drag-region
      >
        <div className="flex h-9 min-w-0 items-center gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="group/title flex min-w-0 items-center gap-[4px] overflow-hidden">
              <div className="flex shrink-0 items-center">
                <ChannelGlyph
                  channel={activeChannel}
                  className="h-4 w-4 translate-y-px text-muted-foreground"
                />
              </div>
              <h1
                className="min-w-0 translate-y-px truncate text-base font-semibold leading-6 tracking-tight"
                data-testid="chat-title"
                title={trimmedDescription || undefined}
              >
                {title}
              </h1>
              <Button
                aria-label={`${translate(locale, "sidebar.copyName")}: ${title}`}
                className="h-6 w-6 shrink-0 opacity-0 text-muted-foreground transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/title:opacity-100"
                onClick={() => void handleCopyTitle()}
                size="icon-xs"
                title={translate(locale, "sidebar.copyName")}
                type="button"
                variant="ghost"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
              {activeChannelEphemeralDisplay ? (
                <div className="flex shrink-0 flex-wrap items-center gap-1">
                  <ChannelHeaderStatusBadge
                    ephemeralDisplay={activeChannelEphemeralDisplay}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>
    </div>
  );
}
