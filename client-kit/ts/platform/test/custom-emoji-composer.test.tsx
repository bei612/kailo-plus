import { act, useState } from "react";
import { EditorContent } from "@tiptap/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildCustomEmojiCategory } from "../src/react/custom-emoji/emojiMartCategory";
import { EmojiPicker } from "../src/react/custom-emoji/EmojiPicker";
import { useCustomEmojiPalette } from "../src/react/custom-emoji/palette";
import { useRichTextEditor } from "../src/react/composer/features/messages/lib/useRichTextEditor";
import { MessageComposerToolbar } from "../src/react/composer/features/messages/ui/MessageComposerToolbar";
import { buildPlainTextProjection } from "../src/react/composer/features/messages/lib/plainTextProjection";
import { TooltipProvider } from "../src/react/sidebar/tooltip";
import { setLocale } from "../src/i18n";
import { render, click, button, settle } from "./render";

vi.mock("../src/react/profile/buzz/shared/ui/emoji-picker", () => ({ default: (props: {
  custom?: Array<{ emojis: Array<{ id: string }> }>;
  onEmojiSelect: (value: {native?: string; id?: string}) => void;
}) => <div><button onClick={() => props.onEmojiSelect({native:"😀"})}>standard</button>
  {props.custom?.[0]?.emojis.map((emoji) => <button key={emoji.id} onClick={() => props.onEmojiSelect({id:emoji.id})}>{emoji.id}</button>)}
</div> }));
vi.mock("../src/react/custom-emoji/emojiMartPrewarm", () => ({emojiMartData:{}}));

const custom = [{ shortcode: "party", url: "/api/v1/profile/media/approved" }];
beforeEach(() => {
  setLocale("en");
  HTMLElement.prototype.scrollIntoView ??= () => {};
});

describe("original custom emoji composer consumers", () => {
  it("keeps the original emoji-mart category and its empty behavior", () => {
    expect(buildCustomEmojiCategory([], "Custom")).toBeUndefined();
    expect(buildCustomEmojiCategory(custom, "Custom")).toEqual([{id:"buzz-custom",name:"Custom",emojis:[{
      id:"party",name:":party:",keywords:["party"],skins:[{src:custom[0]!.url}],
    }]}]);
  });

  it("normalizes the original picker standard and custom selections", async () => {
    const onSelect = vi.fn();
    const host = await render(<EmojiPicker customEmoji={custom} onSelect={onSelect}/>);
    await click(button(host,"standard"));
    await click(button(host,"party"));
    expect(onSelect.mock.calls).toEqual([["😀"],[":party:"]]);
  });

  it("inserts the original selectable image atom and retains Markdown and cursor projection", async () => {
    let editor: ReturnType<typeof useRichTextEditor> | undefined;
    function Composer() {
      editor = useRichTextEditor({readClipboardText:async()=>"",customEmoji:custom});
      return <TooltipProvider><EditorContent editor={editor.editor}/><MessageComposerToolbar
        editor={editor.editor} customEmoji={custom} composerDisabled={false} formattingDisabled={false}
        isFormattingOpen={false} isSending={false} isUploading={false} sendDisabled={false}
        onFormattingToggle={() => {}} onLinkButton={() => {}} onPaperclip={() => {}}/></TooltipProvider>;
    }
    const host = await render(<Composer/>);
    await click(host.querySelector<HTMLButtonElement>('[data-testid="composer-emoji-button"]')!);
    await click(button(document.body,"party"));
    await settle();
    expect(editor!.editor!.state.doc.firstChild!.firstChild!.type.name).toBe("customEmoji");
    expect(editor!.getMarkdown().trim()).toBe(":party:");
    const projection = buildPlainTextProjection(editor!.editor!.state.doc);
    expect(projection.text).toBe(":party:");
    expect(projection.mapPMToTextOffset(2)).toBe(7);
    expect(host.querySelector('img[data-custom-emoji]')?.getAttribute("src")).toBe(custom[0]!.url);
    await act(async () => { editor!.setContent(":party:"); });
    expect(editor!.editor!.state.doc.firstChild!.firstChild!.type.name).toBe("customEmoji");
    expect(editor!.getMarkdown()).toBe(":party:");
  });

  it("does not turn pasted image URLs into an authorization bypass", async () => {
    let editor: ReturnType<typeof useRichTextEditor> | undefined;
    function Composer() {
      editor = useRichTextEditor({readClipboardText:async()=>"",customEmoji:custom});
      return <EditorContent editor={editor.editor}/>;
    }
    const host = await render(<Composer/>);
    await act(async () => { editor!.editor!.commands.insertContent({type:"customEmoji",attrs:{shortcode:"party",src:"https://untrusted.example/tracking"}}); });
    expect(host.querySelector("img[data-custom-emoji]")?.getAttribute("src")).toBe(custom[0]!.url);
    expect(host.innerHTML).not.toContain("untrusted.example");
  });

  it("removes revoked media without clearing the authored shortcode", async () => {
    let editor: ReturnType<typeof useRichTextEditor> | undefined;
    function Composer() {
      const [palette, setPalette] = useState(custom);
      editor = useRichTextEditor({readClipboardText:async()=>"",customEmoji:palette});
      return <><EditorContent editor={editor.editor}/><button onClick={() => setPalette([])}>revoke</button></>;
    }
    const host = await render(<Composer/>);
    await act(async () => { editor!.setContent(":party:"); });
    expect(host.querySelector("img[data-custom-emoji]")?.getAttribute("src")).toBe(custom[0]!.url);
    await click(button(host,"revoke"));
    expect(host.querySelector("img[data-custom-emoji]")?.getAttribute("src")).toBe("");
    expect(editor!.getMarkdown()).toBe(":party:");
  });

  it("reads the signed palette from the captured host and fails closed on a revoked refresh", async () => {
    const key = Uint8Array.from({length:32},(_,i)=>i+1);
    const event = finalizeEvent({kind:30030,created_at:1,content:"",tags:[["d","buzz:custom-emoji"],["emoji","party","https://relay.example/media/image"]]},key);
    const read = vi.fn(async () => ({pubkey:getPublicKey(key),events:[event],mediaPaths:{}}));
    const reader = {scope:getPublicKey(key),read,rewriteRelayUrl:()=>custom[0]!.url};
    const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
    function Palette() { const palette = useCustomEmojiPalette(reader); return <output>{JSON.stringify(palette)}</output>; }
    const host = await render(<QueryClientProvider client={client}><Palette/></QueryClientProvider>);
    await act(async () => { await new Promise(resolve=>setTimeout(resolve,10)); });
    expect(host.textContent).toContain(custom[0]!.url);
    read.mockRejectedValueOnce(new Error("revoked"));
    await act(async () => { await client.invalidateQueries({queryKey:["custom-emoji",reader.scope]}); });
    await act(async () => { await new Promise(resolve=>setTimeout(resolve,10)); });
    expect(host.textContent).toBe("[]");
  });
});
