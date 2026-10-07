import * as React from "react";
import {
  useCanGoBack,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { useHistoryShortcuts } from "@client-kit/platform/react/use-navigation-shortcuts";
import { trimMapToSize } from "@/shared/lib/trimMapToSize";

type RouterHistoryState = {
  __TSR_index?: number;
  __TSR_key?: string;
  key?: string;
};

export function useBackForwardControls() {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const locationState = useRouterState({
    select: (state) => state.location.state,
  }) as RouterHistoryState;
  const locationIndex = locationState.__TSR_index ?? 0;
  const locationKey =
    locationState.__TSR_key ?? locationState.key ?? String(locationIndex);
  const keysByIndexRef = React.useRef(new Map<number, string>());
  const [maxIndex, setMaxIndex] = React.useState(locationIndex);

  React.useEffect(() => {
    const keysByIndex = keysByIndexRef.current;
    const currentKey = keysByIndex.get(locationIndex);

    if (currentKey && currentKey !== locationKey) {
      for (const storedIndex of [...keysByIndex.keys()]) {
        if (storedIndex >= locationIndex) {
          keysByIndex.delete(storedIndex);
        }
      }
    }

    keysByIndex.set(locationIndex, locationKey);
    trimMapToSize(keysByIndex, 200);
    setMaxIndex((current: number) => {
      if (currentKey && currentKey !== locationKey) {
        return locationIndex;
      }

      return Math.max(current, locationIndex);
    });
  }, [locationIndex, locationKey]);

  const canGoForward = locationIndex < maxIndex;

  const goBack = React.useCallback(() => {
    if (!canGoBack) {
      return;
    }

    router.history.back();
  }, [canGoBack, router.history]);

  const goForward = React.useCallback(() => {
    if (!canGoForward) {
      return;
    }

    router.history.forward();
  }, [canGoForward, router.history]);

  useHistoryShortcuts({ goBack, goForward });

  const handleMouseNav = React.useEffectEvent((direction: string) => {
    if (direction === "back") {
      goBack();
      return;
    }

    if (direction === "forward") {
      goForward();
    }
  });

  // macOS: WKWebView never delivers X1/X2 button events or horizontal
  // swipe gestures to the DOM, so the native layer catches them
  // (`mouse_nav.rs`) and forwards them as a Tauri event.
  React.useEffect(() => {
    if (!isTauri()) {
      return;
    }

    const unlistenPromise = listen<string>("mouse-nav", (event) => {
      handleMouseNav(event.payload);
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  return {
    canGoBack,
    canGoForward,
    goBack,
    goForward,
  };
}
