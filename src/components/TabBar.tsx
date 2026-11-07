import { useRef, type ReactNode } from "react";
import { CloseIcon, Logo, PlusIcon } from "./Icons";
import { modKey } from "../lib/platform";

export interface Tab {
  path: string;
  name: string;
}

interface Props {
  tabs: Tab[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  /** Open the "new tab" menu under the given element. */
  onNew: (anchor: HTMLElement) => void;
  /** The File, View, … menus, on systems without a menu bar of their own. */
  menuBar?: ReactNode;
}

/** One tab per open repository. The empty space drags the window (macOS title bar). */
export function TabBar({ tabs, activePath, onSelect, onClose, onNew, menuBar }: Props) {
  const plus = useRef<HTMLButtonElement>(null);
  return (
    <div className="tab-bar" data-tauri-drag-region>
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
        <button
          ref={plus}
          className="tab-new"
          onClick={() => plus.current && onNew(plus.current)}
          title={`Open a repository in a new tab (${modKey}T)`}
          aria-label="New tab"
        >
          <PlusIcon size={14} />
        </button>
      </div>
      <div className="tab-bar-fill" data-tauri-drag-region />
    </div>
  );
}
