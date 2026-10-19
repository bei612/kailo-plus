import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebLinkPreviewSnapshotView } from "@client-kit/contracts";
import {
  ComposerLinkPreviewCards,
  composerLinkPreviewHrefs,
  selectLinkPreviewIntent,
  useComposerLinkPreviews,
  type ComposerLinkPreviews,
  type PrepareLinkPreview,
} from "../src/react/link-preview";
import { applyMessageEdits, canRemoveLinkPreviews, linkPreviewRemovalEdit, type TimelineMessage } from "../src/react/messages";
import { setLocale } from "../src/i18n";
import { click, render } from "./render";

const snapshot = (url: string, id: string): WebLinkPreviewSnapshotView => ({
  snapshotId: id, url, canonicalUrl: url, title: `Title ${id}`, siteName: "Example", description: "",
  expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
});

type Deferred = { url: string; resolve: (value: WebLinkPreviewSnapshotView | null) => void; reject: (error: unknown) => void };

function deferredPrepare() {
  const calls: Deferred[] = [];
  const prepare = vi.fn<PrepareLinkPreview>((url) => new Promise((resolve, reject) => { calls.push({ url, resolve, reject }); }));
  return { calls, prepare };
}

let latest: ComposerLinkPreviews | null = null;
function Harness({ content, enabled = true, prepare }: { content: string; enabled?: boolean; prepare?: PrepareLinkPreview }) {
  const previews = useComposerLinkPreviews({ content, enabled, ...(prepare ? { prepare } : {}) });
  latest = previews;
  return <ComposerLinkPreviewCards previews={previews} resolveMedia={(sha) => `/media/${sha}`} />;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setLocale("en");
});

afterEach(() => { latest = null; });

describe("original composer candidate and submit rules", () => {
  it("previews only external https links, deduped, fragment stripped, at most 8", () => {
    const urls = Array.from({ length: 10 }, (_, index) => `https://site${index}.example/a`);
    expect(composerLinkPreviewHrefs(urls.join(" "))).toHaveLength(8);
    expect(composerLinkPreviewHrefs("see http://plain.example/ and https://a.example/x#part https://a.example/x"))
      .toEqual(["https://a.example/x"]);
  });

  it("selects by LIVE hrefs in live order; suppression only with candidates", () => {
    const ready = { "https://a.example/": "id-a", "https://b.example/": "id-b" };
    expect(selectLinkPreviewIntent(["https://b.example/", "https://a.example/"], ready, false))
      .toEqual({ linkPreviewSnapshotIds: ["id-b", "id-a"] });
    // A removed URL's ready snapshot never leaks onto the body being sent.
    expect(selectLinkPreviewIntent(["https://c.example/"], ready, false)).toBeUndefined();
    expect(selectLinkPreviewIntent(["https://a.example/"], ready, true)).toEqual({ suppressLinkPreviews: true });
    expect(selectLinkPreviewIntent([], ready, true)).toBeUndefined();
  });
});

