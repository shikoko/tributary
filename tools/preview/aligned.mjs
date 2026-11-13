// Checks that the words on controls (buttons, menu items, tabs, chips and badges) and on
// anything else drawn as a small box around them (a version's tag, a key) sit in the middle
// of them, as the smoke test's screens are checked for accessibility.
//
// A browser centres a line of text by the font's line box, and where the letters fall in it
// depends on the font, its size, how the browser rounds its ascent, and the display's scale:
// plain text in a control sits a pixel or two high or low, differently from one control to the
// next. Text trimmed to its capitals (`text-box: trim-both cap alphabetic`, as `.button-label`
// and `.chip-text` are) has a box that runs from the top of its capitals to its baseline, so
// centring it centres the letters. So a control's words have to be trimmed, and their trimmed
// box has to be in the control's middle, to within a screen pixel, at each display scale.
// The measurements are the page's own, the same on every machine.

/** Controls whose words should sit in their middle. */
export const CONTROLS = [
  "button",
  "[role='button']",
  "[role='tab']",
  "[role='menuitem']",
  "[role='menuitemcheckbox']",
  "[role='menuitemradio']",
  "[class*='chip']",
  "[class*='badge']",
  "[class*='pill']",
  // The status bar's words, which line up with its buttons.
  ".status-item",
].join(", ");

/**
 * Controls whose words line up with something else instead, or have no box to be in the
 * middle of: the blame gutter's commit summaries sit on the line of code beside them, and a
 * link button is words alone.
 */
export const EXCEPT = [".blame-gutter", ".link-button"].join(", ");

/** The display scales it checks at: as on Windows (100% to 150%) and on a Mac's screen (200%). */
export const SCALES = [1, 1.25, 1.5, 2];

/**
 * The controls on screen whose words aren't trimmed to their capitals, or are off the middle
 * by more than `tolerance` screen pixels at one of `scales`: what each says, its classes, and
 * (when off the middle) the room above and below its capitals, in screen pixels.
 */
export async function misaligned(page, { scales = SCALES, tolerance = 1 } = {}) {
  return page.evaluate(
    ([selector, except, scales, tolerance]) => {
      const root = document.documentElement;
      const before = root.style.getPropertyValue("--device-pixel");
      const trimmed = (element) => {
        const style = getComputedStyle(element);
        return /trim-both/.test(`${style.textBoxTrim ?? ""} ${style.textBox ?? ""}`);
      };
      /**
       * A small box drawn around words, whatever it's called: rounded, with a background or a
       * border, at most 32px tall, with words of its own in it.
       */
      const boxed = (element) => {
        const style = getComputedStyle(element);
        if (parseFloat(style.borderTopLeftRadius) === 0 || element.getBoundingClientRect().height > 32) return false;
        const filled = !/^(transparent|rgba\(.*,\s*0\))$/.test(style.backgroundColor);
        const outlined = parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== "none";
        return (filled || outlined) && [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      };
      const candidates = new Set([...document.querySelectorAll(selector), ...[...document.querySelectorAll("body *")].filter(boxed)]);
      /** The control or box that `node`'s words are on: the nearest one around it. */
      const ownerOf = (node) => {
        for (let element = node.parentElement; element; element = element.parentElement) if (candidates.has(element)) return element;
        return null;
      };
      /** The first words in `control` that aren't in a control of their own inside it. */
      const words = (control) => {
        const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node.textContent.trim() && ownerOf(node) === control) return node;
        }
        return null;
      };
      /** The element trimming `text` to its capitals, between it and `control`, if there is one. */
      const trimmer = (text, control) => {
        for (let element = text.parentElement; element; element = element.parentElement) {
          if (trimmed(element)) return element;
          if (element === control) return null;
        }
        return null;
      };
      const visible = (box) => box.width > 0 && box.height > 0 && box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth;
      const name = (control, text) => ({ text: text.textContent.trim().slice(0, 40), classes: String(control.className?.baseVal ?? control.className) });
      const found = [];
      const controls = [...candidates].flatMap((control) => {
        const box = control.getBoundingClientRect();
        const style = getComputedStyle(control);
        // A row of words, not a block of them, that can be seen. A control in running text (a
        // commit's SHA in its message) is as the text around it is: its box is the line's.
        if (control.matches(except)) return [];
        if (!visible(box) || box.height > 44 || style.display === "inline" || style.visibility === "hidden" || Number(style.opacity) === 0) return [];
        // One line of words: a name with a second line under it (a menu item's detail) isn't centred on the first.
        if (control.innerText.trim().includes("\n")) return [];
        const text = words(control);
        if (!text) return [];
        const range = document.createRange();
        range.selectNodeContents(text);
        if (range.getClientRects().length !== 1) return [];
        const letters = trimmer(text, control);
        if (!letters) {
          found.push({ ...name(control, text), problem: "not trimmed" });
          return [];
        }
        return [{ control, letters, text }];
      });
      try {
        for (const scale of scales) {
          root.style.setProperty("--device-pixel", `${1 / scale}px`);
          for (const { control, letters, text } of controls) {
            const box = control.getBoundingClientRect();
            const capitals = letters.getBoundingClientRect();
            const above = (capitals.top - box.top) * scale;
            const below = (box.bottom - capitals.bottom) * scale;
            if (Math.abs(above - below) > tolerance) {
              found.push({ ...name(control, text), problem: "off the middle", scale, above: Number(above.toFixed(1)), below: Number(below.toFixed(1)) });
            }
          }
        }
      } finally {
        if (before) root.style.setProperty("--device-pixel", before);
        else root.style.removeProperty("--device-pixel");
      }
      return found;
    },
    [CONTROLS, EXCEPT, scales, tolerance],
  );
}

/** `found` in a few words each: `not trimmed: .tool-button "Fetch"`, `off the middle at 150%: … (11 above, 14 below)`. */
export function describe(found) {
  return found.map((item) =>
    item.problem === "not trimmed"
      ? `not trimmed: .${item.classes.split(" ")[0]} "${item.text}"`
      : `off the middle at ${item.scale * 100}%: .${item.classes.split(" ")[0]} "${item.text}" (${item.above} above, ${item.below} below)`,
  );
}
