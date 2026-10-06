// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/channels/ui/ChannelPermissionsSettings.tsx::ChannelPermissionsSettings.
// Original controls; product visibility is Core-owned, not Relay protocol visibility.
import { ChevronDown, Globe, Lock } from "lucide-react";

import { WorkspaceVisibility } from "@client-kit/contracts";
import { useT } from "./context";
type ChannelVisibility = WorkspaceVisibility;
import { Button } from "./profile/buzz/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./sidebar/dropdown-menu";
import { cn } from "./profile/buzz/shared/lib/cn";
import { SegmentedControl } from "./segmented-control";


export function ChannelPermissionsSettings({
  disabled,
  onVisibilityChange,
  testIdPrefix,
  visibility,
  variant = "dropdown",
}: {
  disabled?: boolean;
  onVisibilityChange: (visibility: ChannelVisibility) => void;
  testIdPrefix: string;
  visibility: ChannelVisibility;
  variant?: "dropdown" | "segmented";
}) {
  const t = useT();
  const visibilityLabel = t(visibility === WorkspaceVisibility.Private ? "channel.visibility.private" : "channel.visibility.open");
  const VISIBILITY_OPTIONS = [
    { value: WorkspaceVisibility.Private, label: t("channel.visibility.private"), Icon: Lock },
    { value: WorkspaceVisibility.Open, label: t("channel.visibility.open"), Icon: Globe },
  ];

  return (
    <div
      className={cn(
        "flex min-h-12 items-center justify-between gap-4 rounded-xl border border-input bg-background px-3 py-3",
        disabled && variant === "dropdown" && "opacity-50",
      )}
      data-testid={`${testIdPrefix}-permissions-container`}
    >
      <span
        className={cn(
          "text-sm font-medium text-foreground",
          disabled && variant === "segmented" && "opacity-50",
        )}
      >
        {t("channel.visibility.label")}
      </span>
      {variant === "segmented" ? (
        <SegmentedControl
          disabled={disabled}
          legend={t("channel.visibility.label")}
          onValueChange={onVisibilityChange}
          optionTestIdPrefix={`${testIdPrefix}-permissions-option`}
          options={VISIBILITY_OPTIONS}
          testId={`${testIdPrefix}-permissions`}
          value={visibility}
        />
      ) : (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={`${t("channel.visibility.label")}: ${visibilityLabel}`}
              className="-mr-2.5 ml-auto h-9 w-fit justify-end px-2.5 text-right text-sm font-medium text-foreground hover:bg-muted/50"
              data-testid={`${testIdPrefix}-permissions`}
              disabled={disabled}
              type="button"
              variant="ghost"
            >
              <span aria-live="polite" className="text-right">
                {visibilityLabel}
              </span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground/70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(event) => event.preventDefault()}
            style={{
              minWidth: "var(--radix-dropdown-menu-trigger-width)",
            }}
          >
            <DropdownMenuRadioGroup
              onValueChange={(nextVisibility) =>
                onVisibilityChange(
                  nextVisibility === WorkspaceVisibility.Private ? WorkspaceVisibility.Private : WorkspaceVisibility.Open,
                )
              }
              value={visibility}
            >
              <DropdownMenuRadioItem
                data-testid={`${testIdPrefix}-permissions-option-open`}
                value="open"
              >
                {t("channel.visibility.open")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                data-testid={`${testIdPrefix}-permissions-option-private`}
                value="private"
              >
                {t("channel.visibility.private")}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
