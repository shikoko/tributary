import { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";

/** A command in the macOS menu bar. */
export interface NativeItem {
  id: string;
  label: string;
  /** Like "CmdOrCtrl+K". */
  accelerator?: string;
  enabled?: boolean;
  /** For on/off settings. */
  checked?: boolean;
  /** Draw a divider above this item. */
  separated?: boolean;
}

/** One of the items macOS provides, like Copy or Quit. */
export type SystemItem =
  | "Separator"
  | "Copy"
  | "Cut"
  | "Paste"
  | "SelectAll"
  | "Undo"
  | "Redo"
  | "Minimize"
  | "Maximize"
  | "Fullscreen"
  | "Hide"
  | "HideOthers"
  | "ShowAll"
  | "Quit"
  | "Services";

/** A submenu inside a menu, with its own items. */
export interface NativeSubmenu {
  submenu: string;
  items: NativeMenu["items"];
  /** Draw a divider above it. */
  separated?: boolean;
}

export interface NativeMenu {
  label: string;
  items: (NativeItem | NativeSubmenu | { system: SystemItem })[];
}

let current: Menu | null = null;
let version = 0;

/** Replace the app's menu bar. `onSelect` is called with the id of the chosen item. */
export async function setNativeMenu(menus: NativeMenu[], onSelect: (id: string) => void): Promise<void> {
  const mine = ++version;
  const action = (id: string) => () => onSelect(id);
  // The items of a menu or submenu, submenus built the same way.
  type Built = MenuItem | CheckMenuItem | PredefinedMenuItem | Submenu;
  const build = async (list: NativeMenu["items"]): Promise<Built[]> => {
    const items: Built[] = [];
    for (const item of list) {
      if ("system" in item) {
        items.push(await PredefinedMenuItem.new({ item: item.system }));
        continue;
      }
      if (item.separated) items.push(await PredefinedMenuItem.new({ item: "Separator" }));
      if ("submenu" in item) {
        items.push(await Submenu.new({ text: item.submenu, items: await build(item.items) }));
        continue;
      }
      const options = {
        id: item.id,
        text: item.label,
        accelerator: item.accelerator,
        enabled: item.enabled ?? true,
        action: action(item.id),
      };
      items.push(item.checked === undefined ? await MenuItem.new(options) : await CheckMenuItem.new({ ...options, checked: item.checked }));
    }
    return items;
  };
  const submenus = await Promise.all(menus.map(async (menu) => Submenu.new({ text: menu.label, items: await build(menu.items) })));
  // A newer menu was asked for while this one was being built.
  if (mine !== version) return;
  const menu = await Menu.new({ items: submenus });
  await menu.setAsAppMenu();
  const old = current;
  current = menu;
  await old?.close().catch(() => {});
}
