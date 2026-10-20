// Pure parts of the Desktop custom-section host (DD-125(5)): the original AppSidebar
// sectionBuckets and the "Move to section" menu actions over the shared Core preference actions.
import type { CollaborationPreferenceActions } from "@client-kit/platform/react/collaboration-preferences";
import type { ChannelContextMenuSectionActions } from "@client-kit/platform/react/sidebar/channel-context-menu";

type SectionPreferences = Pick<CollaborationPreferenceActions, "sections" | "assignments" | "writable" | "assignChannel">;

/** Original AppSidebar sectionBuckets: a channel goes to its live section, else to Channels. */
export function bucketChannelsBySection<T extends { id: string }>(
  channels: readonly T[],
  sections: readonly { id: string }[],
  assignments: Readonly<Record<string, string>>,
): { bySection: Map<string, T[]>; unassigned: T[] } {
  const liveSectionIds = new Set(sections.map((section) => section.id));
  const bySection = new Map<string, T[]>();
  const unassigned: T[] = [];
  for (const channel of channels) {
    const sectionId = assignments[channel.id];
    if (sectionId && liveSectionIds.has(sectionId)) {
      bySection.set(sectionId, [...(bySection.get(sectionId) ?? []), channel]);
    } else {
      unassigned.push(channel);
    }
  }
  return { bySection, unassigned };
}

/** The original "Move to section" submenu for one native channel. */
export function sectionActionsFor(
  preferences: SectionPreferences | null,
  channelId: string,
  run: (write: Promise<boolean>) => void,
  onCreateSection: (channelId: string) => void,
): ChannelContextMenuSectionActions | undefined {
  if (!preferences) return undefined;
  return {
    sections: preferences.sections,
    currentSectionId: preferences.assignments[channelId],
    disabled: !preferences.writable,
    onAssign: (sectionId) => run(preferences.assignChannel(channelId, sectionId)),
    onUnassign: () => run(preferences.assignChannel(channelId, null)),
    onCreateSection: () => onCreateSection(channelId),
  };
}
