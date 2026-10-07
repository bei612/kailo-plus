import * as React from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useTextScaleShortcuts } from "@client-kit/platform/react/use-text-scale-shortcuts";

export function useWebviewZoomShortcuts() {
  useTextScaleShortcuts();
  React.useLayoutEffect(() => {
    // Original native-only reset: the shared rem scale remains the sole app dial.
    void getCurrentWebview().setZoom(1).catch((error) => {
      console.error("Failed to reset webview zoom", error);
    });
  }, []);
}
