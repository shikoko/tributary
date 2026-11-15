// What doesn't fit the window: text over other text, text cut off without an ellipsis, and
// windows inside the window (dialogs, menus, popovers) running past its edges. Run in the page.

/** Problems on screen now, each as a short description. */
export function crowded() {
  const problems = [];
  const name = (element) => {
    const classes = [...element.classList].slice(0, 2).join(".");
    const text = (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 32);
    return `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ""}${text ? ` "${text}"` : ""}`;
  };
  const visible = (element) => {
    for (let at = element; at; at = at.parentElement) {
      const style = getComputedStyle(at);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    }
    // Nor a pixel's worth: text kept for screen readers only.
    const box = element.getBoundingClientRect();
    return box.width > 1 && box.height > 1;
  };
  // Where an element is really seen: inside its own box if it clips, and every ancestor that does.
  const shown = (element, box) => {
    let { left, top, right, bottom } = box;
    for (let at = element; at && at !== document.body; at = at.parentElement) {
      const style = getComputedStyle(at);
      if (style.overflowX !== "visible" || style.overflowY !== "visible") {
        const clip = at.getBoundingClientRect();
        if (style.overflowX !== "visible") (left = Math.max(left, clip.left)), (right = Math.min(right, clip.right));
        if (style.overflowY !== "visible") (top = Math.max(top, clip.top)), (bottom = Math.min(bottom, clip.bottom));
      }
    }
    return right - left > 1 && bottom - top > 1 ? { left, top, right, bottom } : null;
  };

  // Text under something drawn over it with a background of its own, like a view over the
  // commit list: hidden, not crowded.
  const covered = (element, box) => {
    const top = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2);
    if (!top || element.contains(top) || top.contains(element)) return false;
    for (let at = top; at && !at.contains(element); at = at.parentElement) {
      const background = getComputedStyle(at).backgroundColor;
      if (background && background !== "transparent" && !/rgba\(.*,\s*0\)$/.test(background)) return true;
    }
    return false;
  };

  // The page itself scrolling sideways.
  if (document.documentElement.scrollWidth > innerWidth + 1) problems.push(`the page is ${document.documentElement.scrollWidth - innerWidth}px wider than the window`);

  // Windows inside the window past its edges, out of reach: not inside something that scrolls.
  const scrolls = (element) => {
    for (let at = element.parentElement; at; at = at.parentElement) {
      if (/auto|scroll/.test(getComputedStyle(at).overflowY) && at.scrollHeight > at.clientHeight + 1) return true;
    }
    return false;
  };
  for (const element of document.querySelectorAll(".dialog, [role=dialog], [role=menu], .menu, .popover, .hover-card, .toast")) {
    if (!visible(element) || scrolls(element)) continue;
    const box = element.getBoundingClientRect();
    const past = [box.left < -1 && "left", box.top < -1 && "top", box.right > innerWidth + 1 && "right", box.bottom > innerHeight + 1 && "bottom"].filter(Boolean);
    if (past.length) problems.push(`${name(element)} runs past the window's ${past.join(" and ")}`);
  }

  // Each run of text, where it's drawn and seen.
  const texts = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (node) => (node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node.parentElement;
    if (!element || element.closest("script, style, [aria-hidden=true], .sr-only, .visually-hidden") || !visible(element)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (rect.width < 2 || rect.height < 2) continue;
      const seen = shown(element, rect);
      if (seen && !covered(element, seen)) texts.push({ element, seen, layer: element.closest(".dialog, [role=dialog], [role=menu], .menu, .popover, .hover-card, .toast, .tooltip, [role=tooltip]") });
    }
  }

  // Text cut off at its box's edge, without an ellipsis to say so (and not sliding along).
  const cut = new Set();
  for (const { element } of texts) {
    if (cut.has(element)) continue;
    const style = getComputedStyle(element);
    const clips = style.overflowX === "hidden" || style.overflowX === "clip";
    if (clips && element.scrollWidth > element.clientWidth + 1 && style.textOverflow !== "ellipsis" && !element.closest(".sliding-text, [data-slides]")) {
      cut.add(element);
      problems.push(`${name(element)} is cut off (${element.scrollWidth - element.clientWidth}px) without an ellipsis`);
    }
  }

  // Text over other text, on the same layer (a menu over the list is meant to be).
  const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 3;
  const reported = new Set();
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const [a, b] = [texts[i], texts[j]];
      if (a.element === b.element || a.layer !== b.layer || a.element.contains(b.element) || b.element.contains(a.element)) continue;
      if (!overlap(a.seen, b.seen)) continue;
      const key = `${name(a.element)} | ${name(b.element)}`;
      if (reported.has(key)) continue;
      reported.add(key);
      problems.push(`${name(a.element)} overlaps ${name(b.element)}`);
    }
  }
  return problems;
}
