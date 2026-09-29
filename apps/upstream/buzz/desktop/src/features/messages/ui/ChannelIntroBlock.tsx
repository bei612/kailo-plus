import { Hash } from "lucide-react";

import { cn } from "@/shared/lib/cn";

export type ChannelIntro = {
  channelKindLabel: string;
  channelName: string;
  description: string | null;
};

/**
 * The empty-channel intro block: channel icon, heading, kind label, and
 * description. Rendered both as the virtualized timeline's leading row and
 * as the non-virtualized empty state — one component so the two surfaces
 * cannot drift and the first message always lands below it without layout
 * shift.
 */
export function ChannelIntroBlock({
  className,
  intro,
}: {
  className?: string;
  intro: ChannelIntro;
}) {
  return (
    <div
      className={cn(
        "flex w-full flex-col items-start px-3 text-left",
        className,
      )}
      data-testid="message-channel-intro"
    >
      <div
        className="flex h-[60px] w-[60px] items-center justify-center rounded-2xl border border-border/70 bg-muted/40 text-muted-foreground"
        data-testid="message-channel-intro-icon"
      >
        <Hash aria-hidden className="h-7 w-7" />
      </div>
      <p className="mt-4 max-w-2xl truncate text-xl font-semibold leading-7 tracking-tight text-foreground">
        #{intro.channelName}
      </p>
      <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
        This is the beginning of the{" "}
        <span className="font-medium text-foreground">
          {intro.channelKindLabel}
        </span>
        .
      </p>
      {intro.description ? (
        <p className="mt-2 max-w-xl whitespace-pre-line text-sm leading-5 text-muted-foreground">
          {intro.description}
        </p>
      ) : null}
    </div>
  );
}
