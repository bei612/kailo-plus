import { getLocale, translate } from "../../i18n";
// Shared from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/sidebar/ui/MoreUnreadButton.tsx.
// Existing governed channel consumer only; original DM preview remains unconnected until real DM unread data is available.
import { topChromeInset } from "../messages/chromeLayout";
import { UnreadPill } from "../messages/timeline/UnreadPill";

export function unreadAccessibleLabel({
  count,
  label,
  position,
}: {
  count: number;
  label?: string;
  position: "top" | "bottom";
}) {
  return translate(getLocale(), position === "top" ? "sidebar.unreadAbove" : "sidebar.unreadBelow", {
    label: label ?? translate(getLocale(), "sidebar.unreadCount", { count }),
  });
}

export function MoreUnreadButton({
  bottomClassName = "bottom-0",
  count,
  emphasis,
  label,
  onClick,
  position,
  testId,
}: {
  bottomClassName?: string;
  count: number;
  emphasis: "default" | "primary";
  label?: string;
  onClick: () => void;
  position: "top" | "bottom";
  testId: string;
}) {
  const positionClassName =
    position === "top" ? topChromeInset.top : bottomClassName;
  const resolvedLabel = label ?? translate(getLocale(), "sidebar.unreadCount", { count });

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 z-10 flex justify-center px-2 py-1 ${positionClassName}`}
    >
      <UnreadPill
        accessibleLabel={unreadAccessibleLabel({
          count,
          label: resolvedLabel,
          position,
        })}
        className="max-w-full overflow-hidden text-xs"
        direction={position === "top" ? "up" : "down"}
        emphasis={emphasis}
        label={resolvedLabel}
        onClick={onClick}
        testId={testId}
      />
    </div>
  );
}
