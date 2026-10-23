// DD-144: original dmThreadAgentMentionError refusal of an Agent mention in a DM.
import { describe, expect, it } from "vitest";
import { findDmAgentMention } from "../src/react/composer/dmAgentMention";

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
});
