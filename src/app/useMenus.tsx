import { useCallback, useState } from "react";
import type { MenuItem } from "../components/ContextMenu";
import { MenuBar, type AppMenu } from "../components/MenuBar";
import { isMac } from "../lib/platform";
import { menuItems } from "./appCommand";
import type { AppMenuDefinition } from "./appMenus";

/** A menu on screen: right-click menus, the menus of buttons, and the menu bar's. */
export interface OpenMenu {
  x: number;
  y: number;
  items: MenuItem[];
  /** For the menu bar's menus: ← and → open the menu beside it. */
  onSideways?: (step: 1 | -1) => void;
}

/** The one menu that can be open at a time. */
export function useContextMenu() {
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  /** A menu at (x, y), like where the pointer was. */
  const show = useCallback((x: number, y: number, items: MenuItem[]) => setMenu({ x, y, items }), []);
  /** A menu below `anchor`, like a button's, lined up with its right edge when that fits better. */
  const under = useCallback((anchor: HTMLElement, items: MenuItem[], width = 240) => {
    const rect = anchor.getBoundingClientRect();
    setMenu({ x: Math.max(4, Math.min(rect.left, rect.right - width)), y: rect.bottom + 4, items });
  }, []);
  const close = useCallback(() => setMenu(null), []);
  return { menu, setMenu, show, under, close };
}

export type ContextMenuState = ReturnType<typeof useContextMenu>;

/**
 * The in-window menu bar (Windows and Linux: macOS has its own): its menus open below
 * their titles, and ← → move between them. Nothing on macOS.
 */
export function useMenuBar(menus: AppMenuDefinition[], setMenu: (menu: OpenMenu) => void) {
  const barMenus = menus.map((menu): AppMenu => ({ label: menu.label, items: menuItems(menu.entries) }));
  const openBarMenu = (index: number) => {
    const anchor = document.querySelectorAll<HTMLElement>(".menu-bar-item")[index];
    if (!anchor || !barMenus[index]) return;
    const rect = anchor.getBoundingClientRect();
    setMenu({
      x: rect.left,
      y: rect.bottom + 4,
      items: barMenus[index].items,
      onSideways: (step) => openBarMenu((index + step + barMenus.length) % barMenus.length),
    });
  };
  return {
    /** F10: the first menu. */
    openFirst: () => !isMac && openBarMenu(0),
    element: isMac ? undefined : <MenuBar menus={barMenus} onOpen={(menu) => openBarMenu(barMenus.indexOf(menu))} />,
  };
}
