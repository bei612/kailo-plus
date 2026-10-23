// DD-140 (1): the platform tool directory accepts the closed native tool name → action key map.
import { describe, expect, it } from "vitest";
import type { PlatformToolPage } from "@client-kit/contracts";
import { validPlatformToolPage } from "../src/react/tools";

const tool = (name: string, actionKey: string) => ({ resourceId: `id-${name}`, resourceVersion: 1, ownerPrincipalId: "o", name, actionKey,
  source: "PLATFORM_NATIVE", status: "ACTIVE", resourceState: "ACTIVE", inputSchemaHash: "a".repeat(64), outputSchemaHash: "b".repeat(64), canConsume: true });
const page = (...tools: ReturnType<typeof tool>[]) => ({ tools } as unknown as PlatformToolPage);

describe("platform native tool directory (DD-140)", () => {
  it("accepts project_channel_request bound to workspace.create next to the memory tools", () => {
    expect(validPlatformToolPage(page(tool("agent.memory.entry.list", "agent.memory.entry.list"),
      tool("project_channel_request", "workspace.create")), 0)).toBe(true);
  });
  it("rejects any other pairing or unknown native tool", () => {
    expect(validPlatformToolPage(page(tool("project_channel_request", "project_channel_request")), 0)).toBe(false);
    expect(validPlatformToolPage(page(tool("agent.memory.entry.read", "workspace.create")), 0)).toBe(false);
    expect(validPlatformToolPage(page(tool("workspace.create", "workspace.create")), 0)).toBe(false);
  });
});
