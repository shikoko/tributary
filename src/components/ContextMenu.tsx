import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { stepFocus, usingKeyboard } from "../lib/inputMode";
import { CheckIcon, ChevronRightIcon } from "./Icons";

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
  /** A second, smaller line under the label (like whether a merge would conflict). */
  detail?: ReactNode;
  /** Opens these beside it, instead of doing something itself. */
  submenu?: MenuItem[];
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
  /** For a menu bar's menu: ← and → open the menu next to it. */
  onSideways?: (step: 1 | -1) => void;
}

/** How long the pointer rests on an item before its submenu opens (or another one closes). */
const HOVER_MS = 140;

/**
 * A right-click menu at (x, y), kept inside the window. The keyboard works as in a
 * system menu: ↑ ↓ Home End move, a letter jumps to the next item starting with it,
 * Enter picks, → opens a submenu and ← closes it, Esc and Tab close.
 */
export function ContextMenu({ x, y, items, onClose, onSideways }: Props) {
  return (
    <div
      className="menu-backdrop"
      onMouseDown={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <MenuPanel x={x} y={y} items={items} onClose={onClose} onSideways={onSideways} focusFirst={usingKeyboard()} />
    </div>
  );
}

interface PanelProps {
  x: number;
  y: number;
  /** Where it goes instead when it doesn't fit on the right (a submenu: its parent's left edge). */
  flipX?: number;
  items: MenuItem[];
  /** Closes the whole menu. */
  onClose: () => void;
  onSideways?: (step: 1 | -1) => void;
  /** A submenu: closes it, back to its parent. */
  onBack?: () => void;
  focusFirst: boolean;
}

function MenuPanel({ x, y, flipX, items, onClose, onSideways, onBack, focusFirst }: PanelProps) {
  const menu = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const [open, setOpen] = useState<{ index: number; x: number; y: number; flipX: number; keyboard: boolean } | null>(null);
  const hover = useRef(0);

  useLayoutEffect(() => {
    const element = menu.current!;
    const { width, height } = element.getBoundingClientRect();
    const fitsRight = x + width <= window.innerWidth - 4;
    setPosition({
      left: Math.max(4, fitsRight || flipX === undefined ? Math.min(x, window.innerWidth - width - 4) : flipX - width),
      top: Math.max(4, Math.min(y, window.innerHeight - height - 4)),
    });
    // Opened from the keyboard: start on the first item. With the mouse: nothing highlighted.
    const first = list.current?.querySelector<HTMLButtonElement>(".menu-item:not(:disabled)");
    if (focusFirst && first) first.focus();
    else if (!onBack) element.focus();
  }, [x, y, flipX, items, focusFirst, onBack]);

  const buttons = () => [...(list.current?.querySelectorAll<HTMLButtonElement>(":scope > div > .menu-item:not(:disabled)") ?? [])];
  const openSubmenu = (index: number, button: HTMLElement, keyboard: boolean) => {
    window.clearTimeout(hover.current);
    const rect = button.getBoundingClientRect();
    setOpen({ index, x: rect.right - 2, y: rect.top - 5, flipX: rect.left + 2, keyboard });
  };
  const closeSubmenu = () => {
    const index = open?.index;
    setOpen(null);
    if (index !== undefined) list.current?.querySelectorAll<HTMLButtonElement>(":scope > div > .menu-item")[index]?.focus();
  };

  return (
    <div
      ref={menu}
      className="context-menu"
      style={position}
      role="menu"
      tabIndex={-1}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        // A submenu's keys are its own: the menu it's in doesn't act on them too.
        event.stopPropagation();
        if (event.key === "Tab") {
          event.preventDefault();
          onClose();
          return;
        }
        if (event.key === "Escape" || (event.key === "ArrowLeft" && onBack)) {
          event.preventDefault();
          if (onBack) onBack();
          else onClose();
          return;
        }
        const all = buttons();
        const current = all.find((button) => button === document.activeElement) ?? null;
        if (event.key === "ArrowRight" && current) {
          const index = [...(list.current?.querySelectorAll(":scope > div > .menu-item") ?? [])].indexOf(current);
          if (items[index]?.submenu) {
            event.preventDefault();
            openSubmenu(index, current, true);
            return;
          }
        }
        if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && onSideways) {
          event.preventDefault();
          onSideways(event.key === "ArrowRight" ? 1 : -1);
          return;
        }
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
      <div ref={list}>
        {items.map((item, index) => (
          <div key={item.label}>
            {item.separated && <div className="menu-separator" role="separator" />}
            <button
              className={`menu-item${item.danger ? " danger" : ""}${open?.index === index ? " open" : ""}`}
              role="menuitem"
              aria-haspopup={item.submenu ? "menu" : undefined}
              aria-expanded={item.submenu ? open?.index === index : undefined}
              disabled={item.disabled}
              onMouseEnter={(event) => {
                window.clearTimeout(hover.current);
                const button = event.currentTarget;
                if (item.submenu) hover.current = window.setTimeout(() => openSubmenu(index, button, false), HOVER_MS);
                else if (open) hover.current = window.setTimeout(() => setOpen(null), HOVER_MS);
              }}
              onMouseLeave={() => window.clearTimeout(hover.current)}
              onClick={(event) => {
                if (item.submenu) {
                  openSubmenu(index, event.currentTarget, usingKeyboard());
                  return;
                }
                onClose();
                item.onSelect();
              }}
            >
              <span className="menu-icon">{item.checked ? <CheckIcon /> : item.icon}</span>
              {item.detail ? (
                <span className="menu-text">
                  <span className="menu-label">{item.label}</span>
                  <span className="menu-detail">{item.detail}</span>
                </span>
              ) : (
                <span className="menu-label">{item.label}</span>
              )}
              {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
              {item.submenu && (
                <span className="menu-chevron">
                  <ChevronRightIcon size={12} />
                </span>
              )}
            </button>
          </div>
        ))}
      </div>
      {open && items[open.index]?.submenu && (
        <MenuPanel
          x={open.x}
          y={open.y}
          flipX={open.flipX}
          items={items[open.index].submenu!}
          onClose={onClose}
          onBack={closeSubmenu}
          focusFirst={open.keyboard}
        />
      )}
    </div>
  );
}
