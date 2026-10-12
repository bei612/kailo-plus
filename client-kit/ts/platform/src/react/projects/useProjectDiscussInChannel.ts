// Original useProjectDiscussInChannel: content stays shared; draft identity/key
// and navigation are supplied by the existing Web/Native channel consumer.
import { useCallback } from "react";
import type { DiscoverableWorkspace } from "@client-kit/contracts";
import { useT } from "../context";
import { projectSelectionDiscussContent, type ProjectSelectionItem } from "./lib/projectSelection";

export type ProjectDiscussInChannel = (workspace: DiscoverableWorkspace, content: string) => Promise<void>;

export function useProjectDiscussInChannel(items: ProjectSelectionItem[], onDiscuss: ProjectDiscussInChannel) {
  const t = useT();
  return useCallback((workspace: DiscoverableWorkspace) =>
    onDiscuss(workspace, projectSelectionDiscussContent(items, t("projects.discuss.taskDraft"))), [items, onDiscuss, t]);
}
