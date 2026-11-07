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
  | "Services"
  | "About";

export interface NativeMenu {
  label: string;
  items: (NativeItem | { system: SystemItem })[];
}

let current: Menu | null = null;
let version = 0;

/** Replace the app's menu bar. `onSelect` is called with the id of the chosen item. */
export async function setNativeMenu(menus: NativeMenu[], onSelect: (id: string) => void): Promise<void> {
  const mine = ++version;
  const action = (id: string) => () => onSelect(id);
  const submenus = await Promise.all(
    menus.map(async (menu) => {
      const items = [];
      for (const item of menu.items) {
        if ("system" in item) {
          items.push(
            await PredefinedMenuItem.new({ item: item.system === "About" ? { About: null } : item.system }),
          );
          continue;
        }
        if (item.separated) items.push(await PredefinedMenuItem.new({ item: "Separator" }));
        const options = {
          id: item.id,
          text: item.label,
          accelerator: item.accelerator,
          enabled: item.enabled ?? true,
          action: action(item.id),
        };
        items.push(
          item.checked === undefined
            ? await MenuItem.new(options)
            : await CheckMenuItem.new({ ...options, checked: item.checked }),
        );
      }
      return Submenu.new({ text: menu.label, items });
    }),
  );
  // A newer menu was asked for while this one was being built.
  if (mine !== version) return;
  const menu = await Menu.new({ items: submenus });
  await menu.setAsAppMenu();
  const old = current;
  current = menu;
  await old?.close().catch(() => {});
}
