import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../src/i18n";
import { ComposerAttachments } from "../src/react/composer/features/messages/ui/ComposerAttachments";
import { TooltipProvider } from "../src/react/sidebar/tooltip";
import { click, render } from "./render";

const host = {
  resolveMediaUrl: (url: string) => url,
  fetchMediaBytes: async () => new Uint8Array(),
};
const image = { url: "/media/image", sha256: "a".repeat(64), size: 4, type: "image/png", uploaded: 1770000000 };

afterEach(async () => { await act(async () => setLocale("en")); });

it("updates original media, remove, and revert controls across Chinese and English without changing callbacks", async () => {
  await act(async () => setLocale("zh-CN"));
  const remove = vi.fn();
  const revert = vi.fn();
  const element = await render(<TooltipProvider><ComposerAttachments {...host}
    attachments={[image]} onRemove={remove} onRevert={revert}
    originalUrlByUrl={new Map([[image.url, "/media/original"]])} /></TooltipProvider>);
  expect(element.querySelector('[aria-label="附件 aaaa"]')).not.toBeNull();
  const removeButton = element.querySelector<HTMLButtonElement>('[aria-label="移除附件 aaaa"]')!;
  expect(removeButton).not.toBeNull();
  await click(element.querySelector<HTMLButtonElement>('[aria-label="附件 aaaa"]')!);
  const revertButton = document.querySelector<HTMLButtonElement>('[data-testid="composer-attachment-revert"]')!;
  expect(revertButton.textContent).toBe("还原");
  await act(async () => setLocale("en"));
  expect(revertButton.textContent).toBe("Revert");
  expect(element.querySelector('[aria-label="Attachment aaaa"]')).not.toBeNull();
  expect(removeButton.getAttribute("aria-label")).toBe("Remove Attachment aaaa");
  await click(revertButton);
  expect(revert).toHaveBeenCalledWith(image.url);
  await click(document.querySelector<HTMLButtonElement>('[aria-label="Close lightbox"]')!);
  await click(removeButton);
  expect(remove).toHaveBeenCalledWith(image.url);
});

it("localizes upload fallback names while preserving supplied filenames and real cancellation", async () => {
  await act(async () => setLocale("zh-CN"));
  const cancel = vi.fn();
  const element = await render(<TooltipProvider><ComposerAttachments {...host}
    attachments={[]} onRemove={vi.fn()} isUploading onCancelUpload={cancel}
    uploadingPreviews={[{ id: 1, posterUrl: "/preview/video" }, { id: 2, filename: "Report [原文].pdf", progress: 25 }]} /></TooltipProvider>);
  expect(element.querySelector('img')?.alt).toBe("正在上传视频");
  const progress = element.querySelectorAll('[data-testid="upload-progress"]');
  expect(progress[0]?.getAttribute("aria-label")).toBe("正在上传附件");
  expect(progress[1]?.getAttribute("aria-label")).toBe("正在上传Report [原文].pdf");
  await act(async () => setLocale("en"));
  expect(element.querySelector('img')?.alt).toBe("Uploading video");
  expect(progress[1]?.getAttribute("aria-label")).toBe("Uploading Report [原文].pdf");
  await click(element.querySelector<HTMLButtonElement>('[aria-label="Cancel upload"]')!);
  expect(cancel).toHaveBeenCalledWith(1);
});

it("keeps provider labels and filenames verbatim and translates only generated attachment labels", async () => {
  await act(async () => setLocale("zh-CN"));
  const element = await render(<TooltipProvider><ComposerAttachments {...host} onRemove={vi.fn()}
    attachments={[
      { ...image, url: "/media/provider", displayLabel: "Provider original label" },
      { ...image, url: "/media/video", type: "video/mp4" },
      { ...image, url: "/media/file/", type: "application/pdf" },
      { ...image, url: "/media/named", type: "application/pdf", filename: "Report.pdf" },
      { ...image, url: "/media/team", type: "application/json", filename: "Design.team.json" },
    ]} /></TooltipProvider>);
  expect(element.querySelector('[aria-label="Provider original label"]')).not.toBeNull();
  expect(element.querySelector('[aria-label="移除Provider original label"]')).not.toBeNull();
  expect(element.querySelector('[aria-label="视频附件 aaaa"]')).not.toBeNull();
  expect(element.querySelector('[aria-label="移除Design"]')).not.toBeNull();
  expect(element.textContent).toContain("文件 aaaa");
  expect(element.textContent).toContain("Report.pdf");
  await act(async () => setLocale("en"));
  expect(element.querySelector('[aria-label="Video attachment aaaa"]')).not.toBeNull();
  expect(element.textContent).toContain("file aaaa");
});
