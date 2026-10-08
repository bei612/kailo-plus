import { ChannelType, WorkspaceMembershipState, WorkspaceVisibility, type DiscoverableWorkspace } from "@client-kit/contracts";
import type { BffClient } from "../../client";
import { TransportError } from "../../transport";

/** The existing governed browser and Projects share one directory validator. */
export async function loadChannelDirectory(client: BffClient, isCurrent: () => boolean) {
  const items: DiscoverableWorkspace[] = [];
  const cursors = new Set<string>();
  const ids = new Set<string>();
  const channelIds = new Set<string>();
  let cursor: string | undefined;
  do {
    if (!isCurrent()) throw new TransportError("Channel directory scope changed");
    const page = await client.discoverableWorkspaces(cursor);
    if (!isCurrent()) throw new TransportError("Channel directory scope changed");
    if (!page || !Array.isArray(page.items)) throw new TransportError("Invalid workspace directory");
    for (const item of page.items) {
      if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id)
        || !Object.values(WorkspaceVisibility).includes(item.visibility)
        || !item.channel || !Object.values(ChannelType).includes(item.channel.channelType)
        || typeof item.channel.channelId !== "string" || !item.channel.channelId || channelIds.has(item.channel.channelId)
        || typeof item.channel.name !== "string" || typeof item.channel.archived !== "boolean"
        || typeof item.isMember !== "boolean" || !Number.isSafeInteger(item.memberCount) || item.memberCount < 0
        || (item.membershipState !== undefined && !Object.values(WorkspaceMembershipState).includes(item.membershipState))
        || (item.joinActionKey !== undefined && item.joinActionKey !== "workspace.join"))
        throw new TransportError("Invalid workspace directory");
      ids.add(item.id); channelIds.add(item.channel.channelId); items.push(item);
    }
    cursor = page.nextCursor;
    if (cursor !== undefined && (typeof cursor !== "string" || !cursor || cursors.has(cursor))) throw new TransportError("Invalid workspace cursor");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return items;
}
