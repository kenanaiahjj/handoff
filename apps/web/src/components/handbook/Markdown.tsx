import type { ReactNode } from "react";
import { parseMarkdown, type Block, type Inline } from "@/src/lib/markdown";

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text": return node.text;
      case "break": return <br key={index} />;
      case "code": return <code className="rounded-[4px] bg-surface-inset px-1 py-px font-mono text-[0.9em] text-foreground" key={index}>{node.text}</code>;
      case "strong": return <strong className="font-semibold text-foreground" key={index}>{renderInline(node.children)}</strong>;
      case "em": return <em key={index}>{renderInline(node.children)}</em>;
      case "link": {
        const external = /^https?:/i.test(node.href);
        return (
          <a className="text-primary underline-offset-2 hover:underline" href={node.href} key={index} {...(external ? { rel: "noreferrer", target: "_blank" } : {})}>
            {renderInline(node.children)}
          </a>
        );
      }
    }
  });
}

const headingStyles = {
  1: "mt-0 text-2xl font-semibold tracking-tight",
  2: "mt-10 border-t border-border pt-8 text-lg font-semibold tracking-tight",
  3: "mt-7 text-[15px] font-semibold",
  4: "mt-5 text-[13px] font-semibold",
  5: "mt-4 text-[13px] font-semibold",
  6: "mt-4 text-[12px] font-semibold uppercase tracking-wide",
} as const;

function renderBlock(block: Block, index: number): ReactNode {
  switch (block.type) {
    case "heading": {
      const Tag = `h${block.level}` as const;
      return <Tag className={"scroll-mt-20 text-foreground " + headingStyles[block.level]} id={block.id} key={index}>{renderInline(block.children)}</Tag>;
    }
    case "paragraph":
      return <p className="mt-3 text-pretty" key={index}>{renderInline(block.children)}</p>;
    case "code":
      return <pre className="mt-3 overflow-x-auto rounded-control border border-border bg-surface-inset px-3.5 py-3 font-mono text-[12px] leading-5 text-foreground" key={index}>{block.text}</pre>;
    case "quote":
      return <blockquote className="mt-4 rounded-r-control border-l-2 border-primary/60 bg-primary/[0.06] py-1 pl-4 pr-3 [&>p:first-child]:mt-2 [&>p:last-child]:mb-2" key={index}>{block.blocks.map(renderBlock)}</blockquote>;
    case "list": {
      const items = block.items.map((item, itemIndex) => <li className="pl-1" key={itemIndex}>{renderInline(item)}</li>);
      return block.ordered
        ? <ol className="mt-3 list-decimal space-y-1 pl-6 marker:text-foreground-subtle" key={index} start={block.start}>{items}</ol>
        : <ul className="mt-3 list-disc space-y-1 pl-6 marker:text-foreground-subtle" key={index}>{items}</ul>;
    }
    case "table":
      return (
        <div className="mt-4 overflow-x-auto rounded-control border border-border" key={index}>
          <table className="w-full border-collapse text-left text-[12px] leading-5">
            <thead className="bg-surface-inset text-foreground">
              <tr>{block.head.map((cell, column) => <th className="whitespace-nowrap px-3 py-2 font-semibold" key={column} style={{ textAlign: block.align[column] ?? undefined }}>{renderInline(cell)}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>{row.map((cell, column) => <td className="px-3 py-2 align-top" key={column} style={{ textAlign: block.align[column] ?? undefined }}>{renderInline(cell)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "rule":
      return null;
  }
}

/** Renders the handbook's Markdown as React elements; nothing typed into it becomes raw HTML. */
export function Markdown({ source }: { source: string }) {
  return <div className="text-[13px] leading-6 text-foreground-muted">{parseMarkdown(source).map(renderBlock)}</div>;
}
