/**
 * Whether `view` is the one on top of the views over the commit list (a file's changes, a
 * pull request, the team…): they're all `.diff-view`s at the same height, so the last one
 * is on top. Only that one answers the keyboard, like Esc.
 */
export function isTopView(view: Element | null): boolean {
  const views = document.querySelectorAll(".diff-view");
  return views.length > 0 && views[views.length - 1] === view;
}
