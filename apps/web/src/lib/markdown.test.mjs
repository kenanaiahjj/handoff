import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { headingSlug, parseInline, parseMarkdown } from "./markdown.ts";

test("heading anchors match GitHub's, so the guide's table of contents links work", () => {
  assert.equal(headingSlug("5. Surface types — context, not part of the name"), "5-surface-types--context-not-part-of-the-name");
  assert.equal(headingSlug("Appendix A — name format reference"), "appendix-a--name-format-reference");
});

test("reads inline bold, italics, code and links, and drops unsafe links to text", () => {
  assert.deepEqual(parseInline("**Bold** and *it* `a*b` [x](#top) [y](javascript:alert)"), [
    { type: "strong", children: [{ type: "text", text: "Bold" }] },
    { type: "text", text: " and " },
    { type: "em", children: [{ type: "text", text: "it" }] },
    { type: "text", text: " " },
    { type: "code", text: "a*b" },
    { type: "text", text: " " },
    { type: "link", href: "#top", children: [{ type: "text", text: "x" }] },
    { type: "text", text: " " },
    { type: "text", text: "y" },
  ]);
  assert.deepEqual(parseInline("snake_case_name"), [{ type: "text", text: "snake_case_name" }]);
});

test("reads tables, lists, quotes, code fences and rules", () => {
  const blocks = parseMarkdown([
    "# Title",
    "",
    "| A | B |",
    "|---|:-:|",
    "| `x \\| y` | 2 |",
    "",
    "1. one",
    "2. two",
    "",
    "- dash",
    "",
    "> **Note:** quoted",
    "",
    "```",
    "Page - Surface (Variant)",
    "```",
    "",
    "---",
  ].join("\n"));
  assert.deepEqual(blocks.map((block) => block.type), ["heading", "table", "list", "list", "quote", "code", "rule"]);
  assert.deepEqual(blocks[1].rows[0][0], [{ type: "code", text: "x | y" }]);
  assert.deepEqual(blocks[1].align, [null, "center"]);
  assert.equal(blocks[2].ordered, true);
  assert.equal(blocks[2].items.length, 2);
  assert.equal(blocks[5].text, "Page - Surface (Variant)");
});

test("every table-of-contents link in the built-in handbook points at a heading", async () => {
  const source = await readFile(new URL("../../../../docs/figma-naming.md", import.meta.url), "utf8");
  const blocks = parseMarkdown(source);
  const ids = new Set(blocks.filter((block) => block.type === "heading").map((block) => block.id));
  const anchors = [...source.matchAll(/\]\(#([^)]+)\)/g)].map((match) => match[1]);
  assert.ok(anchors.length > 10);
  for (const anchor of anchors) assert.ok(ids.has(anchor), `missing heading for #${anchor}`);
  assert.ok(blocks.some((block) => block.type === "table"));
});
