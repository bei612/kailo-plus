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

/** Display names of the Tenant Agents the viewer can discover (first directory page), only in DMs. */
export function useDmAgentMentionNames(client: Pick<BffClient, "agentDefinitions">, enabled: boolean): readonly string[] {
  const query = useQuery({
    queryKey: ["platform", "dm-agent-mention-names"], enabled, retry: false, staleTime: 60_000,
    queryFn: async () => {
      const page = await client.agentDefinitions();
      return Array.isArray(page?.definitions) ? page.definitions.map(definition => definition.displayName).filter((name): name is string => typeof name === "string") : [];
    },
  });
  return enabled && query.isSuccess ? query.data : [];
}
