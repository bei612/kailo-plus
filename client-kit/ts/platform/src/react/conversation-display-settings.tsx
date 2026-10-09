// Buzz 779af8886caae1317b4de962082429867ab61503: extracted existing settings, not a second preference store.
import type { ReactNode } from "react";
import { Eye } from "lucide-react";
import {
  translate,
  type PlatformLocale,
  type PlatformMessageKey,
} from "../i18n";
import {
  previewConversationDensity,
  setConversationDensity,
  useConversationDensity,
  type ConversationDensity,
} from "../conversationDensityPreference";
import {
  previewFontSize,
  setFontSize,
  useFontSize,
  type FontSize,
} from "../fontSizePreference";
import { SegmentedControl } from "./segmented-control";
import { SettingsOptionRow } from "./settings-option-group";

const CONVERSATION_DENSITY_OPTIONS: readonly {
  value: ConversationDensity;
  label: PlatformMessageKey;
}[] = [
  {
    value: "compact",
    label: "platform.settings.compact",
  },
  {
    value: "comfortable",
    label: "platform.settings.comfortable",
  },
  {
    value: "spacious",
    label: "platform.settings.spacious",
  },
];

const FONT_SIZE_OPTIONS: readonly {
  value: FontSize;
  label: PlatformMessageKey;
}[] = [
  {
    value: "smaller",
    label: "platform.settings.smaller",
  },
  {
    value: "default",
    label: "platform.settings.default",
  },
  {
    value: "larger",
    label: "platform.settings.larger",
  },
];

function ConversationDensityPreviewMessage({
  avatar,
  author,
  children,
  timestamp,
}: {
  avatar: string;
  author: string;
  children: ReactNode;
  timestamp: string;
}) {
  return (
    <article className="flex gap-2.5 py-conversation-row">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
        {avatar}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 leading-message-author">
          <span className="text-message font-semibold leading-message-author tracking-normal text-foreground">
            {author}
          </span>
          <span className="text-message-timestamp font-normal text-muted-foreground/65">
            {timestamp}
          </span>
        </div>
        <div className="mt-conversation-body text-message font-normal tracking-normal text-foreground">
          {children}
        </div>
      </div>
    </article>
  );
}

function ConversationPreview({ locale }: { locale: PlatformLocale }) {
  return (
    <div className="px-4 py-3" data-testid="conversation-preview">
      <div
        aria-hidden="true"
        className="relative overflow-hidden rounded-xl border border-border/65 bg-transparent"
        data-testid="conversation-preview-surface"
      >
        <span className="absolute right-3.5 top-3 inline-flex items-center gap-1 text-2xs font-medium text-muted-foreground/55">
          <Eye aria-hidden="true" className="size-3" />
          {translate(locale, "platform.settings.preview")}
        </span>
        <div className="p-4" data-testid="conversation-preview-content">
          <ConversationDensityPreviewMessage
            avatar="M"
            author={translate(locale, "platform.settings.previewAuthorOne")}
            timestamp="9:41"
          >
            {translate(locale, "platform.settings.previewMessageOne")}
          </ConversationDensityPreviewMessage>
          <ConversationDensityPreviewMessage
            avatar="T"
            author={translate(locale, "platform.settings.previewAuthorTwo")}
            timestamp="9:43"
          >
            <p>{translate(locale, "platform.settings.previewMessageTwo")}</p>
            <p className="mt-conversation-paragraph">
              {translate(locale, "platform.settings.previewMessageThree")}
            </p>
          </ConversationDensityPreviewMessage>
        </div>
      </div>
    </div>
  );
}

/** App-wide type sizing and conversation-specific spacing controls. */
export function ConversationDisplaySettings({
  locale,
  name,
}: {
  locale: PlatformLocale;
  name: string;
}) {
  const density = useConversationDensity();
  const fontSize = useFontSize();

  return (
    <div data-testid="conversation-display-group">
      <SettingsOptionRow data-testid="font-size-row">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {translate(locale, "platform.settings.fontSize")}
          </p>
          <p
            className="text-sm font-normal text-muted-foreground/70"
            data-settings-subcopy
          >
            {translate(locale, "platform.settings.fontSizeDescription")}
          </p>
        </div>
        <SegmentedControl
          size="wide"
          legend={translate(locale, "platform.settings.fontSize")}
          onPreviewChange={previewFontSize}
          onValueChange={setFontSize}
          optionTestIdPrefix="font-size"
          options={FONT_SIZE_OPTIONS.map((option) => ({
            ...option,
            label: translate(locale, option.label),
          }))}
          testId="font-size-control"
          value={fontSize}
        />
      </SettingsOptionRow>
      <SettingsOptionRow data-testid="conversation-density-row">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {translate(locale, "platform.settings.conversationDensity")}
          </p>
          <p
            className="text-sm font-normal text-muted-foreground/70"
            data-settings-subcopy
          >
            {translate(locale, "platform.settings.densityDescription", { name })}
          </p>
        </div>
        <SegmentedControl
          size="wide"
          legend={translate(locale, "platform.settings.conversationDensity")}
          onPreviewChange={previewConversationDensity}
          onValueChange={setConversationDensity}
          optionTestIdPrefix="conversation-density"
          options={CONVERSATION_DENSITY_OPTIONS.map((option) => ({
            ...option,
            label: translate(locale, option.label),
          }))}
          testId="conversation-density-control"
          value={density}
        />
      </SettingsOptionRow>
      <ConversationPreview locale={locale} />
    </div>
  );
}
