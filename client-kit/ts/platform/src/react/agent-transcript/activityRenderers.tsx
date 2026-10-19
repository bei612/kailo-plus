// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/agents/ui/activityRenderClasses/{TranscriptActivityItem,
// MessageActivity,ThoughtActivity,PlanActivity,LifecycleActivity,RawRailActivity,
// SuppressedActivity,ToolActivity,UserMessageBubble,TranscriptTimestamp}.tsx.
// Original DOM and classes. Kailo differences: there are no permission items
// (no interactive approval path) and no message deep links (Codex user items
// carry the Invocation ID, not the Buzz event), so those branches are omitted.
import * as React from "react";
import { AlertCircle, ChevronDown } from "lucide-react";

import { useUiT } from "../context";
import {
  resolveUserLabel,
  type UserProfileLookup,
} from "../messages/system/identity";
import { UserAvatar } from "../messages/UserAvatar";
import { cn } from "../profile/buzz/shared/lib/cn";
import {
  ActivityRow,
  ActivityRowContent,
  ActivityRowLabel,
  splitActivityRowLabel,
} from "./ActivityRow";
import { useAgentSessionTranscriptVariant } from "./agentSessionTranscriptContext";
import type { AgentActivityRenderClass, TranscriptItem } from "./agentSessionTypes";
import {
  formatTranscriptTime,
  formatTranscriptTimestampTitle,
  getToolDurationDisplay,
} from "./agentSessionUtils";
import { verbLabel } from "./agentSessionToolClassifier";
import { TranscriptMarkdown } from "./host";
import { PromptSectionList } from "./PromptSectionList";
import { ToolItem } from "./ToolItem";

export type AgentTranscriptIdentityProps = {
  agentAvatarUrl: string | null;
  agentName: string;
  agentPubkey: string;
};

export type ActivityRenderClassItemProps = AgentTranscriptIdentityProps & {
  item: TranscriptItem;
  profiles?: UserProfileLookup;
};

type ActivityRenderClassPresenter = React.ComponentType<ActivityRenderClassItemProps>;

export function TranscriptTimestamp({
  className,
  timestamp,
}: {
  className?: string;
  timestamp: string;
}) {
  const formatted = formatTranscriptTime(timestamp);
  if (!formatted) return null;
  return (
    <span
      className={cn(
        "shrink-0 cursor-default text-xs text-muted-foreground/60",
        className,
      )}
      title={formatTranscriptTimestampTitle(timestamp)}
    >
      {formatted}
    </span>
  );
}

function useTranscriptBubbleOverflow(enabled: boolean) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [hasOverflow, setHasOverflow] = React.useState(false);

  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!enabled || !element) {
      setHasOverflow(false);
      return;
    }

    const updateOverflow = () => {
      setHasOverflow(element.scrollHeight > element.clientHeight + 1);
    };

    updateOverflow();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(updateOverflow);
    observer.observe(element);
    if (element.firstElementChild) {
      observer.observe(element.firstElementChild);
    }

    return () => observer.disconnect();
  }, [enabled]);

  return [ref, hasOverflow] as const;
}

export function UserMessageBubble({
  bubbleClassName,
  children,
  className,
  footer,
  item,
  profiles,
}: {
  bubbleClassName?: string;
  children?: React.ReactNode;
  className?: string;
  footer?: React.ReactNode;
  item: Extract<TranscriptItem, { type: "message" }>;
  profiles?: UserProfileLookup;
}) {
  const t = useUiT();
  const variant = useAgentSessionTranscriptVariant();
  const isCompactPreview = variant === "compactPreview";
  const shouldClampBubble = !isCompactPreview;
  const [bubbleRef, hasBubbleOverflow] =
    useTranscriptBubbleOverflow(shouldClampBubble);
  const text = item.text.trim();
  const authorProfile = item.authorPubkey
    ? profiles?.[item.authorPubkey.toLowerCase()]
    : null;
  const authorLabel = item.authorPubkey
    ? resolveUserLabel({
        pubkey: item.authorPubkey,
        fallbackName: item.title,
        profiles,
      })
    : item.title || t("agentTranscript.user");

  return (
    <div
      className={cn(
        "flex flex-row items-start animate-in fade-in duration-200 motion-reduce:animate-none",
        isCompactPreview ? "justify-start" : "justify-end",
      )}
      data-role="user-message"
      data-testid="transcript-user-message"
    >
      {isCompactPreview ? null : (
        <UserAvatar
          avatarUrl={authorProfile?.avatarUrl ?? null}
          className="order-last ml-2 mt-1 size-7 shrink-0 text-xs"
          displayName={authorLabel}
          shape={authorProfile?.isAgent ? "squircle" : "circle"}
          size="sm"
        />
      )}
      <div
        className={cn(
          "group relative flex min-w-0 flex-1 flex-col items-end gap-1",
          isCompactPreview && "items-start",
          className,
        )}
      >
        <div
          className={cn(
            "w-full min-w-0 rounded-2xl border border-border/70 bg-transparent p-3 text-sm leading-relaxed text-foreground",
            shouldClampBubble && "relative max-h-36 overflow-hidden",
            isCompactPreview && "p-2 text-xs leading-4",
            bubbleClassName,
          )}
          ref={bubbleRef}
        >
          <TranscriptMarkdown
            className={isCompactPreview ? "text-xs leading-4" : "leading-5"}
            content={text || " "}
          />
          {children}
          {hasBubbleOverflow ? (
            <span className="pointer-events-none absolute inset-x-0 bottom-0 h-8 rounded-b-2xl bg-linear-to-b from-transparent to-background" />
          ) : null}
        </div>
        {footer}
      </div>
    </div>
  );
}

