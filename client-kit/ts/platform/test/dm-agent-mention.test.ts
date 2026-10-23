// DD-144: original dmThreadAgentMentionError refusal of an Agent mention in a DM.
import { describe, expect, it } from "vitest";
import { DM_AGENT_DIRECTORY_MAX_PAGES, findDmAgentMention, loadDmAgentMentionNames } from "../src/react/composer/dmAgentMention";

describe("DM Agent mention refusal (DD-144)", () => {
  it("finds an @mention of a known Agent name, longest name first and case-insensitive", () => {
    expect(findDmAgentMention("hi @scout please", ["Scout"])).toBe("Scout");
    expect(findDmAgentMention("ask @Scout Prime now", ["Scout", "Scout Prime"])).toBe("Scout Prime");
    expect(findDmAgentMention("@Scout", ["Scout"])).toBe("Scout");
  });
  it("ignores partial names, emails and plain text", () => {
    expect(findDmAgentMention("hey @Scoutmaster", ["Scout"])).toBeNull();
    expect(findDmAgentMention("mail me at bob@Scout", ["Scout"])).toBeNull();
    expect(findDmAgentMention("Scout is a name", ["Scout"])).toBeNull();
    expect(findDmAgentMention("@Scout", [])).toBeNull();
  });
  it("reads every page of the Agent definition directory", async () => {
    const offsets: (number | undefined)[] = [];
    const pages: Record<number, { definitions: { displayName?: string }[]; nextOffset?: number }> = {
      0: { definitions: [{ displayName: "Scout" }], nextOffset: 1 },
      1: { definitions: [{ displayName: "Planner" }, {}], nextOffset: 3 },
      3: { definitions: [{ displayName: "Late Agent" }] },
    };
    const client = { agentDefinitions: async (offset?: number) => { offsets.push(offset); return pages[offset ?? 0] as never; } };
    const names = await loadDmAgentMentionNames(client);
    expect(offsets).toEqual([0, 1, 3]);
    expect(names).toEqual(["Scout", "Planner", "Late Agent"]);
    expect(findDmAgentMention("ping @Late Agent", names)).toBe("Late Agent");
  });
  it("fails closed on a non-advancing cursor or an unbounded directory", async () => {
    await expect(loadDmAgentMentionNames({ agentDefinitions: async () => ({ definitions: [], nextOffset: 0 }) as never }))
      .rejects.toThrow("cursor");
    let calls = 0;
    await expect(loadDmAgentMentionNames({ agentDefinitions: async (offset?: number) => { calls += 1; return { definitions: [], nextOffset: (offset ?? 0) + 1 } as never; } }))
      .rejects.toThrow("page bound");
    expect(calls).toBe(DM_AGENT_DIRECTORY_MAX_PAGES);
  });
});
