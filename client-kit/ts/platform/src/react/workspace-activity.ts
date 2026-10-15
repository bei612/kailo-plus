// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src-tauri/src/commands/channels/fetch.rs::query_last_messages: the channel list reads
// every channel's latest window in one request instead of one read per channel. The admitted
// directory supplies each joined channel's native ID and type; Core re-admits every Workspace.
import { ChannelType, WebMessageType, type DiscoverableWorkspace } from "@client-kit/contracts";
import type { BffClient } from "../client";
import { TransportError } from "../transport";

export type WorkspaceActivity = { channelId: string; channelType: ChannelType; events: unknown };

/** One batched first-page window per joined directory row, keyed by Workspace ID. A missing,
 * reordered or rebound item fails the whole read rather than showing a partial channel list. */
export async function loadWorkspaceActivity(client: BffClient,
  rows: readonly Pick<DiscoverableWorkspace, "id" | "channel">[]): Promise<Map<string, WorkspaceActivity>> {
  const out = new Map<string, WorkspaceActivity>();
  if (rows.length === 0) return out;
  for (const row of rows) {
    if (row.channel.channelType !== ChannelType.Stream && row.channel.channelType !== ChannelType.Forum)
      throw new TransportError("Invalid channel type");
  }
  const page = await client.workspaceActivity({ items: rows.map((row) => ({ workspaceId: row.id,
    messageType: row.channel.channelType === ChannelType.Forum ? WebMessageType.ForumPost : WebMessageType.Stream })) });
  if (!page || !Array.isArray(page.items) || page.items.length !== rows.length) throw new TransportError("Invalid Workspace activity");
  page.items.forEach((item, index) => {
    const row = rows[index]!;
    if (!item || item.workspaceId !== row.id || typeof item.channelId !== "string" || !item.channelId || item.channelId !== row.channel.channelId
      || !Array.isArray(item.events))
      throw new TransportError("Invalid Workspace activity");
    out.set(row.id, { channelId: item.channelId, channelType: row.channel.channelType, events: item.events });
  });
  return out;
}
