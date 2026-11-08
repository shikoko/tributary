import type { ReactNode } from "react";
import { CloseIcon, Logo, PlusIcon } from "./Icons";
import { stepFocus } from "../lib/inputMode";
import { isWindows, modKey } from "../lib/platform";
import { WindowControls } from "./WindowControls";

export interface Tab {
  path: string;
  name: string;
}

interface Props {
  tabs: Tab[];
  activePath: string | null;
  /** Show the "New tab" start screen's tab, after the others. */
  startTab: boolean;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onCloseStart: () => void;
  /** Open a new tab with the start screen. */
  onNew: () => void;
  /** The File, View, … menus, on systems without a menu bar of their own. */
  menuBar?: ReactNode;
  /** Shown at the right, like "Update available". */
  extra?: ReactNode;
  /** Tabs whose background fetch found new commits: what arrived, by path. */
  news?: Record<string, string>;
  /** Right-click on a repository's tab (or the menu key on it). */
  onContextMenu?: (path: string, x: number, y: number) => void;
}

/**
 * One tab per open repository. It's also the title bar: the empty space drags the window,
 * and on Windows the minimize, maximize and close buttons are at its right.
 */
export function TabBar({ tabs, activePath, startTab, onSelect, onClose, onCloseStart, onNew, menuBar, extra, news, onContextMenu }: Props) {
  return (
    <div className={`tab-bar${isWindows ? " with-window-controls" : ""}`} data-tauri-drag-region>
      <span className="tab-logo" data-tauri-drag-region>
        <Logo size={18} />
      </span>
      {menuBar}
      <div className="tabs" role="tablist">
        {tabs.map((tab, index) => (
          <div
            key={tab.path}
            role="tab"
            aria-selected={tab.path === activePath}
            tabIndex={tab.path === activePath || (activePath === null && index === 0) ? 0 : -1}
            onKeyDown={(event) => {
              // ← → Home End move between tabs, Enter or Space switches, Delete closes.
              const all = [...(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>("[role=tab][data-path]") ?? [])];
              const next = stepFocus(all, event.currentTarget, event.key === "ArrowUp" || event.key === "ArrowDown" ? "" : event.key);
              if (next) {
                event.preventDefault();
                next.focus();
              } else if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(tab.path);
              } else if (event.key === "Delete") {
                event.preventDefault();
                onClose(tab.path);
              }
            }}
            data-path={tab.path}
            className={`tab${tab.path === activePath ? " active" : ""}${news?.[tab.path] ? " has-news" : ""}`}
            title={`${tab.path}${index < 9 ? `  (${modKey}${index + 1})` : ""}${news?.[tab.path] ? `\n${news[tab.path]}` : ""}`}
            onMouseDown={(event) => {
              if (event.button === 0) onSelect(tab.path);
            }}
            onAuxClick={(event) => {
              // Middle-click closes, like in a browser.
              if (event.button === 1) onClose(tab.path);
            }}
            onContextMenu={
              onContextMenu &&
              ((event) => {
                event.preventDefault();
                // From the keyboard there's no pointer: open under the tab.
                const rect = event.currentTarget.getBoundingClientRect();
                const keyboard = event.clientX === 0 && event.clientY === 0;
                onContextMenu(tab.path, keyboard ? rect.left : event.clientX, keyboard ? rect.bottom : event.clientY);
              })
            }
          >
            <span className="tab-name" data-text={tab.name}>
              <span>{tab.name}</span>
            </span>
            {news?.[tab.path] && <span className="tab-news" aria-label="New commits" />}
            <button
              className="tab-close"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => onClose(tab.path)}
              aria-label={`Close ${tab.name}`}
              title={`Close tab (${modKey}W)`}
            >
              <CloseIcon size={12} />
            </button>
          </div>
        ))}
        {startTab && (
          <div role="tab" aria-selected className="tab active start-tab" title="Open, clone or create a repository">
            <span className="tab-name" data-text="New tab">
              <span>New tab</span>
            </span>
            <button className="tab-close" onClick={onCloseStart} aria-label="Close the new tab" title={`Close tab (${modKey}W)`}>
              <CloseIcon size={12} />
            </button>
          </div>
        )}
        <button className="tab-new" onClick={onNew} title={`New tab (${modKey}T)`} aria-label="New tab">
          <PlusIcon size={14} />
        </button>
      </div>
      <div className="tab-bar-fill" data-tauri-drag-region />
      {extra}
      {isWindows && <WindowControls />}
    </div>
  );
}
