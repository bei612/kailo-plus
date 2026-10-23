// Original useProjectDiscussInChannel: content stays shared; draft identity/key
// and navigation are supplied by the existing Web/Native channel consumer.
// Original projectSelectionDiscussContent heading: "Let's talk about this/these {noun}:" for any
// selection kind (it lands in the viewer's own composer, so it follows the UI locale).
import { useCallback } from "react";
import type { DiscoverableWorkspace } from "@client-kit/contracts";
import { useT, type Translate } from "../context";
import { projectSelectionDiscussContent, type ProjectSelectionItem } from "./lib/projectSelection";

export type ProjectDiscussInChannel = (workspace: DiscoverableWorkspace, content: string) => Promise<void>;

export function projectSelectionDiscussHeading(t: Translate, items: ProjectSelectionItem[]) {
  const kind = items[0]?.kind;
  if (!kind) return "";
  if (items.length === 1 && kind === "task") return t("projects.discuss.taskDraft");
  if (items.length === 1 && kind === "review") return t("projects.discuss.reviewDraft");
  const noun = t(`projects.selection.noun.${kind}.${items.length === 1 ? "one" : "other"}`);
  return t(items.length === 1 ? "projects.discuss.draftOne" : "projects.discuss.draftMany", { noun });
}

export function useProjectDiscussInChannel(items: ProjectSelectionItem[], onDiscuss: ProjectDiscussInChannel) {
  const t = useT();
  return useCallback((workspace: DiscoverableWorkspace) =>
    onDiscuss(workspace, projectSelectionDiscussContent(items, projectSelectionDiscussHeading(t, items))), [items, onDiscuss, t]);
}
