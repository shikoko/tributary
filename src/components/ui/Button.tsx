import type { ButtonHTMLAttributes, Ref } from "react";

/**
 * The kinds of button. Each has its own look, from its class (they're shown together on
 * the catalogue page, `?catalogue`):
 * - `primary`: the one thing to do (Create, Merge…), filled with the accent.
 * - `secondary`: anything else beside it (Cancel…).
 * - `outline`: actions in a panel or a row, quieter than a dialog's.
 * - `danger`: something that can't be taken back.
 * - `link`: an action that reads as part of the text.
 * - `icon`: an icon alone (with a `title` and `aria-label` to say what it does).
 * - `tool`: the toolbar's.
 */
export type ButtonKind = "primary" | "secondary" | "outline" | "danger" | "link" | "icon" | "tool";

/** The sizes there are, besides each kind's own. */
export type ButtonSize = "small" | "large";

const CLASSES: Record<ButtonKind, string> = {
  primary: "primary-small-button",
  secondary: "secondary-button",
  outline: "outline-button",
  danger: "danger-button",
  link: "link-button",
  icon: "icon-button",
  tool: "tool-button",
};

/** Which kinds come in which sizes. */
export const BUTTON_SIZES: Record<ButtonKind, ButtonSize[]> = {
  primary: ["large"],
  secondary: ["small", "large"],
  outline: ["small"],
  danger: [],
  link: [],
  icon: ["small"],
  tool: [],
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  kind: ButtonKind;
  size?: ButtonSize;
  ref?: Ref<HTMLButtonElement>;
};

/** A button of one of the app's kinds; anything else (a `className` too) goes on the button. */
export function Button({ kind, size, className, ...rest }: Props) {
  // A large primary button has a class of its own; other sizes add theirs to the kind's.
  const classes = kind === "primary" && size === "large" ? ["primary-button"] : [CLASSES[kind], size];
  if (className) classes.push(className);
  return <button className={classes.filter(Boolean).join(" ")} {...rest} />;
}
