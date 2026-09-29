import { topChromeInset } from "@/shared/layout/chromeLayout";
import { UnreadPill } from "@/shared/ui/UnreadPill";

export function unreadAccessibleLabel({
  count,
  label,
  position,
}: {
  count: number;
  label?: string;
  position: "top" | "bottom";
}) {
  const direction = position === "top" ? "above" : "below";
  return `${label ?? `${count} unread`} ${direction}`;
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
  const resolvedLabel = label ?? `${count} unread`;

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
