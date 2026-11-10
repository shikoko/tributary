// Tributary's setup window: agree to the terms, choose where it goes (or not), install,
// then open it. Four steps, drawn again from `state` whenever something changes.
import "@fontsource-variable/google-sans";
import "./setup.css";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import termsText from "../../../TERMS.txt?raw";

interface Info {
  version: string;
  folder: string;
  installed: { folder: string; version: string | null } | null;
  size: number;
}

interface FolderCheck {
  ok: boolean;
  problem: string | null;
}

type Step = "loading" | "welcome" | "installing" | "ready" | "failed";

const state = {
  step: "loading" as Step,
  info: null as Info | null,
  folder: "",
  check: { ok: true, problem: null } as FolderCheck,
  agreed: false,
  /** The terms are open over the window. */
  reading: false,
  /** Why Install can't go ahead yet (Tributary is open). */
  notice: null as string | null,
  error: null as string | null,
  percent: 0,
  shortcut: false,
};

const root = document.getElementById("setup") as HTMLElement;
const appWindow = getCurrentWindow();

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const LANES: [number, string][] = [
  [200, "#1fb5ff"],
  [356, "#ff4f9a"],
  [512, "#ffad1f"],
  [668, "#2fd38a"],
  [824, "#8f6bff"],
];
const TILE = "M924 512C924 922 922 924 512 924C102 924 100 922 100 512C100 102 102 100 512 100C922 100 924 102 924 512Z";

/** The app icon, as Tributary draws it. */
function logo(size: number): string {
  const lanes = [0, 4, 1, 3, 2]
    .map((i) => `<path d="M${LANES[i][0]} 20V320C${LANES[i][0]} 520 512 510 512 690" stroke="${LANES[i][1]}" stroke-width="86"/>`)
    .join("");
  return `<svg class="logo" width="${size}" height="${size}" viewBox="100 100 824 824" aria-hidden="true">
    <defs>
      <linearGradient id="tile" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="#1c2333"/><stop offset="1" stop-color="#0b0e14"/></linearGradient>
      <clipPath id="clip"><path d="${TILE}"/></clipPath>
    </defs>
    <path d="${TILE}" fill="url(#tile)"/>
    <g clip-path="url(#clip)">
      <path d="M450 690L418 1060H606L574 690Z" fill="#fff"/>
      <g fill="none" stroke-linecap="round">${lanes}</g>
      <circle cx="512" cy="690" r="92" fill="#fff"/>
      <circle cx="512" cy="690" r="36" fill="#141a26"/>
    </g>
    <path d="${TILE}" fill="none" stroke="rgb(255 255 255 / 0.12)" stroke-width="5"/>
  </svg>`;
}

