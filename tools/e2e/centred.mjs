// Checks that the words on controls sit in the middle of them in the window's own pixels, as
// a screenshot of it shows them. Browsers put letters on whole screen pixels, so words that
// sit in the middle by their measurements (as tools/preview/aligned.mjs checks) can still be
// a pixel off. The smoke test runs it in Chromium, and the desktop tests in the app's own
// window on Windows.
//
// Each control's words are swapped for H's for the screenshot, which have a flat bottom on the
// baseline (no descenders, no round bottoms), in the same font, size and place; then the rows
// of pixels below them, inside the control, are counted. The rows above are what's left of
// the inside over the capitals' height in whole pixels: their top row is only partly covered
// (59% of it at 12px), so counting it by its strength would be a guess.

import { CONTROLS, EXCEPT } from "../preview/aligned.mjs";
import { decodePng } from "./png.mjs";

/**
 * In the page: swaps the words of each control on screen for H's, and says where each control's
 * inside (within its border: its padding is room around its words too) and its words are.
 * `restore` puts the words back.
 */
export function probe(controls, except) {
  const trimmed = (element) => /trim-both/.test(`${getComputedStyle(element).textBoxTrim ?? ""} ${getComputedStyle(element).textBox ?? ""}`);
  window.__centred = [];
  // Nothing drawn over the room around the words for the screenshot: no underline below
  // them, no focus ring inside the control, no caret.
  const quiet = document.createElement("style");
  quiet.id = "centred-quiet";
  quiet.textContent = "*, *::before, *::after { text-decoration: none !important; outline: none !important; caret-color: transparent !important; }";
  document.head.append(quiet);
  const found = [];
  for (const control of document.querySelectorAll(controls)) {
    if (control.matches(except)) continue;
    const box = control.getBoundingClientRect();
    const style = getComputedStyle(control);
    if (!box.width || !box.height || box.height > 44 || style.display === "inline" || style.visibility === "hidden" || Number(style.opacity) < 1) continue;
    if (box.top < 0 || box.bottom > innerHeight || box.left < 0 || box.right > innerWidth) continue;
    // Only what's on top: not under a dialog or a panel, even in part (its middle, and just
    // inside its top, bottom and ends).
    const [x, y] = [box.left + box.width / 2, box.top + box.height / 2];
    const points = [[x, y], [x, box.top + 1.5], [x, box.bottom - 1.5], [box.left + 1.5, y], [box.right - 1.5, y]];
    if (points.some(([px, py]) => !control.contains(document.elementFromPoint(px, py)))) continue;
    if (control.innerText.trim().includes("\n")) continue;
    const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
    let text = null;
    // Its own words: not a control's inside it, though a trimmed label of its own can match
    // the controls' selectors too (a chip's chip-text).
    const owner = (node) => {
      const inner = node.parentElement.closest(controls);
      return inner !== control && trimmed(inner) && inner.parentElement.closest(controls) === control ? control : inner;
    };
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent.trim() && owner(node) === control) {
        text = node;
        break;
      }
    }
    if (!text) continue;
    let label = null;
    for (let element = text.parentElement; element; element = element.parentElement) {
      if (trimmed(element)) {
        label = element;
        break;
      }
      if (element === control) break;
    }
    // Words that aren't trimmed are the preview's alignment check's to find; trimmed words
    // matched as a control themselves (a chip's text) have no box of their own to be in.
    if (!label || label === control) continue;
    // All of the label's words: a count and a word after it can be separate text.
    const words = [];
    const inLabel = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
    for (let node = inLabel.nextNode(); node; node = inLabel.nextNode()) if (node.data.trim()) words.push(node);
    const name = label.textContent.trim().slice(0, 30);
    for (const [index, node] of words.entries()) {
      window.__centred.push([node, node.data]);
      node.data = "H".repeat(Math.min(Math.max(node.data.trim().length, index === 0 ? 2 : 1), 6));
    }
    found.push({ control, label, name, classes: String(control.className?.baseVal ?? control.className).split(" ")[0] });
  }
  // The capitals' height in each label's font, measured as 1cap tall.
  const capHeight = (label) => {
    const font = getComputedStyle(label);
    const measure = document.createElement("div");
    measure.style.cssText = `position:absolute;visibility:hidden;height:1cap;font:${font.fontWeight} ${font.fontSize} ${font.fontFamily};font-variation-settings:${font.fontVariationSettings}`;
    document.body.append(measure);
    const height = measure.getBoundingClientRect().height;
    measure.remove();
    return height;
  };
  return found.map(({ control, label, name, classes }) => {
    const box = control.getBoundingClientRect();
    const style = getComputedStyle(control);
    const words = label.getBoundingClientRect();
    return {
      name,
      classes,
      top: box.top + parseFloat(style.borderTopWidth),
      bottom: box.bottom - parseFloat(style.borderBottomWidth),
      left: words.left,
      right: words.right,
      cap: capHeight(label),
      scale: devicePixelRatio,
    };
  });
}

/** In the page: the words `probe` swapped, back. */
export function restore() {
  // Last first: a control inside another one has its words in the list twice.
  for (const [text, original] of (window.__centred ?? []).reverse()) text.data = original;
  window.__centred = [];
  document.getElementById("centred-quiet")?.remove();
}

/**
 * The controls in `screenshot` whose H's don't have as many rows of pixels above them as below,
 * inside the control: what each said, its class, and the two counts. A row's ink is its
 * sharpest step from one pixel to the next: the H's stems are steep, while a gradient behind
 * them or a line across the control is not. The H's end on the last row with at least half
 * the strongest ink (their baseline is on a whole pixel, so that row is a whole one), and
 * their capitals are as many rows tall as their height rounds to.
 */
export function offCentre(screenshot, measured) {
  const image = decodePng(screenshot);
  const difference = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  const found = [];
  for (const control of measured) {
    const top = Math.round(control.top * control.scale);
    const bottom = Math.round(control.bottom * control.scale);
    const left = Math.ceil(control.left * control.scale) + 1;
    const right = Math.floor(control.right * control.scale) - 1;
    if (right - left < 3 || bottom - top < 6 || bottom > image.height || right > image.width) continue;
    const ink = [];
    for (let y = top; y < bottom; y++) {
      let sharpest = 0;
      for (let x = left + 1; x < right; x++) sharpest = Math.max(sharpest, difference(image.at(x, y), image.at(x - 1, y)));
      ink.push(sharpest);
    }
    const full = Math.max(...ink);
    if (full < 90) continue;
    const last = ink.length - 1 - [...ink].reverse().findIndex((value) => value >= full / 2);
    const letters = Math.round(control.cap * control.scale);
    const below = ink.length - 1 - last;
    const above = ink.length - below - letters;
    if (above !== below) found.push({ name: control.name, classes: control.classes, above, below, height: ink.length, letters });
  }
  return found;
}

/** `found` in a few words each: `.tool-button "Fetch": 9 above, 8 below (9 of 26)`. */
export function describeOffCentre(found) {
  return found.map((item) => `.${item.classes} "${item.name}": ${item.above} above, ${item.below} below (${item.letters} of ${item.height})`);
}

export { CONTROLS, EXCEPT };
