import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { SendFeedbackDialog } from "../src/react/feedback/SendFeedbackDialog";
import { PlatformFeedback } from "../src/react/feedback/PlatformFeedback";
import { TransportError, type BffRequest } from "../src/transport";
import { button, click, render, settle, type, until } from "./render";

const feedbackId = "0eab04f4-21a8-4fb4-a75c-8b76d6354b25";
const createdAt = "2026-10-26T00:00:00Z";

describe("DD-158 actual shared feedback consumers", () => {
  it.each(["WEB", "DESKTOP"] as const)("%s previews opted-in diagnostics and retries the identical frozen request", async client => {
    const requests: BffRequest[] = [];
    const send = vi.fn(async (request: BffRequest) => {
      requests.push(structuredClone(request));
      if (requests.length === 1) throw new TransportError("response lost");
      return { status: 200, body: { feedbackId, createdAt } };
    });
    const close = vi.fn();
    await render(<PlatformProvider client={createBffClient({ send })} feedbackClient={client} feedbackVersion={async () => "1.2.3"} locale="en">
      <SendFeedbackDialog open onOpenChange={close}/>
    </PlatformProvider>);
    await settle();
    const dialog = document.querySelector<HTMLElement>('[data-testid="send-feedback-dialog"]')!;
    const preview = dialog.querySelector('[data-testid="feedback-diagnostics-preview"]')!.textContent!;
    expect(Object.keys(JSON.parse(preview)).sort()).toEqual(["appVersion", "capturedAt", "language", "platform", "userAgent"]);
    const consent = dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(consent.checked).toBe(false);
    await click(consent);
    const message = dialog.querySelector<HTMLTextAreaElement>('textarea')!;
    await type(message, "Private feedback body");
    await click(button(dialog, "Send feedback"));
    expect(message.disabled).toBe(true);
    expect(close).not.toHaveBeenCalled();
    expect(dialog.textContent).toContain("The result is unconfirmed");
    await click(button(dialog, "Retry this submission"));
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(requests[1]);
    expect(requests[0]).toMatchObject({ method: "POST", path: "/api/v1/feedback", body: { client, message: "Private feedback body", diagnostics: preview } });
    expect((requests[0]!.body as { idempotencyKey: string }).idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(close).toHaveBeenCalledWith(false);
  });

  it("omits diagnostics unless opted in and preserves the draft after a definitive refusal", async () => {
    const send = vi.fn(async (_request: BffRequest) => ({ status: 429, retryAfterSeconds: 60, body: {} }));
    await render(<PlatformProvider client={createBffClient({ send })} feedbackVersion={async () => "1.2.3"} locale="zh-CN">
      <SendFeedbackDialog open onOpenChange={() => {}}/>
    </PlatformProvider>);
    await settle();
    const dialog = document.querySelector<HTMLElement>('[data-testid="send-feedback-dialog"]')!;
    const message = dialog.querySelector<HTMLTextAreaElement>('textarea')!;
    await type(message, "反馈内容");
    await click(button(dialog, "发送反馈"));
    expect(send.mock.calls[0]![0].body).not.toHaveProperty("diagnostics");
    expect(message.value).toBe("反馈内容");
    expect(message.disabled).toBe(false);
  });

  it("previews the full local attachment without sending it to any endpoint", async () => {
    const send = vi.fn(async (_request: BffRequest) => ({ status: 200, body: { feedbackId, createdAt } }));
    await render(<PlatformProvider client={createBffClient({ send })} locale="en"><SendFeedbackDialog open onOpenChange={() => {}}/></PlatformProvider>);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "private.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await until(() => document.querySelector('button[aria-label="Attached image"]') !== null, "local image preview");
    await click(document.querySelector<HTMLElement>('button[aria-label="Attached image"]')!);
    const preview = document.querySelector('[data-testid="feedback-attachment-preview"] img');
    expect(preview?.getAttribute("src")).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(send).not.toHaveBeenCalled();
  });

  it("operator reads, retrieves an audited attachment representation and triages the displayed CAS version", async () => {
    let state = "NEW", version = 1;
    const send = vi.fn(async (request: BffRequest) => {
      if (request.path.endsWith("/attachment?encoding=base64")) return { status: 200, body: { mimeType: "image/png", sha256: "a".repeat(64), dataBase64: "iVBORw0KGgo=" } };
      if (request.method === "PUT") {
        expect(request.path).toBe(`/api/v1/platform/feedback/${feedbackId}`);
        expect(request.body).toEqual({ state: "TRIAGED", version: 1 });
        state = "TRIAGED"; version = 2;
        return { status: 200, body: { feedbackId, state, version } };
      }
      return { status: 200, body: { items: [{ feedbackId, tenantId: "tenant-1", tenantName: "Tenant One", client: "WEB", message: "Body", createdAt,
        state, version, attachment: { mimeType: "image/png", sha256: "a".repeat(64), byteSize: 8 } }] } };
    });
    const host = await render(<PlatformProvider client={createBffClient({ send })} locale="en"><PlatformFeedback/></PlatformProvider>);
    await settle();
    expect(host.querySelector("[data-testid=list-total]")?.textContent).toBe("1 total");
    expect(host.textContent).toContain("Tenant One");
    expect(host.textContent).toContain("New");
    await click(host.querySelector<HTMLElement>(`tr[data-row-key="${feedbackId}"]`)!);
    expect(host.querySelector("[data-testid=platform-feedback-detail]")?.textContent).toContain("Feedback from Tenant One");
    await click(button(host, "Attached image"));
    expect(host.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,iVBORw0KGgo=");
    await click(button(host, "Mark as triaged"));
    expect(host.textContent).toContain("Triaged");
    expect(button(host, "Close feedback")).toBeTruthy();
    await click(button(host, "Back"));
    expect(host.querySelector("[data-testid=platform-feedback-detail]")).toBeNull();
  });

  it("operator list reads every offset page, filters by state on the server and states refusal instead of a blank page", async () => {
    const row = (id: string, extra: Record<string, unknown> = {}) => ({ feedbackId: id, tenantId: "tenant-1", tenantName: "Tenant One", client: "DESKTOP",
      message: `Message ${id}`, createdAt, state: "NEW", version: 1, ...extra });
    const send = vi.fn(async (request: BffRequest) => {
      if (request.path.includes("state=CLOSED")) return { status: 200, body: { items: [row("c-1", { state: "CLOSED" })] } };
      return request.path.endsWith("offset=0") ? { status: 200, body: { items: [row("a-1"), row("a-2")], nextOffset: 25 } }
        : { status: 200, body: { items: [row("b-1", { diagnostics: JSON.stringify({ appVersion: "1.2.3", platform: "macOS" }) })] } };
    });
    const host = await render(<PlatformProvider client={createBffClient({ send })} locale="zh-CN"><PlatformFeedback/></PlatformProvider>);
    await settle();
    expect(send.mock.calls.map(([r]) => r.path)).toEqual(["/api/v1/platform/feedback?offset=0", "/api/v1/platform/feedback?offset=25"]);
    expect(host.querySelector("[data-testid=list-total]")?.textContent).toBe("共 3 条");
    expect(host.textContent).toContain("桌面端");
    expect(host.textContent).not.toContain("DESKTOP");
    await click(host.querySelector<HTMLElement>('tr[data-row-key="b-1"]')!);
    const detail = host.querySelector("[data-testid=platform-feedback-detail]")!;
    expect(detail.textContent).toContain("1.2.3");
    expect(detail.querySelector("pre")).toBeNull();
    await click(button(host, "返回"));
    const closed = [...host.querySelectorAll<HTMLElement>("[role=radio]")].find((node) => node.textContent === "已关闭")!;
    await click(closed);
    expect(send.mock.calls.at(-1)?.[0].path).toBe("/api/v1/platform/feedback?offset=0&state=CLOSED");
    expect(host.querySelector("[data-testid=list-total]")?.textContent).toBe("共 1 条");

    const denied = await render(<PlatformProvider client={createBffClient({ send: vi.fn(async () => ({ status: 403, body: {} })) })} locale="zh-CN"><PlatformFeedback/></PlatformProvider>);
    await settle();
    expect(denied.querySelector("[data-testid=permission-state]")?.textContent).toContain("只有本部署的运营管理员可以查看私有反馈。");
  });
});
