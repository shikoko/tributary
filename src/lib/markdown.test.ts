import { describe, expect, it } from "vitest";
import { openable, parseInline, parseMarkdown, withoutComments, type Block } from "./markdown";

const kinds = (blocks: Block[]) => blocks.map((block) => block.kind);

describe("parseMarkdown", () => {
  it("reads paragraphs, with each line break kept", () => {
    expect(parseMarkdown("One\ntwo\n\nThree")).toEqual([
      { kind: "paragraph", content: [{ kind: "text", text: "One" }, { kind: "break" }, { kind: "text", text: "two" }] },
      { kind: "paragraph", content: [{ kind: "text", text: "Three" }] },
    ]);
  });

  it("reads a pull request's description: headings, bold, lists, code and a quote", () => {
    const blocks = parseMarkdown(
      "## What changed\n\n**Checks** (new, `checks.yml`):\n- **App:** types\n- **Rust:** tests\n\n> Later.\n\n```bash\nnpm test\n```",
    );
    expect(kinds(blocks)).toEqual(["heading", "paragraph", "list", "quote", "code"]);
    expect(blocks[0]).toMatchObject({ level: 2, content: [{ kind: "text", text: "What changed" }] });
    expect(blocks[1]).toMatchObject({ content: [{ kind: "strong" }, { kind: "text", text: " (new, " }, { kind: "code", text: "checks.yml" }, { kind: "text", text: "):" }] });
    const list = blocks[2] as Extract<Block, { kind: "list" }>;
    expect(list.items).toHaveLength(2);
    expect(list.items[0].blocks[0]).toMatchObject({ content: [{ kind: "strong", children: [{ kind: "text", text: "App:" }] }, { kind: "text", text: " types" }] });
    expect(blocks[4]).toEqual({ kind: "code", lang: "bash", text: "npm test" });
  });

  it("starts a list right after a paragraph line, as GitHub does", () => {
    expect(kinds(parseMarkdown("Checks:\n- one\n- two"))).toEqual(["paragraph", "list"]);
  });

  it("reads nested lists, numbered ones and task boxes", () => {
    const [list] = parseMarkdown("1. First\n   - inside\n2. Second\n\n- [x] done\n- [ ] not yet") as Extract<Block, { kind: "list" }>[];
    expect(list).toMatchObject({ ordered: true, start: 1 });
    expect(list.items).toHaveLength(2);
    expect(kinds(list.items[0].blocks)).toEqual(["paragraph", "list"]);
    const tasks = parseMarkdown("- [x] done\n- [ ] not yet")[0] as Extract<Block, { kind: "list" }>;
    expect(tasks.items.map((item) => item.checked)).toEqual([true, false]);
  });

  it("keeps a list going across blank lines between its items", () => {
    const [list] = parseMarkdown("- one\n\n- two") as Extract<Block, { kind: "list" }>[];
    expect(list.items).toHaveLength(2);
  });

  it("reads tables", () => {
    const [table] = parseMarkdown("| Name | Size |\n| --- | ---: |\n| hero | 2K |") as Extract<Block, { kind: "table" }>[];
    expect(table.kind).toBe("table");
    expect(table.head).toEqual([[{ kind: "text", text: "Name" }], [{ kind: "text", text: "Size" }]]);
    expect(table.rows).toEqual([[[{ kind: "text", text: "hero" }], [{ kind: "text", text: "2K" }]]]);
  });

  it("leaves out HTML comments, like a template's hints", () => {
    expect(parseMarkdown("<!-- Describe it -->\nIt works.\n<!--\nmore\n-->")).toEqual([{ kind: "paragraph", content: [{ kind: "text", text: "It works." }] }]);
  });

  it("leaves no comment behind, even one made of the pieces of others, and one left open hides the rest", () => {
    // Taking out the inner comment would leave "<!--" from what's around it.
    expect(withoutComments("a <!<!---->-- b")).not.toContain("<!--");
    expect(withoutComments("a <!<!-- x -->-- hidden --> b")).toBe("a  b");
    // As on GitHub: a comment that's never closed hides everything after it.
    expect(withoutComments("Shown.\n<!-- never closed\nhidden")).toBe("Shown.\n");
    expect(parseMarkdown("Shown.\n<!-- never closed\nhidden")).toEqual([{ kind: "paragraph", content: [{ kind: "text", text: "Shown." }] }]);
  });
});

describe("parseInline", () => {
  it("reads emphasis, links and bare addresses", () => {
    expect(parseInline("*soft* and ~~gone~~, [the docs](https://example.com/docs) or https://example.com.")).toEqual([
      { kind: "em", children: [{ kind: "text", text: "soft" }] },
      { kind: "text", text: " and " },
      { kind: "del", children: [{ kind: "text", text: "gone" }] },
      { kind: "text", text: ", " },
      { kind: "link", href: "https://example.com/docs", children: [{ kind: "text", text: "the docs" }] },
      { kind: "text", text: " or " },
      { kind: "link", href: "https://example.com", children: [{ kind: "text", text: "https://example.com" }] },
      { kind: "text", text: "." },
    ]);
  });

  it("leaves underscores inside words alone", () => {
    expect(parseInline("hand_r_tool and snake_case_name")).toEqual([{ kind: "text", text: "hand_r_tool and snake_case_name" }]);
  });

  it("keeps code as it is, and escaped characters as themselves", () => {
    expect(parseInline("`**not bold**` \\*literal\\*")).toEqual([
      { kind: "code", text: "**not bold**" },
      { kind: "text", text: " *literal*" },
    ]);
  });

  it("shows an image as a link to it", () => {
    expect(parseInline("![The hero](https://example.com/hero.png)")).toEqual([
      { kind: "link", href: "https://example.com/hero.png", children: [{ kind: "text", text: "The hero" }] },
    ]);
  });
});

describe("openable", () => {
  it("opens web and email addresses only", () => {
    expect(openable("https://example.com")).toBe(true);
    expect(openable("mailto:maya@example.com")).toBe(true);
    expect(openable("javascript:alert(1)")).toBe(false);
    expect(openable("../docs/features.md")).toBe(false);
  });
});
