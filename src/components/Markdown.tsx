import { Fragment, useMemo, type ReactNode } from "react";
import { openable, parseMarkdown, type Block, type Inline } from "../lib/markdown";

/**
 * Markdown from GitHub or GitLab (a pull request's description, a comment), shown as it
 * looks there. Built from React elements, never HTML, so nothing in it runs. Links open
 * in the browser.
 */
export function Markdown({ text, openUrl, className }: { text: string; openUrl: (url: string) => void; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <div className={`markdown${className ? ` ${className}` : ""}`}>{blocks.map((block, index) => renderBlock(block, index, openUrl))}</div>;
}

function renderBlock(block: Block, key: number, openUrl: (url: string) => void): ReactNode {
  const inline = (content: Inline[]) => content.map((piece, index) => renderInline(piece, index, openUrl));
  switch (block.kind) {
    case "paragraph":
      return <p key={key}>{inline(block.content)}</p>;
    case "heading": {
      const Tag = `h${Math.min(block.level + 2, 6)}` as "h3";
      return (
        <Tag key={key} className={`markdown-heading level-${block.level}`}>
          {inline(block.content)}
        </Tag>
      );
    }
    case "code":
      return (
        <pre key={key} className="markdown-code">
          <code>{block.text}</code>
        </pre>
      );
    case "quote":
      return <blockquote key={key}>{block.blocks.map((inner, index) => renderBlock(inner, index, openUrl))}</blockquote>;
    case "list": {
      const items = block.items.map((item, index) => (
        <li key={index} className={item.checked !== null ? "markdown-task" : undefined}>
          {item.checked !== null && <span className={`markdown-box${item.checked ? " checked" : ""}`} role="img" aria-label={item.checked ? "Done" : "Not done"} />}
          <div className="markdown-item">{item.blocks.map((inner, index) => renderBlock(inner, index, openUrl))}</div>
        </li>
      ));
      return block.ordered ? (
        <ol key={key} start={block.start}>
          {items}
        </ol>
      ) : (
        <ul key={key}>{items}</ul>
      );
    }
    case "table":
      return (
        <div key={key} className="markdown-table">
          <table>
            <thead>
              <tr>
                {block.head.map((cell, index) => (
                  <th key={index}>{inline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, column) => (
                    <td key={column}>{inline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "rule":
      return <hr key={key} />;
  }
}

function renderInline(piece: Inline, key: number, openUrl: (url: string) => void): ReactNode {
  const children = (pieces: Inline[]) => pieces.map((inner, index) => renderInline(inner, index, openUrl));
  switch (piece.kind) {
    case "text":
      return <Fragment key={key}>{piece.text}</Fragment>;
    case "break":
      return <br key={key} />;
    case "code":
      return <code key={key}>{piece.text}</code>;
    case "strong":
      return <strong key={key}>{children(piece.children)}</strong>;
    case "em":
      return <em key={key}>{children(piece.children)}</em>;
    case "del":
      return <del key={key}>{children(piece.children)}</del>;
    case "link":
      return openable(piece.href) ? (
        <a
          key={key}
          href={piece.href}
          title={piece.href}
          onClick={(event) => {
            event.preventDefault();
            openUrl(piece.href);
          }}
        >
          {children(piece.children)}
        </a>
      ) : (
        <Fragment key={key}>{children(piece.children)}</Fragment>
      );
  }
}
