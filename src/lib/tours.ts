// Guided tours: short walks through the app that point at the real thing, one topic at a
// time. Getting started runs the first time someone new opens a repository; the others are
// offered once, when you first reach their features, and Help → Tours has them all.

export type TourId = "start" | "team" | "lfs" | "safety" | "simple";

/** What a stop needs on screen first. */
export type TourPrep = "sidebar";

export interface TourStop {
  /** What it points at (a `data-tour` name), or null for a stop about something not on screen. */
  target: string | null;
  title: string;
  text: string;
  /** Skipped when its target isn't there (otherwise it's shown in the middle). */
  optional?: boolean;
  prepare?: TourPrep;
}

export interface Tour {
  id: TourId;
  title: string;
  /** What it covers, for Help → Tours and its offer. */
  summary: string;
  stops: TourStop[];
}

export const TOURS: Tour[] = [
  {
    id: "start",
    title: "Getting started",
    summary: "The graph, your changes, and sending them to the team",
    stops: [
      {
        target: "graph",
        title: "The graph",
        text: "Every branch and commit, newest at the top. Click a commit to see what it changed; right-click it for what you can do with it.",
      },
      {
        target: "current-branch",
        optional: true,
        title: "Your branch",
        text: "The branch you're on glows. Double-click another branch's label to switch to it, or drag one onto another to merge or rebase.",
      },
      {
        target: "changes",
        optional: true,
        title: "Your changes",
        text: "Files you've changed but not committed. Click here to pick what goes in, write what you did, and commit.",
      },
      {
        target: "remote",
        title: "Fetch, Pull and Push",
        text: "Fetch checks what the team has sent, Pull brings it into your branch, and Push sends your commits. The numbers say how many are waiting.",
      },
      {
        target: "section-branches",
        optional: true,
        prepare: "sidebar",
        title: "Branches, and more",
        text: "Your branches, the remote's, tags, stashes and locked files. Click one to find it in the graph.",
      },
      {
        target: null,
        title: "Everything, from the keyboard",
        text: "Ctrl+K (⌘K on a Mac) opens the command palette: every command and branch, by typing a few letters. Help → Tours has the other tours, any time.",
      },
    ],
  },
  {
    id: "team",
    title: "Working with a team",
    summary: "Who's working on what, locks, and sharing unfinished work",
    stops: [
      {
        target: "team",
        title: "Team activity",
        text: "Who's been working on what lately: everyone's days, the files changed most, the branches being worked on, and who holds which locks.",
      },
      {
        target: "section-locks",
        optional: true,
        prepare: "sidebar",
        title: "Locked files",
        text: "Files someone's working on, so nobody else changes them at the same time. Right-click one of yours to lock it, or to let go of your lock.",
      },
      {
        target: "elsewhere",
        optional: true,
        title: "Also changed elsewhere",
        text: "Files you're changing that someone changed on another branch too. Click to see who: better to talk before you both spend a day on it.",
      },
      {
        target: "menu-repository",
        title: "Shelves",
        text: "Repository → Shelves shares unfinished work without a branch, for a review or a second pair of eyes. Anyone can open a shelf into their own copy.",
      },
      {
        target: null,
        title: "Fetch latest overnight",
        text: "Settings → Fetching → Fetch latest can fetch every open repository at a set time and move each branch forward when it can without merging, Git LFS files and all, so a big update is waiting in the morning.",
      },
    ],
  },
  {
    id: "lfs",
    title: "Big files and Git LFS",
    summary: "Art, audio and video without slowing everyone down",
    stops: [
      {
        target: "lfs-bar",
        optional: true,
        title: "Files not downloaded yet",
        text: "Files stored with Git LFS that are still small stand-ins: Download them gets the real ones.",
      },
      {
        target: "changes",
        optional: true,
        title: "Big files are flagged",
        text: "Big files that aren't stored with Git LFS are flagged before you commit them, with a button to store them there from now on.",
      },
      {
        target: "menu-repository",
        title: "Check the project's setup",
        text: "Repository → Tools → Check Project Setup looks over how an Unreal or Unity project is set up for git (what's ignored, what Git LFS stores, what's lockable) with a fix for each problem.",
      },
      {
        target: "menu-repository",
        title: "What makes it big",
        text: "Repository → Tools → What Makes It Big shows the biggest files in all of the history, and can move them into Git LFS.",
      },
      {
        target: null,
        title: "Room on the disk",
        text: "Before downloading Git LFS files, Tributary checks they'll fit, and says so instead of stopping halfway.",
      },
    ],
  },
  {
    id: "safety",
    title: "Safety nets",
    summary: "Undo, your actions, and getting lost work back",
    stops: [
      {
        target: null,
        title: "Undo",
        text: "After most things you do, the message at the bottom of the window has Undo: a commit, a checkout, a merge, a deleted branch.",
      },
      {
        target: "activity",
        title: "Your actions",
        text: "Activity → Your actions lists what you did here, each with Undo for as long as it's safe, and every git command Tributary ran.",
      },
      {
        target: "menu-repository",
        title: "Local history",
        text: "Your uncommitted work is kept every few minutes. Repository → Local History puts files back as they were.",
      },
      {
        target: "menu-repository",
        title: "Branches are backed up",
        text: "Branches Tributary deletes, rewrites or force-pushes are kept for 30 days: Repository → Branches → Restore Branch puts them back, and History → Recover Commits finds lost ones.",
      },
    ],
  },
  {
    id: "simple",
    title: "Simple mode",
    summary: "Get latest, submit your changes, and see the team",
    stops: [
      {
        target: "simple-changes",
        title: "My changes",
        text: "Tick the files to send, say what you changed, and Submit: they're committed and sent to the team in one go. Lock a file so nobody else changes it meanwhile.",
      },
      {
        target: "simple-latest",
        title: "Get latest",
        text: "How many updates the team has sent, and from whom. One button brings them in, Git LFS files and all.",
      },
      {
        target: "simple-team",
        title: "The team",
        text: "Who's working on which locked files, and what's been done lately.",
      },
      {
        target: "simple-header",
        title: "Shelves, history and the full view",
        text: "Share unfinished work on a shelf, put files back from your local history, or switch to the full view, with branches and the graph.",
      },
    ],
  },
];

export const tourById = (id: TourId): Tour => TOURS.find((tour) => tour.id === id) ?? TOURS[0];

/** The stops to show: optional ones only when what they point at is there. */
export function shownStops(tour: Tour, present: (target: string) => boolean): TourStop[] {
  return tour.stops.filter((stop) => !stop.optional || (stop.target !== null && present(stop.target)));
}

/** What's known about the open repository, to offer the tours that fit. */
export interface TourFacts {
  /** In Simple mode (its own tour), or the full view. */
  simple: boolean;
  /** How many people committed lately. */
  people: number;
  /** Whether it uses Git LFS, or its locks. */
  usesLfs: boolean;
  /** How many things you've done here. */
  actions: number;
}

/**
 * The tour to offer now: the first that fits and hasn't been offered or taken. Getting
 * started first; in Simple mode, only its own.
 */
export function tourToOffer(facts: TourFacts, seen: TourId[]): TourId | null {
  const fits: [TourId, boolean][] = facts.simple
    ? [["simple", true]]
    : [
        ["start", true],
        ["team", facts.people >= 2],
        ["lfs", facts.usesLfs],
        ["safety", facts.actions >= 1],
      ];
  return fits.find(([id, fit]) => fit && !seen.includes(id))?.[0] ?? null;
}
