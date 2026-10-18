import { describe, expect, it, vi } from "vitest";
import { canSendMessageToChannel, useSendToChannelIntent, type TimelineMessage } from "../src/react/messages";
import { BffError, TransportError } from "../src/transport";
import { ErrorClass, ReasonCode } from "@client-kit/contracts";
import { button, click, render } from "./render";

const own = "a".repeat(64), agent = "b".repeat(64), other = "c".repeat(64);
const message = (patch: Partial<TimelineMessage>): TimelineMessage =>
  ({ id: "d".repeat(64), createdAt: 1, author: "A", time: "", body: "reply", depth: 1, kind: 9, signerPubkey: own, ...patch });

describe("original canSendMessageToChannel", () => {
  it("offers only settled stream replies of the viewer or an Agent they own", () => {
    const mine = new Set([own]), agents = new Set([agent]);
    expect(canSendMessageToChannel(message({}), mine)).toBe(true);
    expect(canSendMessageToChannel(message({ signerPubkey: agent }), mine, agents)).toBe(true);
    expect(canSendMessageToChannel(message({ signerPubkey: agent }), mine)).toBe(false);
    expect(canSendMessageToChannel(message({ signerPubkey: other }), mine, agents)).toBe(false);
    expect(canSendMessageToChannel(message({ pending: true }), mine)).toBe(false);
    expect(canSendMessageToChannel(message({ kind: 45003 }), mine)).toBe(false);
  });
});

function Harness({ publish }: { publish: (source: string, key: string) => Promise<unknown> }) {
  const send = useSendToChannelIntent(publish);
  return <button onClick={() => void send(message({})).catch(() => undefined)}>Send</button>;
}

describe("Send to channel keeps one DD-81 intent per source", () => {
  it("reuses the key after an unknown outcome and releases it after a confirmation or refusal", async () => {
    const publish = vi.fn<(source: string, key: string) => Promise<unknown>>()
      .mockRejectedValueOnce(new TransportError("timeout"))
      .mockResolvedValueOnce({ eventId: "e".repeat(64), operationId: "operation" })
      .mockRejectedValueOnce(new BffError(403, "denied", { class: ErrorClass.Denied, reason: ReasonCode.PermissionDenied }))
      .mockResolvedValue({ eventId: "f".repeat(64), operationId: "operation" });
    const ui = await render(<Harness publish={publish} />);
    for (let attempt = 0; attempt < 4; attempt += 1) await click(button(ui, "Send"));
    const keys = publish.mock.calls.map(([, key]) => key);
    expect(publish.mock.calls.every(([source]) => source === "d".repeat(64))).toBe(true);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
    expect(keys[3]).not.toBe(keys[2]);
  });
});
