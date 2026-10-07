// Reused from Buzz 779af8886caae1317b4de962082429867ab61503; host transport is injected.
import { Circle, CircleDashed } from "lucide-react";
import * as React from "react";

import { clampFrameIndex } from "./AnimatedAvatarCapture.helpers";
import { cn } from "../../../shared/lib/cn";
import { useAvatarHost, useAvatarText } from "../../../../avatar-host";
import { Spinner } from "../../../shared/ui/spinner";
import { SettingsSlider } from "../../../../../settings-slider";

const FILMSTRIP_SELECTOR_SIZE = 48;
export function AvatarFramingSlider(props: React.ComponentProps<typeof SettingsSlider>) {
  const t = useAvatarText();
  const { performDefaultHaptic } = useAvatarHost();
  return <SettingsSlider {...props}
    ariaLabel={props.ariaLabel ?? t("platform.profile.avatar.size")}
    resetLabel={props.resetLabel ?? t("platform.profile.avatar.resetSize")}
    performDefaultHaptic={performDefaultHaptic} />;
}

type AvatarOutlineToggleProps = {
  disabled?: boolean;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  testIdPrefix: string;
};

export function AvatarOutlineToggle({
  disabled = false,
  enabled,
  onChange,
  testIdPrefix,
}: AvatarOutlineToggleProps) {
  const t = useAvatarText();
  const Icon = enabled ? Circle : CircleDashed;
  return (
    <button
      aria-label={t(enabled ? "platform.profile.avatar.outlineDisable" : "platform.profile.avatar.outlineEnable")}
      aria-pressed={enabled}
      className={cn(
        "grid h-12 w-12 shrink-0 place-items-center rounded-full border border-foreground/10 bg-background text-foreground transition-[background-color,box-shadow,color] duration-150 ease-out hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        enabled ? "shadow-xs" : "text-muted-foreground",
      )}
      data-testid={`${testIdPrefix}-animated-outline-toggle`}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      title={t(enabled ? "platform.profile.avatar.outlineOn" : "platform.profile.avatar.outlineOff")}
      type="button"
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}

type AvatarFilmstripPickerProps = {
  disabled?: boolean;
  frameCount: number;
  frames: string[];
  helpText?: string;
  helpTestId?: string;
  onSelectFrame: (index: number) => void;
  selectedFrame: number;
  testIdPrefix: string;
};

export function AvatarFilmstripPicker({
  disabled = false,
  frameCount,
  frames,
  helpText,
  helpTestId,
  onSelectFrame,
  selectedFrame,
  testIdPrefix,
}: AvatarFilmstripPickerProps) {
  const t = useAvatarText();
  const stripRef = React.useRef<HTMLDivElement | null>(null);
  const maxFrameIndex = Math.max(0, frameCount - 1);
  const safeSelectedFrame = clampFrameIndex(selectedFrame, frameCount);
  const selectedFrameProgress =
    maxFrameIndex === 0 ? 0 : safeSelectedFrame / maxFrameIndex;

  const selectFromClientX = React.useCallback(
    (clientX: number) => {
      if (disabled) {
        return;
      }

      const strip = stripRef.current;
      if (!strip) {
        return;
      }

      const rect = strip.getBoundingClientRect();
      const nextProgress = Math.min(
        1,
        Math.max(0, (clientX - rect.left) / Math.max(rect.width, 1)),
      );
      onSelectFrame(Math.round(nextProgress * maxFrameIndex));
    },
    [disabled, maxFrameIndex, onSelectFrame],
  );

  const nudge = React.useCallback(
    (delta: number) => {
      if (disabled) {
        return;
      }
      onSelectFrame(clampFrameIndex(safeSelectedFrame + delta, frameCount));
    },
    [disabled, frameCount, onSelectFrame, safeSelectedFrame],
  );

  return (
    <div
      className="grid gap-2"
      data-testid={`${testIdPrefix}-animated-poster-strip`}
    >
      <div
        aria-label={t("platform.profile.avatar.chooseFrame")}
        aria-valuemax={maxFrameIndex}
        aria-valuemin={0}
        aria-valuenow={safeSelectedFrame}
        className="relative h-16 min-w-0 touch-none rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid={`${testIdPrefix}-animated-poster-scrubber`}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            nudge(event.shiftKey ? -3 : -1);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            nudge(event.shiftKey ? 3 : 1);
          } else if (event.key === "Home") {
            event.preventDefault();
            onSelectFrame(0);
          } else if (event.key === "End") {
            event.preventDefault();
            onSelectFrame(maxFrameIndex);
          }
        }}
        onPointerDown={(event) => {
          if (disabled) {
            return;
          }
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          selectFromClientX(event.clientX);
        }}
        onPointerMove={(event) => {
          if (event.buttons !== 1) {
            return;
          }
          selectFromClientX(event.clientX);
        }}
        role="slider"
        tabIndex={disabled ? -1 : 0}
      >
        <div className="absolute inset-x-2 top-2 h-12" ref={stripRef}>
          <div className="absolute inset-0 overflow-hidden rounded-md border border-foreground/10 bg-background/70 shadow-inner">
            {frames.length === 0 ? (
              <div className="grid h-full w-full place-items-center">
                <Spinner
                  aria-label={t("platform.profile.avatar.generatingFrames")}
                  className="h-5 w-5"
                />
              </div>
            ) : (
              <div aria-hidden="true" className="absolute inset-0 flex h-full">
                {frames.map((frame, index) => (
                  <img
                    alt=""
                    className="h-full min-w-0 flex-1 object-cover"
                    draggable={false}
                    // biome-ignore lint/suspicious/noArrayIndexKey: filmstrip frames are regenerated as a fixed, ordered capture sequence.
                    key={`filmstrip-frame-${index}`}
                    src={frame}
                  />
                ))}
              </div>
            )}
          </div>
          {frames.length > 0 ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 z-10 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-lg border-[3px] border-white bg-white/10 shadow-[0_4px_16px_rgba(0,0,0,0.32)] ring-1 ring-black/20 transition-[left] duration-75 ease-out"
              data-testid={`${testIdPrefix}-animated-poster-selector`}
              style={{
                left: `clamp(${FILMSTRIP_SELECTOR_SIZE / 2}px, ${
                  selectedFrameProgress * 100
                }%, calc(100% - ${FILMSTRIP_SELECTOR_SIZE / 2}px))`,
              }}
            />
          ) : null}
        </div>
      </div>
      {helpText ? (
        <p
          className="px-1 text-center text-sm text-muted-foreground"
          data-testid={helpTestId}
        >
          {helpText}
        </p>
      ) : null}
    </div>
  );
}
