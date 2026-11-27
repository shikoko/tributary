import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { pullRequests, repoSummary, type PullRequest, type RepoSummary } from "../api";
import { shortcutLabel } from "../app/appCommand";
import { useThemeColors } from "../app/useAppearance";
import type { RunAll, WorkspacesHandle } from "../app/useWorkspaces";
import { compactTime, plural } from "../lib/format";
import { requestNumber } from "../lib/pullRequests";
import { tabsOf, WORKSPACE_COLORS, type Workspace } from "../lib/workspaces";
import { hang, hangsFrom, JOINT_GAP, snap, type Box } from "../lib/joint";
import { BranchIcon, CheckIcon, ChevronDownIcon, PencilIcon, PlusIcon, SearchIcon, SpinnerIcon, TrashIcon, WorkspacesIcon } from "./Icons";
import { cornerOf, Joint, jointCorners, useJoinedButton } from "./Joint";
import type { Tab } from "./TabBar";
import { Button } from "./ui/Button";
import { Chip } from "./ui/Chip";

interface Props {
  workspaces: WorkspacesHandle;
  /** The open workspace's tabs, and the repository open in it. */
  tabs: Tab[];
  openPath: string | null;
  /** What background fetches found, by repository: a dot where there's news. */
  news: Record<string, string>;
}

interface SwitcherProps extends Props {
  /** Whether every workspace shows, under the button (the palette opens it too). */
  open: boolean;
  setOpen: (open: boolean) => void;
}

/** Ctrl+Alt+1… (⌘⌥1 on a Mac): the first nine workspaces. */
export const workspaceKeys = (index: number) => (index < 9 ? `CmdOrCtrl+Alt+${index + 1}` : undefined);

/** Where each repository stands, asked for each on its own while the overview is open, and again after a Fetch all or Pull all. */
function useSummaries(paths: string[], open: boolean, ran: number): Map<string, RepoSummary> {
  const [summaries, setSummaries] = useState<Map<string, RepoSummary>>(() => new Map());
  const key = paths.join("\n");
  useEffect(() => {
    if (!open || !key) return;
    let current = true;
    for (const path of key.split("\n")) {
      repoSummary(path)
        .then((summary) => current && setSummaries((known) => new Map(known).set(path, summary)))
        .catch(() => {});
    }
    return () => {
      current = false;
    };
  }, [key, open, ran]);
  return summaries;
}

/** The open pull request for each repository's branch (asked for once each time the overview opens; none where there's no GitHub or GitLab). */
function useRequests(paths: string[], open: boolean): Map<string, PullRequest[]> {
  const [lists, setLists] = useState<Map<string, PullRequest[]>>(() => new Map());
  const key = paths.join("\n");
  useEffect(() => {
    if (!open || !key) return;
    let current = true;
    for (const path of key.split("\n")) {
      pullRequests(path)
        .then((list) => current && setLists((known) => new Map(known).set(path, list)))
        .catch(() => {});
    }
    return () => {
      current = false;
    };
  }, [key, open]);
  return lists;
}

/** Its branch's open pull request, by the branch it pushes to ("origin/feature"). */
const requestFor = (summary: RepoSummary | undefined, list: PullRequest[] | undefined) =>
  summary?.upstream ? list?.find((request) => `${request.remote}/${request.branch}` === summary.upstream) : undefined;

/** How a repository stands, in chips: conflicts, changes, ahead and behind, and its pull request. */
function StateChips({ summary, request, short }: { summary: RepoSummary | undefined; request?: PullRequest; short?: boolean }) {
  if (!summary) return null;
  if (!summary.found) return <Chip className="recent-chip missing">Folder not found</Chip>;
  const changes = summary.changes - summary.conflicts;
  return (
    <>
      {summary.conflicts > 0 && <Chip className="recent-chip conflicts">{short ? `${summary.conflicts}!` : plural(summary.conflicts, "conflict")}</Chip>}
      {changes > 0 && (
        <Chip className="recent-chip changes" title={`${plural(summary.changes, "file")} with uncommitted changes`}>
          {short ? `~${changes}` : plural(changes, "change")}
        </Chip>
      )}
      {(summary.ahead > 0 || summary.behind > 0) && (
        <Chip className="recent-chip sync" title={`${summary.ahead} to push, ${summary.behind} to pull (as of the last fetch) on ${summary.upstream}`}>
          {summary.ahead > 0 && <span>↑{summary.ahead}</span>}
          {summary.behind > 0 && <span>↓{summary.behind}</span>}
        </Chip>
      )}
      {request && (
        <Chip className="recent-chip request" title={`${request.title}${request.draft ? " (draft)" : ""}`}>
          {requestNumber(request)}
        </Chip>
      )}
    </>
  );
}

