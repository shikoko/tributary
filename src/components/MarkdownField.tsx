import { useRef, useState, type KeyboardEvent, type TextareaHTMLAttributes } from "react";
import { openInBrowser } from "../lib/weblinks";
import { Markdown } from "./Markdown";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string };

/**
 * A box for writing Markdown (a comment, a review, a pull request's description), with
 * Write and Preview tabs as on GitHub: Preview shows it as it will look there.
 * Ctrl/⌘+Shift+P switches between them. The preview keeps the box's height, so nothing
 * jumps.
 */
export function MarkdownField({ value, className, onKeyDown, ...rest }: Props) {
  const [previewing, setPreviewing] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const height = useRef(0);
  const show = (preview: boolean) => {
    if (preview && input.current) height.current = input.current.offsetHeight;
    setPreviewing(preview);
    if (!preview) requestAnimationFrame(() => input.current?.focus());
  };
  const switchKey = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() === "p" && event.shiftKey && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      show(!previewing);
      return true;
    }
    return false;
  };
  return (
    <div className={`markdown-field${previewing ? " previewing" : ""}`}>
      <div className="markdown-field-tabs" role="tablist" aria-label="Write or preview">
        <button type="button" role="tab" aria-selected={!previewing} className={`markdown-field-tab${previewing ? "" : " on"}`} onClick={() => show(false)}>
          <span className="button-label">Write</span>
        </button>
        <button type="button" role="tab" aria-selected={previewing} className={`markdown-field-tab${previewing ? " on" : ""}`} onClick={() => show(true)}>
          <span className="button-label">Preview</span>
        </button>
        <span className="markdown-field-hint">Markdown</span>
      </div>
      {previewing ? (
        <div
          className="markdown-field-preview"
          tabIndex={0}
          style={{ minHeight: height.current || undefined }}
          onKeyDown={(event) => switchKey(event)}
          aria-label="Preview"
        >
          {value.trim() ? <Markdown text={value} openUrl={openInBrowser} /> : <p className="markdown-field-empty">Nothing to preview yet.</p>}
        </div>
      ) : (
        <textarea
          {...rest}
          ref={input}
          className={`markdown-field-input${className ? ` ${className}` : ""}`}
          value={value}
          onKeyDown={(event) => {
            if (!switchKey(event)) onKeyDown?.(event);
          }}
        />
      )}
    </div>
  );
}
