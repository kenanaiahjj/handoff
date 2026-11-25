/**
 * A small Markdown reader for the naming handbook: headings, paragraphs, lists, tables, quotes,
 * fenced code, rules, and inline bold, italic, code and links. It returns data, not HTML, so the
 * renderer never injects markup someone typed.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] }
  | { type: "break" };

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; id: string; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "code"; text: string; lang: string }
  | { type: "quote"; blocks: Block[] }
  | { type: "list"; ordered: boolean; start: number; items: Inline[][] }
  | { type: "table"; head: Inline[][]; align: Array<"left" | "center" | "right" | null>; rows: Inline[][][] }
  | { type: "rule" };

/** GitHub's heading anchors: "5. Surface types — context" → "5-surface-types--context". */
export function headingSlug(text: string) {
  return text
    .toLowerCase()
    .replace(/[`*_[\]()]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

function plainText(nodes: Inline[]): string {
  return nodes.map((node) => ("text" in node ? node.text : "children" in node ? plainText(node.children) : " ")).join("");
}

/** Only web, mail and in-page links; anything else (javascript:, data:) renders as text. */
export function safeHref(href: string) {
  const value = href.trim();
  if (value.startsWith("#") || value.startsWith("/")) return value;
  return /^(https?:|mailto:)/i.test(value) ? value : null;
}

export function parseInline(source: string): Inline[] {
  const nodes: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) nodes.push({ type: "text", text });
    text = "";
  };
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    if (rest[0] === "\\" && rest.length > 1 && /[\\`*_[\]()#|>-]/.test(rest[1])) {
      text += rest[1];
      index += 2;
      continue;
    }
    const code = rest.match(/^(`+)([\s\S]*?[^`])\1(?!`)/);
    if (code) {
      flush();
      nodes.push({ type: "code", text: code[2].replace(/^ (.*) $/, "$1") });
      index += code[0].length;
      continue;
    }
    const link = rest.match(/^\[((?:[^\][]|\[[^\]]*\])*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/);
    if (link) {
      flush();
      const href = safeHref(link[2]);
      const children = parseInline(link[1]);
      if (href) nodes.push({ type: "link", href, children });
      else nodes.push(...children);
      index += link[0].length;
      continue;
    }
    const strong = rest.match(/^(\*\*|__)(?=\S)([\s\S]*?\S)\1/);
    if (strong) {
      flush();
      nodes.push({ type: "strong", children: parseInline(strong[2]) });
      index += strong[0].length;
      continue;
    }
    const em = rest.match(/^\*(?=[^\s*])([\s\S]*?[^\s*])\*(?!\*)/) ?? (/\w$/.test(text) ? null : rest.match(/^_(?=\S)([\s\S]*?\S)_(?!\w)/));
    if (em) {
      flush();
      nodes.push({ type: "em", children: parseInline(em[1]) });
      index += em[0].length;
      continue;
    }
    if (rest[0] === "\n") {
      flush();
      nodes.push({ type: "break" });
      index += 1;
      continue;
    }
    text += rest[0];
    index += 1;
  }
  flush();
  return nodes;
}

function splitRow(line: string) {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  let inCode = false;
  for (let index = 0; index < row.length; index += 1) {
    const character = row[index];
    if (character === "\\" && row[index + 1] === "|") {
      cell += "|";
      index += 1;
    } else if (character === "`") {
      inCode = !inCode;
      cell += character;
    } else if (character === "|" && !inCode) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

const delimiterRow = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const listItem = /^(\s*)([-*+]|(\d+)[.)])\s+(.*)$/;
const blockStart = /^(#{1,6}\s|```|~~~|>|\s*([-*+]|\d+[.)])\s|(\*\s*){3,}$|(-\s*){3,}$|(_\s*){3,}$)/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  const usedIds = new Map<string, number>();
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^\s*(```+|~~~+)\s*([\w+-]*)/);
    if (fence) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith(fence[1])) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push({ type: "code", text: body.join("\n"), lang: fence[2] });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      const children = parseInline(heading[2]);
      const base = headingSlug(plainText(children));
      const seen = usedIds.get(base) ?? 0;
      usedIds.set(base, seen + 1);
      blocks.push({ type: "heading", level: heading[1].length as 1, id: seen ? `${base}-${seen}` : base, children });
      index += 1;
      continue;
    }

    if (/^\s*((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line)) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    if (line.trimStart().startsWith(">")) {
      const body: string[] = [];
      while (index < lines.length && lines[index].trimStart().startsWith(">")) {
        body.push(lines[index].trimStart().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "quote", blocks: parseMarkdown(body.join("\n")) });
      continue;
    }

    if (line.includes("|") && index + 1 < lines.length && delimiterRow.test(lines[index + 1]) && lines[index + 1].includes("-")) {
      const head = splitRow(line);
      const align = splitRow(lines[index + 1]).map((cell) => {
        const left = cell.startsWith(":");
        const right = cell.endsWith(":");
        return left && right ? "center" : right ? "right" : left ? "left" : null;
      });
      index += 2;
      const rows: Inline[][][] = [];
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
        const cells = splitRow(lines[index]);
        rows.push(head.map((_, column) => parseInline(cells[column] ?? "")));
        index += 1;
      }
      blocks.push({ type: "table", head: head.map((cell) => parseInline(cell)), align, rows });
      continue;
    }

    const first = line.match(listItem);
    if (first) {
      const ordered = first[3] !== undefined;
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index];
        const item = current.match(listItem);
        if (item && (item[3] !== undefined) === ordered) {
          items.push(item[4]);
        } else if (current.trim() && /^\s+/.test(current) && items.length) {
          // A continuation (or nested item) folds into the item above.
          items[items.length - 1] += "\n" + current.trim();
        } else if (!current.trim() && lines[index + 1]?.match(listItem)) {
          // A blank line between items keeps the list going.
        } else {
          break;
        }
        index += 1;
      }
      blocks.push({ type: "list", ordered, start: ordered ? Number(first[3]) : 1, items: items.map((item) => parseInline(item)) });
      continue;
    }

    const body: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !blockStart.test(lines[index]) && !(lines[index].includes("|") && delimiterRow.test(lines[index + 1] ?? ""))) {
      body.push(lines[index]);
      index += 1;
    }
    blocks.push({ type: "paragraph", children: parseInline(body.map((part) => part.trim()).join("\n")) });
  }

  return blocks;
}
