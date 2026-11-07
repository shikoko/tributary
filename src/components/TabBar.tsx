import type { ReactNode } from "react";
import { CloseIcon, Logo, PlusIcon } from "./Icons";
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
}

/**
 * One tab per open repository. It's also the title bar: the empty space drags the window,
 * and on Windows the minimize, maximize and close buttons are at its right.
 */
export function TabBar({ tabs, activePath, startTab, onSelect, onClose, onCloseStart, onNew, menuBar, extra }: Props) {
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
            className={`tab${tab.path === activePath ? " active" : ""}`}
            title={`${tab.path}${index < 9 ? `  (${modKey}${index + 1})` : ""}`}
            onMouseDown={(event) => {
              if (event.button === 0) onSelect(tab.path);
            }}
            onAuxClick={(event) => {
              // Middle-click closes, like in a browser.
              if (event.button === 1) onClose(tab.path);
            }}
          >
            <span className="tab-name">{tab.name}</span>
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
            <span className="tab-name">New tab</span>
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
