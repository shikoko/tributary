import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { CloseIcon, Logo, PlusIcon } from "./Icons";
import { stepFocus } from "../lib/inputMode";
import { growIn, shrinkAway } from "../lib/motion";
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
  /** A pull, fetch, push or checkout running in a repository: a ring on its tab, when it isn't the one shown. */
  busy?: { path: string; label: string; percent: number | null };
}

/** How far it is, as a ring that fills (or spins, when that isn't known). */
function ProgressRing({ percent }: { percent: number | null }) {
  const radius = 5;
  const around = 2 * Math.PI * radius;
  return (
    <svg className={`tab-ring${percent === null ? " spinning" : ""}`} width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r={radius} className="tab-ring-track" />
      <circle
        cx="7"
        cy="7"
        r={radius}
        className="tab-ring-fill"
        strokeDasharray={around}
        strokeDashoffset={percent === null ? around * 0.7 : around * (1 - percent / 100)}
        transform="rotate(-90 7 7)"
      />
    </svg>
  );
}

/**
 * New tabs grow into place and closed ones shrink away (a copy where they were, however
 * they were closed). Nothing moves when the tabs first show, and a repository opened from
 * the start screen's tab takes that tab's place without either moving.
 */
function useTabMotion(row: RefObject<HTMLDivElement | null>, tabs: Tab[], startTab: boolean) {
  const last = useRef<{ paths: string[]; nodes: Map<string, HTMLElement>; start: HTMLElement | null } | null>(null);
  useLayoutEffect(() => {
    const element = row.current;
    if (!element) return;
    const nodes = new Map<string, HTMLElement>();
    element.querySelectorAll<HTMLElement>(":scope > .tab[data-path]").forEach((node) => nodes.set(node.dataset.path!, node));
    // (Never a copy on its way out.)
    const start = element.querySelector<HTMLElement>(":scope > .start-tab:not(.tab-ghost)");
    const before = last.current;
    const paths = tabs.map((tab) => tab.path);
    last.current = { paths, nodes, start };
    if (!before) return;

    const added = paths.filter((path) => !before.paths.includes(path));
    const replaced = before.start !== null && start === null && added.length > 0;
    if (!replaced) for (const path of added) growIn(nodes.get(path)!);
    if (start && !before.start) growIn(start);

    const leave = (old: HTMLElement, next: Element | null) => {
      const ghost = old.cloneNode(true) as HTMLElement;
      for (const name of ["role", "data-path", "tabindex", "aria-selected", "title"]) ghost.removeAttribute(name);
      ghost.setAttribute("aria-hidden", "true");
      ghost.classList.add("tab-ghost");
      element.insertBefore(ghost, next);
      const animation = shrinkAway(ghost);
      if (animation) animation.finished.then(() => ghost.remove(), () => ghost.remove());
      else ghost.remove();
    };
    const after = (index: number) =>
      before.paths
        .slice(index + 1)
        .map((path) => nodes.get(path))
        .find(Boolean) ?? element.querySelector(":scope > .start-tab:not(.tab-ghost), :scope > .tab-new");
    before.paths.forEach((path, index) => {
      const old = before.nodes.get(path);
      if (!paths.includes(path) && old) leave(old, after(index));
    });
    if (before.start && !start && !replaced) leave(before.start, element.querySelector(":scope > .tab-new"));
  }, [row, tabs, startTab]);
}

/**
 * One tab per open repository. It's also the title bar: the empty space drags the window,
 * and on Windows the minimize, maximize and close buttons are at its right.
 */
export function TabBar({ tabs, activePath, startTab, onSelect, onClose, onCloseStart, onNew, menuBar, extra, news, onContextMenu, busy }: Props) {
  const row = useRef<HTMLDivElement>(null);
  useTabMotion(row, tabs, startTab);
  return (
    <div className={`tab-bar${isWindows ? " with-window-controls" : ""}`} data-tauri-drag-region>
      <span className="tab-logo" data-tauri-drag-region>
        <Logo size={20} />
      </span>
      {menuBar}
      <div ref={row} className="tabs" role="tablist">
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
            title={`${tab.path}${index < 9 ? `  (${modKey}${index + 1})` : ""}${news?.[tab.path] ? `\n${news[tab.path]}` : ""}${busy?.path === tab.path ? `\n${busy.label}${busy.percent === null ? "" : ` ${busy.percent}%`}` : ""}`}
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
            {busy?.path === tab.path && tab.path !== activePath && <ProgressRing percent={busy.percent} />}
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
