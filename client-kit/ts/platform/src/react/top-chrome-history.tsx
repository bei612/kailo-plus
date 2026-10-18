// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/app/AppTopChrome.tsx: the
// global Back/Forward buttons beside the sidebar trigger. Hosts own the history source.
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useUiT } from "./context";
import { Button } from "./profile/buzz/shared/ui/button";

// Fixed px on purpose (button box + glyph), as the original top chrome row.
const HISTORY_ICON_BUTTON_CLASS =
  "h-[28px] w-[24px] rounded-[4px] text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&_svg]:size-[16px]";

export function TopChromeHistoryButtons({ canGoBack, canGoForward, onGoBack, onGoForward }: {
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
}) {
  const t = useUiT();
  return (
    <>
      <Button
        aria-label={t("platform.shortcuts.go-back.label")}
        className={HISTORY_ICON_BUTTON_CLASS}
        data-testid="global-back"
        disabled={!canGoBack}
        onClick={onGoBack}
        size="icon"
        type="button"
        variant="ghost"
      >
        <ChevronLeft />
      </Button>
      <Button
        aria-label={t("platform.shortcuts.go-forward.label")}
        className={HISTORY_ICON_BUTTON_CLASS}
        data-testid="global-forward"
        disabled={!canGoForward}
        onClick={onGoForward}
        size="icon"
        type="button"
        variant="ghost"
      >
        <ChevronRight />
      </Button>
    </>
  );
}
