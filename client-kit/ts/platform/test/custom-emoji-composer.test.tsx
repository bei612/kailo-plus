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
  i18n?: {search: string; pick: string; categories: {frequent: string}};
  onEmojiSelect: (value: {native?: string; id?: string}) => void;
}) => <div><output data-testid="picker-local-dictionary">{props.i18n ? [props.i18n.search, props.i18n.pick, props.i18n.categories.frequent].join("|") : "REMOTE_DICTIONARY"}</output><button onClick={() => props.onEmojiSelect({native:"😀"})}>standard</button>
  {props.custom?.[0]?.emojis.map((emoji) => <button key={emoji.id} onClick={() => props.onEmojiSelect({id:emoji.id})}>{emoji.id}</button>)}
</div> }));
vi.mock("../src/react/custom-emoji/emojiMartPrewarm", () => ({emojiMartData:{}}));

const custom = [{ shortcode: "party", url: "/api/v1/profile/media/approved" }];
beforeEach(() => {
  setLocale("en");
  HTMLElement.prototype.scrollIntoView ??= () => {};
  // The actual ProseMirror ArrowUp fallback consults DOM Range geometry.
  // jsdom omits these browser methods; keep the editor/key path real.
  Object.defineProperties(Range.prototype, {
    getClientRects: {configurable:true,value:()=>[]},
    getBoundingClientRect: {configurable:true,value:()=>new DOMRect()},
  });
});

describe("original custom emoji composer consumers", () => {
  it("retains every original toolbar selection-capture reader without inventing host selection state", async () => {
    const capture = vi.fn();
    function Composer() {
      const [emojiOpen, setEmojiOpen] = useState(false);
      const [formatting, setFormatting] = useState(false);
      const editor = useRichTextEditor({readClipboardText:async()=>""});
      return <TooltipProvider><EditorContent editor={editor.editor}/><MessageComposerToolbar
        editor={editor.editor} composerDisabled={false} formattingDisabled={false}
        isEmojiPickerOpen={emojiOpen} onEmojiPickerOpenChange={setEmojiOpen}
        isFormattingOpen={formatting} isSending={false} isUploading={false} sendDisabled={false}
        onCaptureSelection={capture} onFormattingToggle={setFormatting} onLinkButton={() => {}}
        onPaperclip={() => {}} onVoiceNote={() => {}} onOpenMentionPicker={() => {}}/></TooltipProvider>;
    }
    const host = await render(<Composer/>);
    expect([...host.querySelectorAll('[data-testid="composer-ingress-controls"] button')].map(target => target.getAttribute("aria-label"))).toEqual([
      "Mention someone", "Attach file", "Record voice note", "Insert emoji", "Toggle formatting",
    ]);
    async function press(label: string, reader?: HTMLElement | null) {
      const target = reader ?? host.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
      expect(target).not.toBeNull();
      await act(async () => {target.dispatchEvent(new MouseEvent("mousedown", {bubbles:true}));});
      return target;
    }
    await press("Mention someone");
    await press("Attach file");
    await press("Record voice note");
    await press("Insert emoji");
    const expand = await press("Toggle formatting");
    await click(expand);
    const expanded = host.querySelector<HTMLElement>('[aria-label="Close formatting"]')!.parentElement!.parentElement!;
    await press("Toggle formatting", expanded.querySelector<HTMLElement>('[aria-label="Toggle formatting"]'));
    await press("Close formatting");
    expect(capture).toHaveBeenCalledTimes(7);
  });
  it("uses the original empty-editor ArrowUp callback without taking drafted, modified or autocomplete keys", async () => {
    const selected=vi.fn(()=>true), autocomplete={current:false};
    let editor:ReturnType<typeof useRichTextEditor>|undefined;
    function Composer() {
      editor=useRichTextEditor({readClipboardText:async()=>"",onEditLastOwnMessage:selected,isAutocompleteOpen:autocomplete});
      return <EditorContent editor={editor.editor}/>;
    }
    const host=await render(<Composer/>);
    const input=host.querySelector<HTMLElement>('[data-testid="message-input"]')!;
    async function press(extra:KeyboardEventInit={}) {
      const event=new KeyboardEvent("keydown",{key:"ArrowUp",bubbles:true,cancelable:true,...extra});
      await act(async()=>{input.dispatchEvent(event);});
      return event.defaultPrevented;
    }
    expect(await press()).toBe(true);
    expect(selected).toHaveBeenCalledTimes(1);
    for(const extra of [{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true}]) expect(await press(extra)).toBe(false);
    autocomplete.current=true;
    expect(await press()).toBe(false);
    autocomplete.current=false;
    await act(async()=>{editor!.setContent("Kept draft");});
    expect(await press()).toBe(false);
    expect(selected).toHaveBeenCalledTimes(1);
    await act(async()=>{editor!.clearContent();});
    selected.mockReturnValueOnce(false);
    expect(await press()).toBe(false);
    expect(selected).toHaveBeenCalledTimes(2);
  });
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

  it("supplies the fixed package dictionaries locally in both languages without a CDN fallback", async () => {
    setLocale("zh-CN");
    const host = await render(<EmojiPicker customEmoji={custom} onSelect={vi.fn()}/>);
    expect(host.querySelector('[data-testid="picker-local-dictionary"]')?.textContent).toBe("搜索|选择一个表情…|最近使用");
    await act(async () => { setLocale("en"); });
    expect(host.querySelector('[data-testid="picker-local-dictionary"]')?.textContent).toBe("Search|Pick an emoji…|Frequently used");
  });

  it("inserts the original selectable image atom and retains Markdown and cursor projection", async () => {
    let editor: ReturnType<typeof useRichTextEditor> | undefined;
    function Composer() {
      const [emojiOpen, setEmojiOpen] = useState(false);
      editor = useRichTextEditor({readClipboardText:async()=>"",customEmoji:custom});
      return <TooltipProvider><EditorContent editor={editor.editor}/><MessageComposerToolbar
        editor={editor.editor} customEmoji={custom} composerDisabled={false} formattingDisabled={false}
        isEmojiPickerOpen={emojiOpen} onEmojiPickerOpenChange={setEmojiOpen}
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