/** A colour square: a workspace's. */
const Swatch = ({ color }: { color: string }) => <span className="workspace-swatch" style={{ background: color }} aria-hidden />;

/**
 * Workspaces, at the start of the tab bar: the open one's name (an icon while there's only
 * one), which opens every workspace at a glance. The workspaces are listed on the left, the
 * open one ticked; the one picked shows on the right: its repositories, each with its branch,
 * how it stands and when it was last fetched, fetched or pulled all at once, and, for another
 * workspace, the way to switch to it (Ctrl+Alt+1… too).
 */
export function WorkspaceSwitcher({ workspaces, tabs, openPath, news, open, setOpen }: SwitcherProps) {
  const { state, current } = workspaces;
  const lanes = useThemeColors().lanes;
  const colorOf = (workspace: Workspace) => lanes[workspace.color % lanes.length];
  const button = useRef<HTMLButtonElement>(null);
  const single = state.list.length === 1;
  // News somewhere you can't see it: a dot on the button.
  const elsewhere = state.list.some((each) => each.id !== state.current && each.tabs.some((tab) => news[tab.path]));
  const label = single ? "Your repositories" : `Workspace: ${current.name}`;
  return (
    <>
      <button
        ref={button}
        className={`workspace-switch${single ? " single" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={single ? "Your repositories at a glance, and workspaces to group them" : `${current.name}: every workspace at a glance`}
        onClick={() => setOpen(!open)}
      >
        {single ? <WorkspacesIcon size={14} /> : <Swatch color={colorOf(current)} />}
        {!single && <span className="button-label">{current.name}</span>}
        {!single && <ChevronDownIcon size={12} />}
        {elsewhere && <span className="workspace-news" aria-label="New commits in another workspace" />}
      </button>
      {open && <Overview workspaces={workspaces} tabs={tabs} openPath={openPath} news={news} anchor={button} colorOf={colorOf} lanes={lanes} onClose={() => setOpen(false)} />}
    </>
  );
}

interface OverviewProps extends Props {
  anchor: React.RefObject<HTMLButtonElement | null>;
  colorOf: (workspace: Workspace) => string;
  lanes: string[];
  onClose: () => void;
}

function Overview({ workspaces, tabs, openPath, news, anchor, colorOf, lanes, onClose }: OverviewProps) {
  const { state, running, ran } = workspaces;
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<CSSProperties>({ visibility: "hidden" });
  /** Its button, which it hangs from, joined to it. */
  const [button, setButton] = useState<{ box: Box; radius: number } | null>(null);
  const [query, setQuery] = useState("");
  /** The workspace shown on the right: the open one, until another is picked. */
  const [picked, setPicked] = useState(state.current);
  /** Making a workspace, or changing them, in the panel itself. */
  const [mode, setMode] = useState<"list" | "new" | "edit">("list");
  const [name, setName] = useState("");
  const [color, setColor] = useState(() => workspaces.freeColor());
  const everyone = useMemo(() => state.list.map((workspace) => ({ workspace, tabs: tabsOf(state, workspace.id, tabs) })), [state, tabs]);
  const paths = [...new Set(everyone.flatMap((each) => each.tabs.map((tab) => tab.path)))];
  const summaries = useSummaries(paths, true, ran);
  const requests = useRequests(
    tabs.map((tab) => tab.path),
    true,
  );

  // Hanging from its button, joined to it, inside the window, no taller than the room under
  // it; placed again when the window is resized.
  useLayoutEffect(() => {
    const placeIt = () => {
      if (!anchor.current) return;
      const width = Math.min(760, window.innerWidth - 16);
      const box = snap(anchor.current.getBoundingClientRect());
      const left = hang(box, width, window.innerWidth, "left", 8);
      const top = box.bottom + JOINT_GAP;
      setPlace({ left, top, width, maxHeight: window.innerHeight - top - 8 });
      setButton({ box, radius: cornerOf(anchor.current) });
    };
    placeIt();
    window.addEventListener("resize", placeIt);
    return () => window.removeEventListener("resize", placeIt);
  }, [anchor]);
  // The focus goes to the search, and back to the button when it closes.
  useEffect(() => {
    const before = anchor.current;
    panel.current?.querySelector<HTMLElement>("input")?.focus();
    return () => before?.focus();
  }, [anchor]);
  // A click outside, or Esc, closes it (Esc first leaves making or changing workspaces).
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !anchor.current?.contains(target)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (mode !== "list") setMode("list");
      else onClose();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose, anchor, mode]);

  const go = (run: () => void) => {
    run();
    onClose();
  };
  const fetched = (path: string) => {
    const at = summaries.get(path)?.lastFetched;
    return at ? `fetched ${compactTime(at)}` : "never fetched";
  };
  const runButton = (workspace: Workspace, what: RunAll, label: string, count: number) => (
    <Button
      kind="secondary"
      size="small"
      disabled={running.has(workspace.id) || count === 0}
      onClick={() => void workspaces.runAll(workspace.id, what)}
      title={what === "fetch" ? `Fetch every repository in ${workspace.name}` : `Fetch every repository in ${workspace.name}, and move each branch forward where it can be without merging`}
    >
      {label}
    </Button>
  );

  /** A repository: opened (in its workspace, switching to it) when clicked. Search results say which workspace with its colour. */
  const repoRow = (tab: Tab, workspace: Workspace, found = false) => {
    const summary = summaries.get(tab.path);
    const here = workspace.id === state.current;
    return (
      <li key={`${workspace.id}:${tab.path}`}>
        <button
          className={`workspace-row${here && tab.path === openPath ? " open" : ""}`}
          onClick={() => go(() => workspaces.openRepository(tab.path))}
          title={here ? tab.path : `${tab.path}: switch to ${workspace.name} and open it`}
        >
          {found && <Swatch color={colorOf(workspace)} />}
          <span className="workspace-row-name">
            {tab.name}
            {news[tab.path] && <span className="tab-news" aria-label="New commits" />}
          </span>
          <span className="workspace-row-branch">
            {summary?.found && (
              <>
                <BranchIcon size={11} />
                <span>{summary.branch ?? "detached"}</span>
              </>
            )}
          </span>
          <span className="workspace-row-state">
            <StateChips summary={summary} request={here ? requestFor(summary, requests.get(tab.path)) : undefined} />
          </span>
          <span className="workspace-row-when">{summary?.found ? fetched(tab.path) : ""}</span>
        </button>
      </li>
    );
  };

  /** Making a workspace, and renaming or recolouring them. */
  const newAndEdit = (
    <>
      <Button
        kind="link"
        onClick={() => {
          setName("");
          setColor(workspaces.freeColor());
          setMode("new");
        }}
      >
        <PlusIcon size={13} />
        <span className="button-label">New workspace…</span>
      </Button>
      <Button kind="link" onClick={() => setMode("edit")}>
        <PencilIcon size={13} />
        <span className="button-label">{state.list.length === 1 ? "Rename…" : "Edit workspaces…"}</span>
      </Button>
    </>
  );

  /** One workspace: its name, its repositories, fetching or pulling them all, and switching to it. */
  const details = ({ workspace, tabs: list }: (typeof everyone)[number], index: number) => {
    const here = workspace.id === state.current;
    const keys = workspaceKeys(index);
    return (
      <section className="workspace-details" aria-label={workspace.name}>
        <header>
          <Swatch color={colorOf(workspace)} />
          <h3>{workspace.name}</h3>
          <span className="workspace-count">
            {plural(list.length, "repository", "repositories")}
            {here && state.list.length > 1 ? " · new tabs open here" : ""}
          </span>
          <span className="workspace-actions">
            {running.has(workspace.id) && <SpinnerIcon size={14} />}
            {runButton(workspace, "fetch", "Fetch all", list.length)}
            {here ? (
              runButton(workspace, "pull", "Pull all", list.length)
            ) : (
              <Button kind="primary" onClick={() => go(() => workspaces.switchWorkspace(workspace.id))}>
                Switch to {workspace.name}
              </Button>
            )}
          </span>
        </header>
        {list.length > 0 ? (
          <ul className="workspace-rows">{list.map((tab) => repoRow(tab, workspace))}</ul>
        ) : (
          <p className="workspace-empty">{here ? "No repositories here yet: open one with + in the tab bar." : "No repositories yet: switch to it, and open them there."}</p>
        )}
        {keys && state.list.length > 1 && (
          <p className="workspace-keys-hint">
            <kbd className="workspace-keys">{shortcutLabel(keys)}</kbd> {here ? "comes back here" : `switches to ${workspace.name}`} from anywhere
          </p>
        )}
      </section>
    );
  };

  /** The workspaces, on the left: the one shown on the right picked, the open one ticked. Up and down pick another. */
  const nav = (
    <nav className="workspace-nav" aria-label="Workspaces">
      <h2>Workspaces</h2>
      <div
        className="workspace-tabs"
        role="tablist"
        aria-orientation="vertical"
        aria-label="Workspaces"
        onKeyDown={(event) => {
        const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
        if (!step) return;
        event.preventDefault();
        const at = state.list.findIndex((workspace) => workspace.id === picked);
        const next = state.list[(at + step + state.list.length) % state.list.length];
        setPicked(next.id);
        panel.current?.querySelector<HTMLElement>(`[data-workspace="${next.id}"]`)?.focus();
      }}
      >
      {everyone.map(({ workspace, tabs: list }) => {
        const here = workspace.id === state.current;
        const shown = workspace.id === picked;
        return (
          <button
            key={workspace.id}
            role="tab"
            aria-selected={shown}
            tabIndex={shown ? 0 : -1}
            data-workspace={workspace.id}
            className={`workspace-nav-item${shown ? " picked" : ""}`}
            onClick={() => setPicked(workspace.id)}
            onDoubleClick={() => !here && go(() => workspaces.switchWorkspace(workspace.id))}
            title={here ? `${workspace.name}: the workspace you're in` : `${workspace.name}: its repositories (double-click to switch to it)`}
          >
            <Swatch color={colorOf(workspace)} />
            <span className="button-label workspace-nav-name">{workspace.name}</span>
            {list.some((tab) => news[tab.path]) && <span className="tab-news" aria-label="New commits" />}
            {here ? <CheckIcon size={13} className="workspace-nav-here" aria-label="The workspace you're in" /> : <span className="button-label workspace-nav-count">{list.length}</span>}
          </button>
        );
      })}
      </div>
      <div className="workspace-nav-foot">{newAndEdit}</div>
    </nav>
  );

  const swatches = (value: number, onPick: (color: number) => void, label: string) => (
    <div className="workspace-swatches" role="radiogroup" aria-label={label}>
      {Array.from({ length: Math.min(WORKSPACE_COLORS, lanes.length) }, (_, index) => (
        <button key={index} type="button" role="radio" aria-checked={value === index} aria-label={`Colour ${index + 1}`} className={value === index ? "on" : undefined} style={{ background: lanes[index] }} onClick={() => onPick(index)}>
          {value === index && <CheckIcon size={10} />}
        </button>
      ))}
    </div>
  );

  const needle = query.trim().toLowerCase();
  const found = needle
    ? everyone.flatMap(({ workspace, tabs: list }) => list.filter((tab) => tab.name.toLowerCase().includes(needle) || tab.path.toLowerCase().includes(needle)).map((tab) => ({ tab, workspace })))
    : [];
  const offer = workspaces.groupOffer;
  const single = state.list.length === 1;
  // The workspace picked, or the open one if the one picked was removed.
  const pickedAt = everyone.findIndex(({ workspace }) => workspace.id === picked);
  const shownIndex = pickedAt >= 0 ? pickedAt : Math.max(0, everyone.findIndex(({ workspace }) => workspace.id === state.current));
  const shown = everyone[shownIndex];

  const at = { left: Number(place.left ?? 0), top: Number(place.top ?? 0), width: Number(place.width ?? 0) };
  useJoinedButton(anchor, "panel", button !== null && hangsFrom(button.box, at.top));
  return (
    <>
      <div ref={panel} className="workspace-panel" style={{ ...place, ...jointCorners(button?.box ?? null, at) }} role="dialog" aria-label={state.list.length === 1 ? "Your repositories" : "Workspaces"}>
        {mode === "list" && (
          <div className={`workspace-panes${single ? " single" : ""}`}>
            {!single && nav}
            <div className="workspace-main" role={single ? undefined : "tabpanel"} aria-label={single ? undefined : shown.workspace.name}>
              <label className="workspace-search">
                <SearchIcon size={13} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a repository…" aria-label="Find a repository" />
              </label>
              {needle ? (
                found.length > 0 ? (
                  <ul className="workspace-rows">{found.map(({ tab, workspace }) => repoRow(tab, workspace, true))}</ul>
                ) : (
                  <p className="workspace-empty">No open repository is called that.</p>
                )
              ) : (
                details(shown, shownIndex)
              )}
              {!needle && offer && (
                <div className="workspace-offer">
                  <span>
                    Make a workspace for each folder:{" "}
                    {offer.groups.map((group) => `${group.name} (${group.tabs.length})`).join(", ")}
                    {offer.rest.length > 0 && `, and keep ${plural(offer.rest.length, "other")} here`}.
                  </span>
                  <Button kind="secondary" size="small" onClick={workspaces.group}>
                    Make them
                  </Button>
                </div>
              )}
              {single && <footer className="workspace-foot">{newAndEdit}</footer>}
            </div>
          </div>
        )}
        {mode === "new" && (
          <form
            className="workspace-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) return;
              go(() => workspaces.create(name, color));
            }}
          >
            <h2>New workspace</h2>
            <p className="hint">A set of tabs of its own: it opens empty, for the repositories you open in it. The tabs open now stay in {workspaces.current.name}.</p>
            <label className="workspace-field">
              <span>Name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Like Game, or Website" autoFocus />
            </label>
            {swatches(color, setColor, "Its colour")}
            <div className="workspace-form-buttons">
              <Button kind="secondary" type="button" onClick={() => setMode("list")}>
                Cancel
              </Button>
              <Button kind="primary" type="submit" disabled={!name.trim()}>
                Create and switch
              </Button>
            </div>
          </form>
        )}
        {mode === "edit" && (
          <div className="workspace-form">
            <h2>{state.list.length === 1 ? "Rename" : "Edit workspaces"}</h2>
            <ul className="workspace-edit">
              {state.list.map((workspace) => (
                <li key={workspace.id}>
                  <input
                    defaultValue={workspace.name}
                    aria-label={`${workspace.name}'s name`}
                    onBlur={(event) => workspaces.edit(workspace.id, { name: event.target.value })}
                    onKeyDown={(event) => event.key === "Enter" && workspaces.edit(workspace.id, { name: event.currentTarget.value })}
                  />
                  {swatches(workspace.color, (pick) => workspaces.edit(workspace.id, { color: pick }), `${workspace.name}'s colour`)}
                  {state.list.length > 1 && (
                    <Button
                      kind="icon"
                      disabled={workspace.id === state.current}
                      onClick={() => workspaces.remove(workspace.id)}
                      title={workspace.id === state.current ? "The open workspace can't be removed: switch to another first" : `Remove ${workspace.name}: its tabs join ${workspaces.current.name}`}
                      aria-label={`Remove ${workspace.name}`}
                    >
                      <TrashIcon size={14} />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <div className="workspace-form-buttons">
              <Button kind="primary" onClick={() => setMode("list")}>
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
      {button && <Joint button={button.box} radius={button.radius} panel={at} fill="panel" />}
    </>
  );
}
