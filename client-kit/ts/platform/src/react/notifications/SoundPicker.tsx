import { useCallback, useEffect, useRef, useState } from "react";
import { translate } from "../../i18n";
import { useUiLocale } from "../context";
import { ChevronDown, Pause, Play } from "lucide-react";

import {
  soundAssetUrl,
  SOUND_NAMES,
  type SoundName,
} from "./sound";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Button } from "../profile/buzz/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../sidebar/dropdown-menu";

function sortedSounds(recommended: SoundName): SoundName[] {
  const others = SOUND_NAMES.filter((n) => n !== recommended)
    .slice()
    .sort();
  return [recommended, ...others];
}

// The waveform SVGs use fill="currentColor", which an <img> can't inherit,
// so render them as a mask over the current text color instead.
function Waveform({
  name,
  className,
}: {
  name: SoundName;
  className?: string;
}) {
  const maskImage = `url(${soundAssetUrl(name, "svg")})`;
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block shrink-0 bg-current", className)}
      style={{
        maskImage,
        maskPosition: "center",
        maskRepeat: "no-repeat",
        maskSize: "contain",
        WebkitMaskImage: maskImage,
        WebkitMaskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
      }}
    />
  );
}

export function SoundPicker({
  recommended,
  value,
  disabled,
  onChange,
}: {
  recommended: SoundName;
  value: SoundName;
  disabled?: boolean;
  onChange: (next: SoundName) => void;
}) {
  const items = sortedSounds(recommended);
  const locale = useUiLocale();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const playback = useRef<{ audio: HTMLAudioElement; dispose: () => void } | null>(null);
  const label = (name: SoundName) => translate(locale, `platform.notifications.sound.${name}`);
  const stopPreview = useCallback(() => {
    const active = playback.current;
    playback.current = null;
    active?.dispose();
  }, []);

  useEffect(() => {
    stopPreview();
    setIsPlaying(false);
    setIsStarting(false);
    setPreviewFailed(false);
    return stopPreview;
  }, [value, disabled, stopPreview]);

  function togglePreview() {
    if (disabled || isStarting) return;
    if (isPlaying) {
      stopPreview();
      setIsPlaying(false);
      return;
    }
    stopPreview();
    setPreviewFailed(false);
    try {
      // A settings preview owns its audio. It must not pause or reuse the
      // cached audio currently delivering an actual incoming notification.
      const audio = new Audio(soundAssetUrl(value, "mp3"));
      const finish = (failed: boolean) => {
        if (playback.current?.audio !== audio) return;
        stopPreview();
        setIsStarting(false);
        setIsPlaying(false);
        setPreviewFailed(failed);
      };
      const ended = () => finish(false);
      const failed = () => finish(true);
      audio.addEventListener("ended", ended);
      audio.addEventListener("pause", ended);
      audio.addEventListener("error", failed);
      playback.current = { audio, dispose: () => {
        audio.removeEventListener("ended", ended);
        audio.removeEventListener("pause", ended);
        audio.removeEventListener("error", failed);
        audio.pause();
      } };
      setIsStarting(true);
      void audio.play().then(() => {
        if (playback.current?.audio !== audio) return;
        setIsStarting(false);
        setIsPlaying(true);
      }, failed);
    } catch {
      stopPreview();
      setIsStarting(false);
      setIsPlaying(false);
      setPreviewFailed(true);
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            className="h-7 min-w-40 justify-between gap-1.5 rounded-full border border-border/50 bg-muted/45 px-2.5 text-xs font-medium text-foreground shadow-none hover:bg-muted/70"
            disabled={disabled}
            size="sm"
            type="button"
            variant="ghost"
          >
            <span className="truncate">{label(value)}</span>
            <span className="flex items-center gap-1.5">
              <Waveform className="h-6 w-15 opacity-70" name={value} />
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="max-h-80 min-w-72 overflow-y-auto"
        >
          <DropdownMenuRadioGroup
            onValueChange={(next) => onChange(next as SoundName)}
            value={value}
          >
            {items.map((name) => (
              <DropdownMenuRadioItem key={name} value={name}>
                <span className="flex w-full items-center justify-between gap-3">
                  <span>{label(name)}</span>
                  <span className="flex items-center gap-2">
                    {name === recommended ? (
                      <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {translate(locale, "platform.notifications.recommended")}
                      </span>
                    ) : null}
                    <Waveform className="h-6 w-15 opacity-70" name={name} />
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        aria-label={translate(locale, isPlaying ? "platform.notifications.pause" : "platform.notifications.preview", { sound: label(value) })}
        aria-busy={isStarting}
        className="h-7 w-7 rounded-full border border-border/50 bg-muted/45 p-0 text-foreground shadow-none hover:bg-muted/70"
        disabled={disabled || isStarting}
        onClick={togglePreview}
        size="sm"
        type="button"
        variant="ghost"
      >
        {isPlaying ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4" />
        )}
      </Button>
      {previewFailed ? <span role="status" className="text-xs text-destructive">{translate(locale, "platform.notifications.previewFailed")}</span> : null}
    </span>
  );
}
