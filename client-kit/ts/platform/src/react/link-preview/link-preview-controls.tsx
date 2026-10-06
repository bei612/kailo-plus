// Shared original Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/shared/ui/link-preview-controls.tsx.
import { EllipsisVertical, EyeOff } from "lucide-react";
import { toast } from "sonner";

import { useLinkPreviewHost } from "./host";
import { useUiT } from "../context";
import {
  setLinkPreviewStyle,
  type LinkPreviewStyle,
  useLinkPreviewStyle,
} from "./linkPreviewStylePreference";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Button } from "../profile/buzz/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../sidebar/dropdown-menu";

const CONTROL_BUTTON_CLASS =
  "h-5 w-5 rounded-full text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/message:opacity-100 data-[state=open]:opacity-100";

export function LinkPreviewControls({
  onRemove,
  placement = "right",
}: {
  onRemove?: () => void;
  placement?: "left" | "right";
}) {
  const t = useUiT();
  const options: { value: LinkPreviewStyle; label: string }[] = [
    { value: "rich", label: t("platform.appearance.rich") },
    { value: "compact", label: t("platform.appearance.compact") },
  ];
  const style = useLinkPreviewStyle();
  const { onOpenSettings } = useLinkPreviewHost();

  const handleStyleChange = (nextStyle: string) => {
    if (
      (nextStyle !== "rich" && nextStyle !== "compact") ||
      nextStyle === style
    ) {
      return;
    }

    setLinkPreviewStyle(nextStyle);
    toast.success(
      t("linkPreview.styleChanged", { style: t(nextStyle === "rich" ? "platform.appearance.rich" : "platform.appearance.compact") }),
      {
        action: onOpenSettings
          ? {
              label: t("platform.settings.appearance"),
              onClick: () => onOpenSettings("appearance"),
            }
          : undefined,
        description: t("linkPreview.appearanceHint"),
      },
    );
  };

  return (
    <div
      className={cn(
        "absolute top-0 z-20 flex flex-col",
        placement === "left" ? "right-full" : "left-full ml-1",
      )}
    >
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={t("linkPreview.displaySettings")}
            className={CONTROL_BUTTON_CLASS}
            size="icon-xs"
            title={t("linkPreview.displaySettings")}
            type="button"
            variant="ghost"
          >
            <EllipsisVertical aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{t("linkPreview.display")}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                onValueChange={handleStyleChange}
                value={style}
              >
                {options.map((option) => (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {onRemove ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={onRemove}
              >
                <EyeOff aria-hidden="true" />
                {t("linkPreview.remove")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
