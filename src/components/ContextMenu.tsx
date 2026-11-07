import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { stepFocus, usingKeyboard } from "../lib/inputMode";
import { CheckIcon } from "./Icons";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Draw a divider above this item. */
  separated?: boolean;
  /** For on/off settings: show a check mark when true. */
  checked?: boolean;
  /** A keyboard shortcut to show on the right, like "⌘B". */
  shortcut?: string;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
  /** For a menu bar's menu: ← and → open the menu next to it. */
  onSideways?: (step: 1 | -1) => void;
}

/**
 * A right-click menu at (x, y), kept inside the window. The keyboard works as in a
 * system menu: ↑ ↓ Home End move, a letter jumps to the next item starting with it,
 * Enter picks, Esc and Tab close.
 */
export function ContextMenu({ x, y, items, onClose, onSideways }: Props) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const element = menu.current!;
    const { width, height } = element.getBoundingClientRect();
    setPosition({
      left: Math.max(4, Math.min(x, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - height - 4)),
    });
    // Opened from the keyboard: start on the first item. With the mouse: nothing highlighted.
    const first = element.querySelector<HTMLButtonElement>(".menu-item:not(:disabled)");
    (usingKeyboard() && first ? first : element).focus();
  }, [x, y, items]);

  const buttons = () => [...(menu.current?.querySelectorAll<HTMLButtonElement>(".menu-item:not(:disabled)") ?? [])];

  return (
    <div
      className="menu-backdrop"
      onMouseDown={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        ref={menu}
        className="context-menu"
        style={position}
        role="menu"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape" || event.key === "Tab") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            return;
          }
          if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && onSideways) {
            event.preventDefault();
            onSideways(event.key === "ArrowRight" ? 1 : -1);
            return;
          }
          const all = buttons();
          const current = all.find((button) => button === document.activeElement) ?? null;
          const vertical = event.key === "ArrowLeft" || event.key === "ArrowRight" ? null : stepFocus(all, current, event.key);
          if (vertical) {
            event.preventDefault();
            vertical.focus();
            return;
          }
          // A letter: the next item starting with it.
          if (event.key.length === 1 && /\S/.test(event.key) && !event.metaKey && !event.ctrlKey) {
            const start = current ? all.indexOf(current) + 1 : 0;
            const ordered = [...all.slice(start), ...all.slice(0, start)];
            const match = ordered.find((button) => button.textContent?.trim().toLowerCase().startsWith(event.key.toLowerCase()));
            if (match) {
              event.preventDefault();
              match.focus();
            }
          }
        }}
      >
        {items.map((item) => (
          <div key={item.label}>
            {item.separated && <div className="menu-separator" role="separator" />}
            <button
              className={`menu-item${item.danger ? " danger" : ""}`}
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                onClose();
                item.onSelect();
              }}
            >
              <span className="menu-icon">{item.checked ? <CheckIcon /> : item.icon}</span>
              <span className="menu-label">{item.label}</span>
              {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
