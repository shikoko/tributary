import { createContext, useContext } from "react";

/**
 * Where what something says on hover goes: the browser's tooltip (`title`), or the app's own
 * card (`data-hint`, which the commit list's hover card shows). In the commit list, with its
 * hover card on, only the card shows: two overlays at once say the same thing twice.
 */
export const HintsInCardContext = createContext(false);

/** The attribute that says `text` on hover: a tooltip, or a hint for the hover card. */
export function useHint(): (text: string) => { title: string } | { "data-hint": string } {
  const inCard = useContext(HintsInCardContext);
  return (text) => (inCard ? { "data-hint": text } : { title: text });
}

/** The hint under the pointer, for the hover card: the nearest `data-hint` around `target`. */
export function hintAt(target: EventTarget | null): string | null {
  return target instanceof Element ? (target.closest("[data-hint]")?.getAttribute("data-hint") ?? null) : null;
}
