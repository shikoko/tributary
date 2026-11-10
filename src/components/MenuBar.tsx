import type { MenuItem } from "./ContextMenu";

export interface AppMenu {
  label: string;
  items: MenuItem[];
}

interface Props {
  menus: AppMenu[];
  /** Open `menu`'s items under `anchor`. */
  onOpen: (menu: AppMenu, anchor: HTMLElement) => void;
}

/** The File, View, Repository and Help menus, in the tab bar (on Windows and Linux; macOS uses its own menu bar). */
export function MenuBar({ menus, onOpen }: Props) {
  return (
    <nav className="menu-bar" aria-label="Menu">
      {menus.map((menu) => (
        <button
          key={menu.label}
          className="menu-bar-item"
          data-tour={`menu-${menu.label.toLowerCase()}`}
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            onOpen(menu, event.currentTarget);
          }}
        >
          {menu.label}
        </button>
      ))}
    </nav>
  );
}