const WARNING = `<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5L15 14H1Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 6v3.6M8 11.6v.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;

/** The terms as paragraphs; a numbered one starts with its point in bold. */
function terms(): string {
  return termsText
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph, index) => {
      const text = escape(paragraph.replace(/\s*\n\s*/g, " "));
      if (index === 0) return "";
      if (text === "The MIT licence") return `<h4>${text}</h4>`;
      const point = text.match(/^(\d+\.\s+[^.]+\.)(.*)$/);
      return point ? `<p><b>${point[1]}</b>${point[2]}</p>` : `<p>${text}</p>`;
    })
    .join("");
}

/** Which kind of install this is, in words. */
function heading(): { title: string; tag: string; doing: string; done: string } {
  const info = state.info;
  const installed = info?.installed;
  if (installed?.version && info && installed.version !== info.version && info.version !== "dev") {
    return {
      title: "Update Tributary",
      tag: `Version ${escape(installed.version)} is installed. This installs ${escape(info.version)}.`,
      doing: "Updating Tributary",
      done: "Tributary is up to date",
    };
  }
  if (installed) {
    return { title: "Reinstall Tributary", tag: "It's installed already: this installs it again.", doing: "Installing Tributary", done: "Tributary is ready" };
  }
  return { title: "Install Tributary", tag: "A fast, friendly git client.", doing: "Installing Tributary", done: "Tributary is ready" };
}

function footer(): string {
  const folder = `<code title="${escape(state.folder)}">${escape(state.folder)}</code>`;
  if (state.notice) return `<div class="where warning">${WARNING}<span>${escape(state.notice)}</span></div>`;
  if (state.info?.installed) return `<div class="where">Installed in ${folder}</div>`;
  if (state.check.problem === "admin") {
    // Even an administrator's setup runs without administrator rights: Program Files and the
    // like are for installing for everyone, which the .msi does.
    return `<div class="where-lines">
      <div class="where warning">${WARNING}<span>Needs administrator rights:</span>${folder}<button class="link" id="change">Choose another…</button></div>
      <div class="where note">This setup installs just for you. To install for everyone on this PC, use Tributary's .msi.</div>
    </div>`;
  }
  if (!state.check.ok) {
    const why = escape(state.check.problem ?? "Can't install in");
    return `<div class="where warning">${WARNING}<span>${why}</span>${folder}<button class="link" id="change">Choose another…</button></div>`;
  }
  return `<div class="where">Installs in ${folder}<button class="link" id="change">Change…</button></div>`;
}

function welcome(): string {
  const { title, tag } = heading();
  const canInstall = state.agreed && state.check.ok;
  return `
    <div class="stack" data-tauri-drag-region>
      ${logo(88)}
      <h1>${title}</h1>
      <p class="tag">${tag}</p>
      <div class="act">
        <button class="primary" id="install" ${canInstall ? "" : "disabled"}>${title.split(" ")[0]}</button>
        <label class="check">
          <input type="checkbox" id="agree" ${state.agreed ? "checked" : ""} />
          <span>I agree to the <button class="link" id="terms">terms of use</button></span>
        </label>
      </div>
    </div>
    <footer>${footer()}</footer>`;
}

function installing(): string {
  return `
    <div class="stack" data-tauri-drag-region>
      ${logo(88)}
      <h1>${heading().doing}</h1>
      <p class="tag">This takes a few seconds.</p>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(state.percent)}"><span style="width:${state.percent}%"></span></div>
    </div>`;
}

function ready(): string {
  return `
    <div class="stack" data-tauri-drag-region>
      ${logo(88)}
      <h1>${heading().done}</h1>
      <p class="tag">You'll find it in the Start menu.</p>
      <div class="act">
        <button class="primary" id="open">Open Tributary</button>
        <label class="check">
          <input type="checkbox" id="shortcut" ${state.shortcut ? "checked" : ""} />
          <span>Add a shortcut to the desktop</span>
        </label>
      </div>
    </div>`;
}

function failed(): string {
  return `
    <div class="stack" data-tauri-drag-region>
      ${logo(88)}
      <h1>Tributary couldn't be installed</h1>
      <p class="tag error">${escape(state.error ?? "Something went wrong.")}</p>
      <div class="act"><button class="primary" id="again">Try again</button></div>
    </div>`;
}

function sheet(): string {
  return `
    <div class="scrim" id="scrim"></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-label="Terms of use">
      <h2>Terms of use</h2>
      <div class="terms" tabindex="0">${terms()}</div>
      <div class="buttons">
        <button class="secondary" id="close-terms">Close</button>
        <button class="primary small" id="agree-terms">I agree</button>
      </div>
    </section>`;
}

function render() {
  const focused = document.activeElement?.id;
  const busy = state.step === "installing";
  const body =
    state.step === "welcome" ? welcome() : state.step === "installing" ? installing() : state.step === "ready" ? ready() : state.step === "failed" ? failed() : "";
  root.innerHTML = `
    <div class="drag" data-tauri-drag-region></div>
    <div class="caption">
      <button id="minimize" aria-label="Minimise"><svg viewBox="0 0 10 10"><path d="M0 5.5H10"/></svg></button>
      <button id="close" aria-label="Close" ${busy ? "disabled" : ""}><svg viewBox="0 0 10 10"><path d="M0 0L10 10M10 0L0 10"/></svg></button>
    </div>
    ${body}
    ${state.reading ? sheet() : ""}`;
  if (focused) document.getElementById(focused)?.focus();
  else if (state.reading) document.getElementById("agree-terms")?.focus();
}

function set(changes: Partial<typeof state>) {
  Object.assign(state, changes);
  render();
}

async function checkFolder(folder: string) {
  const check = await invoke<FolderCheck>("check_folder", { folder }).catch(() => ({ ok: true, problem: null }));
  set({ folder, check });
}

/** The bar fills towards 92% at about the pace the installer takes, then the rest when it's done. */
function pace(size: number): () => void {
  const expected = 2500 + (size / 8_000_000) * 1000;
  const started = performance.now();
  const timer = setInterval(() => {
    const elapsed = performance.now() - started;
    set({ percent: 92 * (1 - Math.exp((-3 * elapsed) / expected)) });
  }, 80);
  return () => clearInterval(timer);
}

async function install() {
  if (!state.agreed || !state.check.ok) return;
  if (await invoke<boolean>("running").catch(() => false)) {
    set({ notice: "Tributary is open: close it, then click Install again." });
    return;
  }
  set({ step: "installing", notice: null, percent: 0 });
  const stop = pace(state.info?.size ?? 0);
  try {
    await invoke("install", { folder: state.folder });
    stop();
    set({ percent: 100 });
    setTimeout(() => set({ step: "ready" }), 450);
  } catch (e) {
    stop();
    set({ step: "failed", error: String(e) });
  }
}

async function finish(open: boolean) {
  try {
    if (open) await invoke("open", { folder: state.folder, shortcut: state.shortcut });
    else if (state.shortcut) await invoke("add_shortcut", { folder: state.folder });
  } catch (e) {
    set({ step: "failed", error: String(e) });
    return;
  }
  await appWindow.close();
}

root.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest("button, #scrim");
  if (!target) return;
  switch (target.id) {
    case "minimize":
      void appWindow.minimize();
      break;
    case "close":
      if (state.step === "ready") void finish(false);
      else void appWindow.close();
      break;
    case "install":
      void install();
      break;
    case "terms":
      event.preventDefault();
      set({ reading: true });
      break;
    case "close-terms":
    case "scrim":
      set({ reading: false });
      break;
    case "agree-terms":
      set({ reading: false, agreed: true });
      break;
    case "change":
      void invoke<string | null>("choose_folder", { current: state.folder }).then((folder) => {
        if (folder) void checkFolder(folder);
      });
      break;
    case "open":
      void finish(true);
      break;
    case "again":
      set({ step: "welcome", error: null });
      break;
  }
});

root.addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  if (input.id === "agree") set({ agreed: input.checked });
  if (input.id === "shortcut") set({ shortcut: input.checked });
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.reading) set({ reading: false });
});

// Right-clicking shows nothing: it's a setup, not a web page.
window.addEventListener("contextmenu", (event) => event.preventDefault());

invoke<Info>("info")
  .then(async (info) => {
    state.info = info;
    await checkFolder(info.folder);
    set({ step: "welcome" });
  })
  .catch((e) => set({ step: "failed", error: String(e) }));