export function ToolActivity(props: ActivityRenderClassItemProps) {
  const { item } = props;
  if (item.type !== "tool") {
    return null;
  }

  return <ToolItem {...props} item={item} />;
}

export function MessageActivity(props: ActivityRenderClassItemProps) {
  const variant = useAgentSessionTranscriptVariant();
  if (props.item.type === "tool") {
    return <ToolActivity {...props} />;
  }
  if (props.item.type !== "message") {
    return null;
  }
  const item = props.item;
  const isCompactPreview = variant === "compactPreview";
  const text = item.text.trim();

  if (item.role !== "assistant") {
    return (
      <UserMessageBubble
        footer={<TranscriptTimestamp timestamp={item.timestamp} />}
        item={item}
        profiles={props.profiles}
      />
    );
  }

  return (
    <div
      className="flex flex-row animate-in fade-in duration-200 motion-reduce:animate-none"
      data-role="assistant-message"
      data-testid="transcript-assistant-message"
    >
      <div className="group relative flex w-full min-w-0 flex-col items-start gap-1">
        <div
          className={
            isCompactPreview
              ? "w-full min-w-0 text-xs leading-4"
              : "w-full min-w-0 text-sm"
          }
          title={formatTranscriptTimestampTitle(item.timestamp)}
        >
          <TranscriptMarkdown
            className={isCompactPreview ? "text-xs leading-4" : "leading-5"}
            content={text || " "}
          />
        </div>
      </div>
    </div>
  );
}

export function ThoughtActivity(props: ActivityRenderClassItemProps) {
  if (props.item.type === "tool") {
    return <ToolActivity {...props} />;
  }
  if (props.item.type !== "thought") {
    return null;
  }

  return (
    <ActivityRow
      testId="transcript-thought-item"
      title={formatTranscriptTimestampTitle(props.item.timestamp)}
    >
      <ActivityRowLabel openToneScope="tool" verb={props.item.title} />
      <ActivityRowContent className="pt-1 pb-1.5 text-sm leading-5 text-muted-foreground">
        <TranscriptMarkdown
          className="leading-5"
          content={props.item.text.trim() || " "}
        />
      </ActivityRowContent>
    </ActivityRow>
  );
}

export function PlanActivity(props: ActivityRenderClassItemProps) {
  const t = useUiT();
  if (props.item.type === "tool") {
    return <ToolActivity {...props} />;
  }
  if (props.item.type !== "plan") {
    return null;
  }

  return (
    <ActivityRow
      testId="transcript-plan-item"
      title={formatTranscriptTimestampTitle(props.item.timestamp)}
    >
      <ActivityRowLabel
        object={t("agentTranscript.object.plan")}
        openToneScope="tool"
        verb={verbLabel("Updated")}
      />
      <ActivityRowContent className="pt-1 pb-1.5 text-sm leading-5 text-muted-foreground">
        <TranscriptMarkdown
          className="leading-5"
          content={props.item.text.trim() || t("agentTranscript.noPlanDetails")}
        />
      </ActivityRowContent>
    </ActivityRow>
  );
}

