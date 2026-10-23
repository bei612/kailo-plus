// DD-131(7)、DD-143：原版快照剪贴板格式（data-buzz-agent-snapshot）与粘贴还原。
import { describe, expect, it } from "vitest";
import {
  buildSnapshotClipboardHtml,
  parseSnapshotClipboardHtml,
  restoreSnapshotPaste,
  type SnapshotClipboardPayload,
} from "../src/react/messages/agentSnapshotClipboard";
import { sha256Hex } from "../src/react/agent-library/AgentSnapshotImportDialog";

const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

async function payload(extra: Partial<SnapshotClipboardPayload> = {}): Promise<SnapshotClipboardPayload> {
  return { version: 1, displayName: "Writer <b>", filename: "Writer.agent.png", sha256: await sha256Hex(bytes),
    size: bytes.length, type: "image/png", ...extra };
}

describe("agent snapshot clipboard", () => {
  it("round-trips the original attribute and escapes the visible name", async () => {
    const html = buildSnapshotClipboardHtml(await payload());
    expect(html).toContain('data-buzz-agent-snapshot="');
    expect(html).toContain("Writer &lt;b&gt;");
    expect(parseSnapshotClipboardHtml(html)).toEqual(await payload());
  });

  it("rejects untrusted payloads", async () => {
    for (const extra of [{ filename: "../x.agent.png" }, { filename: "x.png" }, { sha256: "zz" }, { size: 0 },
      { size: 11 * 1024 * 1024 }, { type: "image/jpeg" as "image/png" }, { displayName: " " }]) {
      expect(parseSnapshotClipboardHtml(buildSnapshotClipboardHtml(await payload(extra)))).toBeNull();
    }
    expect(parseSnapshotClipboardHtml('<a data-buzz-agent-snapshot="%7Bbad">x</a>')).toBeNull();
    expect(parseSnapshotClipboardHtml("<p>plain</p>")).toBeNull();
  });

  it("names a pasted file only when its bytes match the payload", async () => {
    const html = buildSnapshotClipboardHtml(await payload());
    const named = await restoreSnapshotPaste(html, new File([bytes], "image.png", { type: "image/png" }));
    expect(named?.name).toBe("Writer.agent.png");
    const read = await new Promise<ArrayBuffer>((resolve) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.readAsArrayBuffer(named!);
    });
    expect(new Uint8Array(read)).toEqual(bytes);
    const other = new Uint8Array(bytes); other[10] = 9;
    expect(await restoreSnapshotPaste(html, new File([other], "image.png", { type: "image/png" }))).toBeNull();
  });
});
