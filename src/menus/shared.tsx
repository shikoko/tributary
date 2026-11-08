// Menu items that several menus have: hiding and soloing, opening on the website, merging.
import { type RefPill } from "../lib/refs";
import { branchUrl, newPullRequestUrl, siteName, webRemote } from "../lib/weblinks";
import type { MenuItem } from "../components/ContextMenu";
import {
  EyeIcon,
  MergeIcon,
  SquashIcon,
  RebaseIcon,
  ExternalLinkIcon,
  EyeOffIcon,
  PinIcon,
  PullRequestIcon } from "../components/Icons";
import { pillRefNames, splitRemoteBranch, type MenuContext } from "./context";

/** Hide, solo and pin entries for a label. */
export function visibilityItems(ctx: MenuContext, pill: RefPill): MenuItem[] {
  const names = pillRefNames(pill);
  if (names.length === 0) return [];
  const own = names[0];
  const soloing = ctx.visibility.solo.length > 0;
  const pinned = ctx.pins.includes(own);
  return [
    {
      label: soloing ? `Also show only ${pill.name}` : `Show only ${pill.name}`,
      icon: <EyeIcon />,
      separated: true,
      disabled: names.every((name) => ctx.visibility.solo.includes(name)),
      onSelect: () => ctx.solo(names),
    },
    {
      label: `Hide ${pill.name}`,
      icon: <EyeOffIcon />,
      disabled: pill.current,
      onSelect: () => ctx.setHidden(names, true),
    },
    {
      label: pinned ? `Unpin ${pill.name}` : `Pin ${pill.name} in the sidebar`,
      icon: <PinIcon />,
      onSelect: () => ctx.togglePin(own),
    },
  ];
}

/** "Open on GitHub" and "Create pull request" for a branch, or "Open on GitHub" for a tag. */
export function webItems(ctx: MenuContext, pill: RefPill): MenuItem[] {
  const { snapshot } = ctx;
  if (pill.kind === "tag") {
    const remote = webRemote(snapshot);
    const url = remote && branchUrl(remote, pill.name);
    return url && remote ? [{ label: `Open ${pill.name} on ${siteName(remote)}`, icon: <ExternalLinkIcon />, separated: true, onSelect: () => ctx.openUrl(url) }] : [];
  }
  if (pill.kind !== "branch") return [];
  // The remote copy of the branch: the one it tracks, or one with the same name.
  let remoteName: string | undefined;
  let branch = pill.name;
  if (pill.local) {
    const upstream = snapshot.commits.flatMap((c) => c.refs).find((ref) => ref.kind === "branch" && ref.name === pill.name)?.upstream;
    if (upstream) {
      ({ remote: remoteName, branch } = splitRemoteBranch(upstream, snapshot.remotes));
    } else if (pill.remotes.length > 0) {
      remoteName = pill.remotes[0];
    }
  } else {
    ({ remote: remoteName, branch } = splitRemoteBranch(pill.name, snapshot.remotes));
  }
  if (!remoteName) return [];
  const remote = snapshot.webRemotes.find((r) => r.name === remoteName);
  if (!remote) return [];
  const site = siteName(remote);
  const items: MenuItem[] = [];
  const page = branchUrl(remote, branch);
  if (page) items.push({ label: `Open ${branch} on ${site}`, icon: <ExternalLinkIcon />, separated: true, onSelect: () => ctx.openUrl(page) });
  const pullRequest = newPullRequestUrl(remote, branch);
  if (pullRequest) {
    items.push({
      label: remote.host === "gitlab" ? "Create merge request…" : "Create pull request…",
      icon: <PullRequestIcon />,
      separated: !page,
      onSelect: () => ctx.openUrl(pullRequest),
    });
  }
  return items;
}

/** Merge and rebase entries for a branch, tag or commit, relative to the checked-out branch. */
export function mergeItems(ctx: MenuContext, revision: string, label: string): MenuItem[] {
  const branch = ctx.snapshot.headBranch;
  const disabled = !ctx.canChange || !branch || ctx.snapshot.operation !== null;
  return [
    {
      label: `Merge ${label} into ${branch ?? "HEAD"}`,
      icon: <MergeIcon />,
      separated: true,
      disabled,
      onSelect: () => ctx.run({ kind: "merge", target: revision }),
    },
    {
      label: `Merge ${label} with a merge commit`,
      icon: <MergeIcon />,
      disabled,
      onSelect: () => ctx.run({ kind: "merge", target: revision, mode: "noFastForward" }),
    },
    {
      label: `Squash ${label} into ${branch ?? "HEAD"}`,
      icon: <SquashIcon />,
      disabled,
      onSelect: () => ctx.run({ kind: "merge", target: revision, mode: "squash" }),
    },
    {
      label: `Rebase ${branch ?? "HEAD"} onto ${label}`,
      icon: <RebaseIcon />,
      disabled,
      onSelect: () => ctx.run({ kind: "rebase", onto: revision }),
    },
  ];
}

