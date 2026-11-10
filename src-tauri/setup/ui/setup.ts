// Tributary's setup window. Agree to the terms and Install (just for you, in the usual folder),
// or Custom install: for whom, and where. Then progress, and Tributary is ready. Started by
// the updater, it's the progress of the update. Drawn again from `state` whenever it changes.
import "@fontsource-variable/google-sans";
import "./setup.css";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import termsText from "../../../TERMS.txt?raw";

interface Installed {
  folder: string;
  version: string | null;
  everyone: boolean;
}

interface Info {
  version: string;
  justMeFolder: string;
  everyoneFolder: string;
  canInstallForEveryone: boolean;
  installed: Installed | null;
  update: boolean;
  size: number;
}

interface FolderCheck {
  ok: boolean;
  problem: string | null;
}

type Step = "loading" | "welcome" | "custom" | "installing" | "ready" | "failed";

const OK: FolderCheck = { ok: true, problem: null };

const state = {
  step: "loading" as Step,
  info: null as Info | null,
  /** For everyone on the PC, rather than just you. */
  everyone: false,
  /** The folder for each, as chosen. */
  folders: { justMe: "", everyone: "" },
  check: OK,
  agreed: false,
  /** The terms are open over the window. */
  reading: false,
  /** Why Install can't go ahead yet (Tributary is open). */
  notice: null as string | null,
  error: null as string | null,
  /** Where Try again goes back to. */
  back: "welcome" as Step,
  percent: 0,
  shortcut: false,
};

const root = document.getElementById("setup") as HTMLElement;
const appWindow = getCurrentWindow();

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const folder = () => (state.everyone ? state.folders.everyone : state.folders.justMe);

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
function heading(): { title: string; button: string; tag: string; doing: string; done: string } {
  const info = state.info;
  const installed = info?.installed;
  if (info?.update) {
    return { title: "Update Tributary", button: "Update", tag: "", doing: "Updating Tributary", done: "Tributary is up to date" };
  }
  if (installed?.version && info && installed.version !== info.version && info.version !== "dev") {
    return {
      title: "Update Tributary",
      button: "Update",
      tag: `Version ${escape(installed.version)} is installed. This installs ${escape(info.version)}.`,
      doing: "Updating Tributary",
      done: "Tributary is up to date",
    };
  }
  if (installed) {
    return { title: "Reinstall Tributary", button: "Reinstall", tag: "It's installed already: this installs it again.", doing: "Installing Tributary", done: "Tributary is ready" };
  }
  return { title: "Install Tributary", button: "Install", tag: "A fast, friendly git client.", doing: "Installing Tributary", done: "Tributary is ready" };
}

const code = (path: string) => `<code title="${escape(path)}">${escape(path)}</code>`;

/** Why Install has to wait, or what's wrong with the folder; or nothing. */
function problem(): string | null {
  if (state.notice) return state.notice;
  if (state.check.problem === "admin") return "Only an administrator can install there. Choose another folder, or install for everyone.";
  if (!state.check.ok) return state.check.problem ?? "Tributary can't be installed there.";
  return null;
}

/** The problem as a line, with `extra` after it (a way out). */
function warning(extra = ""): string {
  const text = problem();
  return text ? `<div class="where warning">${WARNING}<span>${escape(text)}</span>${extra}</div>` : "";
}

function agreement(): string {
  return `<label class="check">
    <input type="checkbox" id="agree" ${state.agreed ? "checked" : ""} />
    <span>I agree to the <button class="link" id="terms">terms of use</button></span>
  </label>`;
}

const canInstall = () => state.agreed && state.check.ok;

function welcome(): string {
  const { title, button, tag } = heading();
  const installed = state.info?.installed;
  const where = installed
    ? `<div class="where">Installed ${installed.everyone ? "for everyone" : "just for you"} in ${code(installed.folder)}</div>`
    : problem()
      ? warning(state.notice ? "" : `<button class="link" id="custom">Custom install…</button>`)
      : `<div class="where">Installs just for you, in ${code(state.folders.justMe)}<button class="link" id="custom">Custom install…</button></div>`;
  return `
    <div class="stack" data-tauri-drag-region>
      ${logo(88)}
      <h1>${title}</h1>
      <p class="tag">${tag}</p>
      <div class="act">
        <button class="primary" id="install" ${canInstall() ? "" : "disabled"}>${button}</button>
        ${agreement()}
      </div>
    </div>
    <footer>${where}</footer>`;
}

function choice(everyone: boolean, title: string, text: string): string {
  const on = state.everyone === everyone;
  return `<label class="choice${on ? " on" : ""}">
    <input type="radio" name="for" value="${everyone ? "everyone" : "me"}" ${on ? "checked" : ""} />
    <span class="choice-title">${title}</span>
    <span class="choice-text">${text}</span>
  </label>`;
}

function custom(): string {
  const everyone = state.info?.canInstallForEveryone !== false;
  return `
    <div class="custom" data-tauri-drag-region>
      <h1 class="small">Custom install</h1>
      <section>
        <h3>Install for</h3>
        <div class="choices" role="radiogroup" aria-label="Install for">
          ${choice(false, "Just me", "No administrator needed, and updates install quietly.")}
          ${everyone ? choice(true, "Everyone on this PC", "Windows asks for an administrator, now and for each update.") : ""}
        </div>
      </section>
      <section>
        <h3>Folder</h3>
        <div class="folder">
          ${code(folder())}
          <button class="secondary" id="change">Change…</button>
        </div>
        <div class="folder-note">${warning()}</div>
      </section>
      <div class="custom-buttons">
        <button class="secondary" id="back">Back</button>
        <span class="spacer"></span>
        ${agreement()}
        <button class="primary small" id="install" ${canInstall() ? "" : "disabled"}>Install</button>
      </div>
    </div>`;
}

