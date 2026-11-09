// Menu items that several menus have: hiding and soloing, opening on the website, merging.
import { requestNumber } from "../lib/pullRequests";
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
import { MergeHint } from "../components/MergeHint";
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
  const upstream = pill.local ? snapshot.commits.flatMap((c) => c.refs).find((ref) => ref.kind === "branch" && ref.name === pill.name)?.upstream : undefined;
  if (pill.local) {
    if (upstream) {
      ({ remote: remoteName, branch } = splitRemoteBranch(upstream, snapshot.remotes));
    } else if (pill.remotes.length > 0) {
      remoteName = pill.remotes[0];
    } else {
      // Not pushed yet: a pull request opens it on the remote that pushing would use.
      remoteName = webRemote(snapshot)?.name;
    }
  } else {
    ({ remote: remoteName, branch } = splitRemoteBranch(pill.name, snapshot.remotes));
  }
  // The branch's own remote on a site, or else the repository's site (like a GitHub
  // remote next to an origin elsewhere), for opening pull requests.
  const own = remoteName ? snapshot.webRemotes.find((r) => r.name === remoteName) : undefined;
  const remote = own ?? webRemote(snapshot);
  if (!remote) return [];
  const items: MenuItem[] = [];
  const onRemote = !pill.local || Boolean(upstream) || pill.remotes.length > 0;
  const page = own && onRemote ? branchUrl(own, branch) : null;
  if (page) items.push({ label: `Open ${branch} on ${siteName(remote)}`, icon: <ExternalLinkIcon />, separated: true, onSelect: () => ctx.openUrl(page) });
  const existing = ctx.requests?.find(pill.name, pill.local, pill.remotes, upstream);
  const noun = remote.host === "gitlab" ? "merge request" : "pull request";
  if (existing) {
    items.push({
      label: `Show ${noun} ${requestNumber(existing)}`,
      icon: <PullRequestIcon />,
      separated: !page,
      onSelect: () => ctx.showRequest(existing),
    });
  } else if (remote.host === "github" || remote.host === "gitlab") {
    const url = newPullRequestUrl(remote, branch);
    items.push({
      label: `Create ${noun}…`,
      icon: <PullRequestIcon />,
      separated: !page,
      disabled: snapshot.bare,
      onSelect: () => ctx.open({ kind: "createPullRequest", branch, local: pill.local ? pill.name : null, url }),
    });
  }
  return items;
}

/**
 * Merge and rebase entries for a branch, tag or commit, relative to the checked-out branch,
 * saying whether they'd conflict. `targetId`: the commit `revision` is at, when known.
 */
export function mergeItems(ctx: MenuContext, revision: string, label: string, targetId?: string): MenuItem[] {
  const { snapshot } = ctx;
  const branch = snapshot.headBranch;
  const disabled = !ctx.canChange || !branch || snapshot.operation !== null;
  // Checked only where it could be done.
  const at = `${snapshot.headCommit}:${targetId ?? ""}`;
  const hint = (kind: "merge" | "rebase") => (disabled || !snapshot.headCommit ? undefined : <MergeHint repo={snapshot.path} from={revision} at={at} kind={kind} />);
  return [
    {
      label: `Merge ${label} into ${branch ?? "HEAD"}`,
      icon: <MergeIcon />,
      separated: true,
      disabled,
      detail: hint("merge"),
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
      detail: hint("rebase"),
      onSelect: () => ctx.run({ kind: "rebase", onto: revision }),
    },
  ];
}

