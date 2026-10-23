// DD-144 (SF-BUZ-62(3)): Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/messages/lib/dmThreadAgentMentionError.ts refuses an Agent mention in a DM
// before sending and keeps the draft. Kailo DMs never admit Agents (DD-130(3), DD-125(8)), so a
// typed `@Name` that names a Tenant Agent the viewer can discover is refused the same way; the
// mention is never delivered elsewhere and no expanded DM is opened.
import { useQuery } from "@tanstack/react-query";
import type { BffClient } from "../../client";

/** The first `@Name` in `text` that names one of `agentNames` (longest name first, case-insensitive). */
export function findDmAgentMention(text: string, agentNames: readonly string[]): string | null {
  const names = [...new Set(agentNames.map(name => name.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  const lower = text.toLowerCase();
  for (let index = lower.indexOf("@"); index !== -1; index = lower.indexOf("@", index + 1)) {
    if (index > 0 && /[\p{L}\p{N}_]/u.test(text[index - 1]!)) continue;
    const rest = lower.slice(index + 1);
    for (const name of names) {
      if (!rest.startsWith(name.toLowerCase())) continue;
      const next = rest[name.length];
      if (next === undefined || !/[\p{L}\p{N}_]/u.test(next)) return name;
    }
  }
  return null;
}

/** Bounded directory read: a cursor that never ends is a failure, not "no Agents". */
export const DM_AGENT_DIRECTORY_MAX_PAGES = 50;

/** Display names of every Agent definition the viewer can discover, across all directory pages. */
export async function loadDmAgentMentionNames(client: Pick<BffClient, "agentDefinitions">): Promise<string[]> {
  const names: string[] = [];
  let offset = 0;
  for (let page = 0; page < DM_AGENT_DIRECTORY_MAX_PAGES; page += 1) {
    const read = await client.agentDefinitions(offset);
    if (!read || !Array.isArray(read.definitions)) throw new Error("Invalid Agent definition directory");
    for (const definition of read.definitions) if (typeof definition.displayName === "string") names.push(definition.displayName);
    if (read.nextOffset === undefined || read.nextOffset === null) return names;
    if (!Number.isSafeInteger(read.nextOffset) || read.nextOffset <= offset) throw new Error("Invalid Agent definition cursor");
    offset = read.nextOffset;
  }
  throw new Error("Agent definition directory exceeds the page bound");
}

/** Display names of the Tenant Agents the viewer can discover (all directory pages), only in DMs. */
export function useDmAgentMentionNames(client: Pick<BffClient, "agentDefinitions">, enabled: boolean): readonly string[] {
  const query = useQuery({
    queryKey: ["platform", "dm-agent-mention-names"], enabled, retry: false, staleTime: 60_000,
    queryFn: () => loadDmAgentMentionNames(client),
  });
  return enabled && query.isSuccess ? query.data : [];
}
