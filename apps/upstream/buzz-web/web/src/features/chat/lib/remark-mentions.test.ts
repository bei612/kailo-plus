import { describe, expect, it } from "vitest";
import remarkMentions, { type MarkdownNode } from "@/features/chat/lib/remark-mentions";

function transformText(value: string, mentionNames: string[]): MarkdownNode[] {
  const tree: MarkdownNode = {
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [{ type: "text", value }],
      },
    ],
  };
  remarkMentions({ mentionNames })(tree);
  return tree.children?.[0]?.children ?? [];
}

describe("remark mentions", () => {
  it("matches tagged names longest-first and case-insensitively", () => {
    const nodes = transformText("Ping @CODEX(REMOTE), then @Codex.", ["Codex", "Codex(remote)"]);

    expect(nodes.map((node) => [node.type, node.value])).toEqual([
      ["text", "Ping "],
      ["mention", "@CODEX(REMOTE)"],
      ["text", ", then "],
      ["mention", "@Codex"],
      ["text", "."],
    ]);
  });

  it("accepts Unicode punctuation while leaving unknown and partial names alone", () => {
    const nodes = transformText("@张三，请处理；@Unknown 和 @张三同学", ["张三"]);

    expect(nodes.filter((node) => node.type === "mention").map((node) => node.value)).toEqual([
      "@张三",
    ]);
    expect(nodes.map((node) => node.value).join("")).toBe("@张三，请处理；@Unknown 和 @张三同学");
  });

  it("does not decorate email addresses", () => {
    const nodes = transformText("Mail alex@Codex or use @CodexExtra.", ["Codex"]);

    expect(nodes).toEqual([{ type: "text", value: "Mail alex@Codex or use @CodexExtra." }]);
  });

  it("does not inspect links or code", () => {
    const tree: MarkdownNode = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "link",
              children: [{ type: "text", value: "@Codex" }],
            },
            { type: "text", value: " " },
            { type: "inlineCode", value: "@Codex" },
            { type: "text", value: " @Codex" },
          ],
        },
        { type: "code", value: "@Codex" },
      ],
    };

    remarkMentions({ mentionNames: ["Codex"] })(tree);

    const paragraph = tree.children?.[0];
    expect(paragraph?.children?.[0]?.children?.[0]).toEqual({
      type: "text",
      value: "@Codex",
    });
    expect(paragraph?.children?.[2]).toEqual({ type: "inlineCode", value: "@Codex" });
    expect(paragraph?.children?.filter((node) => node.type === "mention")).toHaveLength(1);
    expect(tree.children?.[1]).toEqual({ type: "code", value: "@Codex" });
  });
});
