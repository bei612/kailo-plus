// DD-139 (SF-BUZ-61(1)): Buzz 779af8886caae1317b4de962082429867ab61503 NewMessageResultRow
// ProfileAvatar over the 07 §4.7.3 Tenant avatar address; only the host's own route loads.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { CandidatePictureProvider, sameOriginAvatarPicture } from "../src/react/profile/candidate-picture";
import { NewMessageResultRow } from "../src/react/conversations/new-message-result-row";
import { TooltipProvider } from "../src/react/sidebar/tooltip";
import { render } from "./render";

const origin = "https://kailo.example";
const user = { principalId: "11111111-1111-4111-8111-111111111111", displayName: "Ada Lovelace", pubkeys: ["a".repeat(64)],
  picture: `${origin}/api/v1/identity/avatars/sub-1` };

function row(resolver?: (picture: string) => string | null, picture = user.picture) {
  const body = <TooltipProvider><NewMessageResultRow disabled={false} onSelect={() => {}} user={{ ...user, picture }} /></TooltipProvider>;
  return <PlatformProvider client={createBffClient({ send: async () => ({ status: 404, body: {} }) })} locale="en">
    {resolver ? <CandidatePictureProvider resolve={resolver}>{body}</CandidatePictureProvider> : body}
  </PlatformProvider>;
}

describe("DD-139 candidate avatars", () => {
  it("admits only this origin's Tenant avatar route", () => {
    const resolve = sameOriginAvatarPicture(origin);
    expect(resolve(user.picture)).toBe(user.picture);
    expect(resolve("https://evil.example/api/v1/identity/avatars/sub-1")).toBeNull();
    expect(resolve(`${origin}/api/v1/profile/media/abc`)).toBeNull();
    expect(resolve("not a url")).toBeNull();
  });
  afterEach(() => vi.unstubAllGlobals());
  it("renders the original ProfileAvatar image from the admitted address", async () => {
    vi.stubGlobal("Image", function () {
      const image = document.createElement("img"); let source = "";
      Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 1 } });
      Object.defineProperty(image, "src", { get: () => source, set: (value: string) => {
        source = value; queueMicrotask(() => image.dispatchEvent(new Event("load"))); } });
      return image;
    });
    const host = await render(row(sameOriginAvatarPicture(origin)));
    await vi.waitFor(() => expect(host.querySelector(`img[src="${user.picture}"]`)).not.toBeNull());
  });
  it("keeps initials without a host resolver or for a foreign address", async () => {
    for (const ui of [row(undefined), row(sameOriginAvatarPicture(origin), "https://evil.example/x.png")]) {
      const host = await render(ui);
      expect(host.querySelector("img")).toBeNull();
      expect(host.textContent).toContain("AL");
    }
  });
});