describe("useComposerLinkPreviews", () => {
  it("prepares at most two at once and shows no card for a site without a preview", async () => {
    const { calls, prepare } = deferredPrepare();
    const ui = await render(<Harness content="https://a.example/ https://b.example/ https://c.example/" prepare={prepare} />);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
    expect(ui.querySelectorAll("[data-link-preview-composer-card]")).toHaveLength(3);
    await act(async () => { calls[0]!.resolve(snapshot("https://a.example/", "id-a")); });
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(3));
    await act(async () => { calls[1]!.resolve(null); calls[2]!.reject(new Error("limited")); });
    await vi.waitFor(() => expect(ui.querySelectorAll("[data-link-preview-composer-card]")).toHaveLength(1));
    expect(ui.textContent).toContain("Title id-a");
    let intent: Awaited<ReturnType<ComposerLinkPreviews["prepareSubmit"]>>;
    await act(async () => { intent = await latest!.prepareSubmit(); });
    expect(intent!).toEqual({ linkPreviewSnapshotIds: ["id-a"] });
  });

  it("suppresses every preview from one card and sends the original none marker", async () => {
    const prepare = vi.fn<PrepareLinkPreview>(async (url) => snapshot(url, "id"));
    const ui = await render(<Harness content="read https://a.example/" prepare={prepare} />);
    await vi.waitFor(() => expect(ui.querySelector("[data-snapshot-tag-ready='true']")).not.toBeNull());
    await click(ui.querySelector<HTMLButtonElement>("[data-testid='composer-hide-link-previews']")!);
    expect(ui.querySelector("[data-link-preview-composer-card]")).toBeNull();
    let intent: Awaited<ReturnType<ComposerLinkPreviews["prepareSubmit"]>>;
    await act(async () => { intent = await latest!.prepareSubmit(); });
    expect(intent!).toEqual({ suppressLinkPreviews: true });
  });

  it("waits for an unfinished preview at submit and Skip sends without previews", async () => {
    const { calls, prepare } = deferredPrepare();
    await render(<Harness content="https://a.example/" prepare={prepare} />);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    let intent: Awaited<ReturnType<ComposerLinkPreviews["prepareSubmit"]>> | "waiting" = "waiting";
    let submitting!: Promise<void>;
    await act(async () => { submitting = latest!.prepareSubmit().then((value) => { intent = value; }); });
    expect(latest!.preparing).toBe(true);
    expect(intent).toBe("waiting");
    await act(async () => { latest!.skip(); await submitting; });
    expect(intent).toBeUndefined();
    await act(async () => { calls[0]!.resolve(snapshot("https://a.example/", "late")); });
  });

  it("is off for edits: nothing is fetched and nothing is named", async () => {
    const prepare = vi.fn<PrepareLinkPreview>(async (url) => snapshot(url, "id"));
    const ui = await render(<Harness content="https://a.example/" enabled={false} prepare={prepare} />);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(prepare).not.toHaveBeenCalled();
    expect(ui.querySelector("[data-link-preview-composer-card]")).toBeNull();
    expect(await latest!.prepareSubmit()).toBeUndefined();
  });
});

describe("original remove-for-everyone semantics", () => {
  const sha = "a".repeat(64);
  const base: TimelineMessage = {
    id: "e".repeat(64), createdAt: 1, author: "A", time: "", depth: 0, kind: 9,
    body: `See https://a.example/\n![image](https://relay.example/media/${sha}.png)`,
    tags: [["h", "c"], ["imeta", `url https://relay.example/media/${sha}.png`, "m image/png", `x ${sha}`, "size 3"]],
  };

  it("resubmits the same body and media, and is offered only once", () => {
    expect(canRemoveLinkPreviews(base)).toBe(true);
    expect(canRemoveLinkPreviews({ ...base, tags: [...base.tags!, ["link-preview", "none"]] })).toBe(false);
    expect(canRemoveLinkPreviews({ ...base, pending: true })).toBe(false);
    const edit = linkPreviewRemovalEdit(base);
    expect(edit.content).toBe("See https://a.example/");
    expect(edit.attachments).toEqual([expect.objectContaining({ sha256: sha, spoiler: false })]);
  });

  it("any authorized suppressing edit hides previews for good", () => {
    const author = "b".repeat(64);
    const original = { id: "m", pubkey: author, kind: 9, created_at: 1, content: "x https://a.example/", tags: [["h", "c"]] };
    const suppress = { id: "s", pubkey: author, kind: 40003, created_at: 2, content: "x https://a.example/",
      tags: [["h", "c"], ["e", "m"], ["link-preview", "none"]] };
    const later = { id: "l", pubkey: author, kind: 40003, created_at: 3, content: "y https://a.example/", tags: [["h", "c"], ["e", "m"]] };
    const [edited] = applyMessageEdits([original], [suppress, later]);
    expect(edited!.content).toBe("y https://a.example/");
    expect(edited!.tags).toContainEqual(["link-preview", "none"]);
    const foreign = { ...suppress, pubkey: "c".repeat(64) };
    expect(applyMessageEdits([original], [foreign])[0]!.tags).not.toContainEqual(["link-preview", "none"]);
  });
});