export function LifecycleActivity(props: ActivityRenderClassItemProps) {
  if (props.item.type === "tool") {
    return <ToolActivity {...props} />;
  }
  if (props.item.type !== "lifecycle") {
    return null;
  }

  const timestampTitle = formatTranscriptTimestampTitle(props.item.timestamp);
  if (props.item.renderClass === "error") {
    return (
      <div
        className="rounded-md border border-destructive/20 bg-destructive/5 px-2 py-1.5 text-left text-xs text-destructive"
        data-testid="transcript-lifecycle-item"
        title={timestampTitle}
      >
        <AlertCircle className="mr-1.5 inline h-3.5 w-3.5 align-text-bottom" />
        <span className="font-medium">{props.item.title}</span>
        {props.item.text ? (
          <span className="opacity-80"> · {props.item.text}</span>
        ) : null}
      </div>
    );
  }

  return (
    <ActivityRow testId="transcript-lifecycle-item" title={timestampTitle}>
      <ActivityRowLabel
        object={props.item.text || undefined}
        openToneScope="none"
        verb={props.item.title}
      />
    </ActivityRow>
  );
}

export function RawRailActivity(props: ActivityRenderClassItemProps) {
  const t = useUiT();
  if (props.item.type === "tool") {
    return <ToolActivity {...props} />;
  }
  if (props.item.type !== "metadata") {
    return null;
  }

  const sectionCount = props.item.sections.length;
  const isRawPayload = props.item.acpSource === "raw_json_rpc";

  return (
    <ActivityRow
      testId="transcript-metadata-item"
      title={formatTranscriptTimestampTitle(props.item.timestamp)}
    >
      <ActivityRowLabel
        object={t(sectionCount === 1 ? "agentTranscript.sections.one" : "agentTranscript.sections.other", {
          count: sectionCount,
        })}
        openToneScope="tool"
        verb={props.item.title}
      />
      <ActivityRowContent className="flex flex-col gap-3 py-2">
        {isRawPayload ? (
          props.item.sections.map((section) => (
            <details
              className="group/section"
              key={`${section.title}:${section.body.slice(0, 48)}`}
            >
              <summary className="inline-flex max-w-full cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted-foreground/60 group-open/section:text-foreground">
                <span className="truncate">{section.title}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform group-open/section:rotate-180 group-open/section:text-foreground" />
              </summary>
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap wrap-break-word rounded-md bg-muted/50 px-3 py-2 font-mono text-xs leading-5 text-muted-foreground">
                {section.body.trim() || t("agentTranscript.noMetadata")}
              </pre>
            </details>
          ))
        ) : (
          <PromptSectionList sections={props.item.sections} />
        )}
      </ActivityRowContent>
    </ActivityRow>
  );
}

export function SuppressedActivity(props: ActivityRenderClassItemProps) {
  if (props.item.type !== "tool") {
    return null;
  }

  const action = props.item.descriptor.action;
  const labelParts =
    action ?? splitActivityRowLabel(props.item.descriptor.label);
  const duration = getToolDurationDisplay(props.item);

  return (
    <ActivityRow
      testId="transcript-suppressed-item"
      title={formatTranscriptTimestampTitle(props.item.timestamp)}
    >
      <ActivityRowLabel
        object={labelParts?.object ?? props.item.descriptor.preview}
        openToneScope="none"
        verb={labelParts?.verb ?? props.item.descriptor.label}
      />
      {duration ? (
        <span className="shrink-0 text-xs text-muted-foreground/60">
          {duration}
        </span>
      ) : null}
    </ActivityRow>
  );
}

// Exhaustive render-class routing. Several semantic classes intentionally share
// a presenter when their row treatment is the same.
export const ACTIVITY_RENDER_CLASS_PRESENTERS = {
  message: MessageActivity,
  "relay-op": ToolActivity,
  "file-edit": ToolActivity,
  "file-read": ToolActivity,
  "skill-read": ToolActivity,
  image: ToolActivity,
  shell: ToolActivity,
  status: LifecycleActivity,
  thought: ThoughtActivity,
  plan: PlanActivity,
  permission: LifecycleActivity,
  error: LifecycleActivity,
  generic: ToolActivity,
  "raw-rail": RawRailActivity,
  suppressed: SuppressedActivity,
} satisfies Record<AgentActivityRenderClass, ActivityRenderClassPresenter>;

export function TranscriptActivityItem(props: ActivityRenderClassItemProps) {
  const Presenter = ACTIVITY_RENDER_CLASS_PRESENTERS[props.item.renderClass];
  return <Presenter {...props} />;
}
