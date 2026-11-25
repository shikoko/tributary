import { useLayoutEffect, type CSSProperties, type RefObject } from "react";
import { hangsFrom, JOINT_GAP, meets, type Box } from "../lib/joint";

/** The colour of the panel it joins: a menu's (raised) or a panel's. */
export type JointFill = "raised" | "panel";

interface Props {
  /** The button, on whole pixels (snap). */
  button: Box;
  /** Its corners' roundness, in pixels. */
  radius: number;
  /** Where the panel is. */
  panel: { left: number; top: number; width: number };
  fill: JointFill;
}

/**
 * A button and the panel it opened drawn as one, as a tab and the page under it are: an
 * outline round the button that runs down into the panel's edge, curving into it on a side
 * where the button isn't at the panel's corner. Over the button it's only the outline: the
 * button shows through it, in the panel's colour (useJoinedButton). Drawn after the panel,
 * over its edge, and nothing when the panel doesn't hang from the button.
 */
export function Joint({ button, radius, panel, fill }: Props) {
  if (!hangsFrom(button, panel.top)) return null;
  const corners = meets(button, panel.left, panel.width);
  const flareTop = panel.top + 1 - JOINT_GAP;
  return (
    <>
      <div
        className={`joint ${fill}`}
        style={
          {
            left: button.left,
            top: button.top,
            width: button.right - button.left,
            // Down over the panel's top edge, so its line doesn't cross under the button.
            height: panel.top + 1 - button.top,
            "--joint-button": `${button.bottom - button.top}px`,
            "--joint-radius": `${radius}px`,
          } as CSSProperties
        }
        aria-hidden
      />
      {!corners.left && <div className={`joint-flare left ${fill}`} style={{ left: button.left + 1 - JOINT_GAP, top: flareTop }} aria-hidden />}
      {!corners.right && <div className={`joint-flare right ${fill}`} style={{ left: button.right - 1, top: flareTop }} aria-hidden />}
    </>
  );
}

/** The panel's style for its top corners: square where they meet the button's sides. */
export function jointCorners(button: Box | null, panel: { left: number; top: number; width: number }): CSSProperties {
  if (!button || !hangsFrom(button, panel.top)) return {};
  const corners = meets(button, panel.left, panel.width);
  return { ...(corners.left ? { borderTopLeftRadius: 0 } : {}), ...(corners.right ? { borderTopRightRadius: 0 } : {}) };
}

/** While `on`, `button` takes the colour of the panel it's joined to (see [data-joined] in
 *  joints.css). */
export function useJoinedButton(button: HTMLElement | RefObject<HTMLElement | null> | null | undefined, fill: JointFill, on: boolean) {
  useLayoutEffect(() => {
    const element = button && "current" in button ? button.current : button;
    if (!element || !on) return;
    element.dataset.joined = fill;
    return () => {
      delete element.dataset.joined;
    };
  }, [button, fill, on]);
}

/** A button's corner roundness, for the outline drawn round it. */
export const cornerOf = (button: HTMLElement) => parseFloat(getComputedStyle(button).borderTopLeftRadius) || 0;
