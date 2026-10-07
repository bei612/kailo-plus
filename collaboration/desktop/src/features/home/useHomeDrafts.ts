import * as React from "react";
import { useInboxDraftSelection } from "@client-kit/platform/react/inbox-surface";

import { deleteDraftEntry } from "@/features/messages/lib/useDrafts";
import {
  useActiveDraftCount,
  useDraftViewItems,
} from "@/features/messages/ui/DraftsPanel";

type UseHomeDraftsOptions = {
  autoSelect: boolean;
  isNarrowHomeViewport: boolean;
  selectionEnabled: boolean;
  viewportWidthPx: number;
};

export function useHomeDrafts({
  autoSelect,
  isNarrowHomeViewport,
  selectionEnabled,
  viewportWidthPx,
}: UseHomeDraftsOptions) {
  const items = useDraftViewItems(selectionEnabled);
  const optimisticActiveCount = useActiveDraftCount(new Map());
  const activeCount = selectionEnabled
    ? items.filter((item) => item.rootStatus !== "deleted").length
    : optimisticActiveCount;
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const selectedItem =
    items.find((item) => item.entry.key === selectedKey) ?? null;

  useInboxDraftSelection({ autoSelect, isNarrowHomeViewport, items, selectedKey, setSelectedKey, selectionEnabled, viewportWidthPx });

  const deleteDraft = React.useCallback(
    (draftKey: string) => {
      deleteDraftEntry(draftKey);
      if (selectedKey === draftKey) {
        setSelectedKey(null);
      }
    },
    [selectedKey],
  );

  return {
    activeCount,
    deleteDraft,
    items,
    selectedItem,
    selectedKey,
    selectDraft: setSelectedKey,
  };
}
