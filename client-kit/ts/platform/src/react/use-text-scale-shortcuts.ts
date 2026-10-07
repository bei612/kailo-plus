// Shared migration of Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/app/useWebviewZoomShortcuts.ts. Only the native zoom reset stays in the host.
import * as React from "react";

import { hasPrimaryShortcutModifier } from "../keyboard-platform";

/**
 * Cmd +/- scales the real root font-size, so every rem in the app — text,
 * spacing, widths, radii — zooms together. The Font size preference is a
 * separate, text-only dial layered on top (see `styles/globals/typography.css`).
 */
const BASE_FONT_SIZE_PX = 16;
const DEFAULT_ZOOM_FACTOR = 1;
const MIN_ZOOM_FACTOR = 0.75;
const MAX_ZOOM_FACTOR = 1.5;
const ZOOM_STEP = 0.1;
const TEXT_SCALE_STORAGE_KEY = "buzz:text-scale";

type ZoomAction = "increase" | "decrease" | "reset";

function roundZoomFactor(zoomFactor: number) {
  return Math.round(zoomFactor * 10) / 10;
}

function getZoomAction(event: KeyboardEvent): ZoomAction | null {
  if (!hasPrimaryShortcutModifier(event) || event.altKey) {
    return null;
  }

  if (
    event.key === "+" ||
    event.key === "=" ||
    event.code === "Equal" ||
    event.code === "NumpadAdd"
  ) {
    return "increase";
  }

  if (
    !event.shiftKey &&
    (event.key === "-" ||
      event.code === "Minus" ||
      event.code === "NumpadSubtract")
  ) {
    return "decrease";
  }

  if (
    !event.shiftKey &&
    (event.key === "0" || event.code === "Digit0" || event.code === "Numpad0")
  ) {
    return "reset";
  }

  return null;
}

function getNextZoomFactor(action: ZoomAction, zoomFactor: number) {
  if (action === "reset") {
    return DEFAULT_ZOOM_FACTOR;
  }

  if (action === "increase") {
    return Math.min(roundZoomFactor(zoomFactor + ZOOM_STEP), MAX_ZOOM_FACTOR);
  }

  return Math.max(roundZoomFactor(zoomFactor - ZOOM_STEP), MIN_ZOOM_FACTOR);
}

function readStoredZoomFactor() {
  const raw = window.localStorage.getItem(TEXT_SCALE_STORAGE_KEY);
  if (!raw) {
    return DEFAULT_ZOOM_FACTOR;
  }

  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_ZOOM_FACTOR;
  }

  return Math.min(Math.max(parsed, MIN_ZOOM_FACTOR), MAX_ZOOM_FACTOR);
}

function applyRootZoom(zoomFactor: number) {
  document.documentElement.style.fontSize =
    zoomFactor === DEFAULT_ZOOM_FACTOR
      ? ""
      : `${BASE_FONT_SIZE_PX * zoomFactor}px`;
}

function applyTextScale(zoomFactor: number) {
  applyRootZoom(zoomFactor);
  if (zoomFactor === DEFAULT_ZOOM_FACTOR) {
    window.localStorage.removeItem(TEXT_SCALE_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(TEXT_SCALE_STORAGE_KEY, String(zoomFactor));
}

export function useTextScaleShortcuts() {
  const zoomFactorRef = React.useRef(DEFAULT_ZOOM_FACTOR);

  React.useLayoutEffect(() => {
    const storedZoomFactor = readStoredZoomFactor();

    zoomFactorRef.current = storedZoomFactor;
    applyTextScale(storedZoomFactor);

    function handleKeyDown(event: KeyboardEvent) {
      const action = getZoomAction(event);
      if (!action) {
        return;
      }

      event.preventDefault();

      const previousZoomFactor = zoomFactorRef.current;
      const nextZoomFactor = getNextZoomFactor(action, previousZoomFactor);

      if (nextZoomFactor === previousZoomFactor) {
        return;
      }

      zoomFactorRef.current = nextZoomFactor;
      applyTextScale(nextZoomFactor);
    }

    function handleStorage(event: StorageEvent) {
      if (event.key !== TEXT_SCALE_STORAGE_KEY && event.key !== null) {
        return;
      }

      const storedZoomFactor = readStoredZoomFactor();
      zoomFactorRef.current = storedZoomFactor;
      applyRootZoom(storedZoomFactor);
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);
}
