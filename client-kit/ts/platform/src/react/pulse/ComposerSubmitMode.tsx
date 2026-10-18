// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/forum/ui/ForumComposer.tsx: the optional secondary submit. When both
// onSecondarySubmit and secondarySubmitLabel are given, a "Comment" / secondary radio menu sits among
// the toolbar actions and the send button submits through the selected callback
// (submitSelectedMessage); the selected mode stays until changed, as in the original.
import { ChevronDown } from "lucide-react";
import * as React from "react";
import { useUiT } from "../context";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Button } from "../profile/buzz/shared/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "../sidebar/dropdown-menu";
import type { PulseComposerProps } from "./host";

type SubmitModeProps = Pick<PulseComposerProps, "disabled" | "isSending" | "onSubmit" | "onSecondarySubmit" | "secondarySubmitLabel">;

/** Host composers place `action` among their toolbar actions and send through `submit`. */
export function useComposerSubmitMode({ disabled, isSending, onSubmit, onSecondarySubmit, secondarySubmitLabel }: SubmitModeProps) {
  const t = useUiT();
  const [mode, setMode] = React.useState<"primary" | "secondary">("primary");
  const secondary = onSecondarySubmit && secondarySubmitLabel ? onSecondarySubmit : undefined;
  const selected = secondary && mode === "secondary" ? "secondary" : "primary";
  const submit: PulseComposerProps["onSubmit"] = (content, mentions, attachments, contentIncludesAttachments) =>
    (selected === "secondary" && secondary ? secondary : onSubmit)(content, mentions, attachments, contentIncludesAttachments);
  const action = secondary ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className={cn(selected === "secondary"
            && "border-amber-500/40 text-amber-700 hover:bg-amber-500/10 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300")}
          data-testid="composer-submit-mode"
          disabled={disabled || isSending}
          size="sm"
          type="button"
          variant="outline"
        >
          {selected === "secondary" ? secondarySubmitLabel : t("projects.composer.comment")}
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup onValueChange={(value) => setMode(value === "secondary" ? "secondary" : "primary")} value={selected}>
          <DropdownMenuRadioItem value="primary">{t("projects.composer.comment")}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="secondary">{secondarySubmitLabel}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : undefined;
  return { action, submit };
}