function installing(): string {
  const { doing } = heading();
  const asks = state.everyone || state.info?.installed?.everyone;
  const tag = asks ? "Windows asks for an administrator's permission first." : state.info?.update ? "Tributary opens again in a moment." : "This takes a few seconds.";
  return `
    <div class="stack" data-tauri-drag-region>
      ${logo(88)}
      <h1>${doing}</h1>
      <p class="tag">${tag}</p>
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
  const update = state.info?.update;
  return `
    <div class="stack" data-tauri-drag-region>
      ${logo(88)}
      <h1>${update ? "Tributary couldn't be updated" : "Tributary couldn't be installed"}</h1>
      <p class="tag error">${escape(state.error ?? "Something went wrong.")}</p>
      <div class="act">
        <button class="primary" id="again">Try again</button>
        ${update ? `<button class="link" id="open-old">Open Tributary as it is</button>` : ""}
      </div>
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

const STEPS: Record<Step, () => string> = { loading: () => "", welcome, custom, installing, ready, failed };

function render() {
  const focused = document.activeElement?.id;
  const busy = state.step === "installing";
  root.innerHTML = `
    <div class="drag" data-tauri-drag-region></div>
    <div class="caption">
      <button id="minimize" aria-label="Minimise"><svg viewBox="0 0 10 10"><path d="M0 5.5H10"/></svg></button>
      <button id="close" aria-label="Close" ${busy ? "disabled" : ""}><svg viewBox="0 0 10 10"><path d="M0 0L10 10M10 0L0 10"/></svg></button>
    </div>
    ${STEPS[state.step]()}
    ${state.reading ? sheet() : ""}`;
  if (focused) document.getElementById(focused)?.focus();
  else if (state.reading) document.getElementById("agree-terms")?.focus();
}

function set(changes: Partial<typeof state>) {
  Object.assign(state, changes);
  render();
}

async function checkFolder() {
  const check = await invoke<FolderCheck>("check_folder", { folder: folder(), everyone: state.everyone }).catch(() => OK);
  set({ check });
}

/** The bar fills towards 92% at about the pace the installer takes, then the rest when it's done. */
function pace(size: number, waitForWindows: boolean): () => void {
  const expected = 2500 + (size / 8_000_000) * 1000 + (waitForWindows ? 4000 : 0);
  const started = performance.now();
  const timer = setInterval(() => {
    const elapsed = performance.now() - started;
    set({ percent: 92 * (1 - Math.exp((-3 * elapsed) / expected)) });
  }, 80);
  return () => clearInterval(timer);
}

/** Run `job` with the progress bar, then go on to `after`. */
async function withProgress(job: () => Promise<unknown>, after: () => void) {
  const from = state.step;
  set({ step: "installing", notice: null, percent: 0 });
  const stop = pace(state.info?.size ?? 0, state.everyone || Boolean(state.info?.installed?.everyone));
  try {
    await job();
    stop();
    set({ percent: 100 });
    setTimeout(after, 450);
  } catch (e) {
    stop();
    set({ step: "failed", error: String(e), percent: 0, back: from });
  }
}

async function install() {
  if (!canInstall()) return;
  if (await invoke<boolean>("running").catch(() => false)) {
    set({ notice: "Tributary is open: close it, then click Install again." });
    return;
  }
  const where = folder();
  await withProgress(
    () => invoke("install", { folder: where, everyone: state.everyone }),
    () => set({ step: "ready" }),
  );
}

/** Started by the updater: update, and the setup closes when it's done. */
function update() {
  void withProgress(
    () => invoke("update"),
    () => {},
  );
}

async function finish(open: boolean) {
  const where = state.info?.installed && !state.info.update ? state.info.installed.folder : folder();
  try {
    if (open) await invoke("open", { folder: where, shortcut: state.shortcut });
    else if (state.shortcut) await invoke("add_shortcut", { folder: where });
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
    case "custom":
      set({ step: "custom", notice: null });
      break;
    case "back":
      // Back to the usual install: just for you, in the usual folder.
      set({ step: "welcome", everyone: false, notice: null, folders: { ...state.folders, justMe: state.info?.justMeFolder ?? state.folders.justMe } });
      void checkFolder();
      break;
    case "change":
      void invoke<string | null>("choose_folder", { current: folder() }).then((chosen) => {
        if (!chosen) return;
        state.folders = state.everyone ? { ...state.folders, everyone: chosen } : { ...state.folders, justMe: chosen };
        void checkFolder();
      });
      break;
    case "open":
      void finish(true);
      break;
    case "open-old":
      void invoke("open", { folder: state.info?.installed?.folder ?? folder(), shortcut: false }).then(() => appWindow.close());
      break;
    case "again":
      if (state.info?.update) update();
      else set({ step: state.back, error: null, notice: null });
      break;
  }
});

root.addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  if (input.id === "agree") set({ agreed: input.checked });
  if (input.id === "shortcut") set({ shortcut: input.checked });
  if (input.name === "for") {
    set({ everyone: input.value === "everyone", notice: null });
    void checkFolder();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.reading) set({ reading: false });
});

// Right-clicking shows nothing: it's a setup, not a web page.
window.addEventListener("contextmenu", (event) => event.preventDefault());

invoke<Info>("info")
  .then(async (info) => {
    state.info = info;
    state.everyone = Boolean(info.installed?.everyone);
    state.folders = {
      justMe: info.installed && !info.installed.everyone ? info.installed.folder : info.justMeFolder,
      everyone: info.installed?.everyone ? info.installed.folder : info.everyoneFolder,
    };
    if (info.update) {
      update();
      return;
    }
    await checkFolder();
    set({ step: "welcome" });
  })
  .catch((e) => set({ step: "failed", error: String(e) }));
