/* Tributary's website: the hero's graph and the live demos. Plain JS, no dependencies. */
(() => {
  "use strict";

  const root = document.documentElement;
  const NS = "http://www.w3.org/2000/svg";
  const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
  let RM = motionQuery.matches;
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const r2 = (n) => Math.round(n * 100) / 100;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function svg(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function el(tag, cls, html, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    if (parent) parent.appendChild(e);
    return e;
  }
  /** Position in the page, ignoring transforms. */
  function at(e) {
    let x = 0, y = 0, n = e;
    while (n) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    return { x, y, w: e.offsetWidth, h: e.offsetHeight, b: y + e.offsetHeight };
  }
  /** A polyline with its corners rounded like the app's graph: straight runs, quarter-circle bends. */
  function rounded(pts, R) {
    pts = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
    let d = `M${r2(pts[0][0])} ${r2(pts[0][1])}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const [px, py] = pts[i - 1], [cx, cy] = pts[i], [nx, ny] = pts[i + 1];
      const l1 = Math.hypot(cx - px, cy - py), l2 = Math.hypot(nx - cx, ny - cy);
      const r = Math.min(R, i === 1 ? l1 : l1 / 2, i === pts.length - 2 ? l2 : l2 / 2);
      const ux = (cx - px) / l1, uy = (cy - py) / l1, vx = (nx - cx) / l2, vy = (ny - cy) / l2;
      const ax = cx - ux * r, ay = cy - uy * r, bx = cx + vx * r, by = cy + vy * r, k = 0.5523 * r;
      d += `L${r2(ax)} ${r2(ay)}C${r2(ax + ux * k)} ${r2(ay + uy * k)} ${r2(bx - vx * k)} ${r2(by - vy * k)} ${r2(bx)} ${r2(by)}`;
    }
    const last = pts[pts.length - 1];
    return d + `L${r2(last[0])} ${r2(last[1])}`;
  }

  /** Runs `enter` when `node` comes into view and `leave` when it goes. */
  function onVisible(node, enter, leave, threshold = 0.25) {
    if (!("IntersectionObserver" in window)) { enter(); return; }
    new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting ? enter() : typeof leave === "function" && leave())), { threshold }).observe(node);
  }
  /**
   * A demo that plays by itself while it's on screen. `run(token)` is async and awaits
   * `wait(ms, token)`, which throws once the demo is off screen or stopped; it picks up
   * from where it was the next time it's seen. A visitor's own click stops it for good.
   */
  function autoplay(node, run, threshold = 0.3) {
    let token = null, stopped = false;
    const start = () => {
      if (stopped || RM || (token && token.alive)) return;
      const me = (token = { alive: true });
      run(me).catch(() => {}).finally(() => { if (token === me) token = null; });
    };
    onVisible(node, start, () => { if (token) token.alive = false; }, threshold);
    return {
      stop() { stopped = true; if (token) token.alive = false; },
      get stopped() { return stopped; },
    };
  }
  const wait = (ms, t) => new Promise((res, rej) => setTimeout(() => (t.alive ? res() : rej(new Error("stop"))), ms));

  const PEOPLE = {
    MC: ["Maya Chen", "#ffad1f"], SO: ["Sam Okafor", "#1fb5ff"], PN: ["Priya Nair", "#8ce04a"], LF: ["Lena Fischer", "#ff8e3c"],
    DR: ["Diego Ramos", "#e65cff"], RB: ["Rosa Bell", "#a77bff"], TP: ["Theo Park", "#19d7b4"],
  };
  const ICON = {
    check: '<svg viewBox="0 0 24 24"><path d="M20 6 9.5 16.5 4 11"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    spin: '<svg viewBox="0 0 24 24"><path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5"/></svg>',
    dot: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>',
    unlock: '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.8-1.2"/></svg>',
    cube: '<svg viewBox="0 0 24 24"><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5Z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/></svg>',
    map: '<svg viewBox="0 0 24 24"><path d="m3.5 6.5 5.5-2.5 6 2.5 5.5-2.5v13.5L15 20l-6-2.5L3.5 20Z"/><path d="M9 4v13.5M15 6.5V20"/></svg>',
    film: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M7.5 4.5v15M16.5 4.5v15M3.5 9.5h4M3.5 14.5h4M16.5 9.5h4M16.5 14.5h4"/></svg>',
    image: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m20 16-5-5-8 8"/></svg>',
    music: '<svg viewBox="0 0 24 24"><path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>',
    file: '<svg viewBox="0 0 24 24"><path d="M6.5 3.5h7l4 4v13h-11Z"/><path d="M13.5 3.5v4h4"/></svg>',
    code: '<svg viewBox="0 0 24 24"><path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5"/></svg>',
    branch: '<svg viewBox="0 0 24 24"><circle cx="6" cy="5" r="2.2"/><circle cx="6" cy="19" r="2.2"/><circle cx="18" cy="7" r="2.2"/><path d="M6 7.2v9.6M18 9.2c0 5-12 3-12 7.6"/></svg>',
    commit: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.6"/><path d="M3 12h5.4M15.6 12H21"/></svg>',
    undo: '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
    redo: '<svg viewBox="0 0 24 24"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/></svg>',
    rebase: '<svg viewBox="0 0 24 24"><circle cx="7" cy="19" r="2.2"/><circle cx="7" cy="5" r="2.2"/><circle cx="17" cy="5" r="2.2"/><path d="M7 7.2v9.6M17 7.2c0 4-5 5-8.4 10.4"/></svg>',
    discard: '<svg viewBox="0 0 24 24"><path d="M6.5 3.5h7l4 4v13h-11Z"/><path d="m9.5 12 5 5M14.5 12l-5 5"/></svg>',
    user: '<svg viewBox="0 0 24 24" style="width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2.4"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20.5c1.2-4 4-5.5 7.5-5.5s6.3 1.5 7.5 5.5"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/></svg>',
    warn: '<svg viewBox="0 0 24 24"><path d="M12 4 2.8 19.5h18.4Z"/><path d="M12 10v4.5M12 17.2v.2"/></svg>',
    merge: '<svg viewBox="0 0 24 24"><circle cx="6" cy="5.5" r="2.2"/><circle cx="6" cy="18.5" r="2.2"/><circle cx="18" cy="12" r="2.2"/><path d="M6 7.7v8.6M8 6.5c4 0 8 1.5 8 5.5"/></svg>',
  };
  /**
   * Initials that fit their circle: two letters at most 45% of its diameter wide, and no
   * taller than a third of it. Widths are Google Sans's at weight 700, in ems (measured once:
   * the font ships with the site), with a canvas for anything else.
   */
  const INITIAL_EMS = { MC: 1.644, SO: 1.42, PN: 1.349, LF: 1.118, DR: 1.375, RB: 1.28, TP: 1.187 };
  let measure = null;
  function initialsSize(text, diameter) {
    let ems = INITIAL_EMS[text];
    if (!ems) {
      measure = measure || document.createElement("canvas").getContext("2d");
      measure.font = '700 100px "Google Sans Variable", system-ui, sans-serif';
      ems = measure.measureText(text).width / 100;
    }
    return Math.round(Math.min(diameter * 0.34, (diameter * 0.45) / ems) * 10) / 10;
  }
  /** Google Sans's capitals are 0.72em tall: half that below the centre is their baseline. */
  const CAP = 0.72;
  /** Initials for an SVG circle at (x, y) of radius r: the capitals centred, sized to fit. */
  function svgInitials(parent, x, y, r, text) {
    const size = initialsSize(text, r * 2);
    const t = svg("text", { x, y: r2(y + (size * CAP) / 2), class: "ini", "font-size": size }, parent);
    t.textContent = text;
    return t;
  }
  const avatar = (who, d = 26) =>
    `<span class="av" style="--a:${PEOPLE[who][1]};width:${d}px;height:${d}px;font-size:${initialsSize(who, d)}px"><span class="ini">${who}</span></span>`;
  // Avatars written in the page: filled in, sized to fit.
  $$(".av[data-who]").forEach((a) => { a.outerHTML = avatar(a.dataset.who); });

  /* =========================================================
     The visitor's system, the navigation
     ========================================================= */
  if (motionQuery.addEventListener) motionQuery.addEventListener("change", (e) => (RM = e.matches));

  const ua = navigator.userAgent;
  const os = /Mac/.test(ua) ? "mac" : /Win/.test(ua) ? "win" : /Linux|X11|CrOS/.test(ua) && !/Android/.test(ua) ? "linux" : "mac";
  const osName = { mac: "macOS", win: "Windows", linux: "Linux" };
  $$("[data-dl] .btn").forEach((b) => {
    if (b.dataset.os !== os) return;
    b.classList.add("primary");
    b.querySelector(".name").textContent = "Download for " + osName[os];
    b.parentNode.prepend(b);
  });
  $$("[data-plats] .plat").forEach((p) => p.classList.toggle("primary", p.dataset.os === os));

  /* =========================================================
     Downloads: each button downloads its file from the latest release, which GitHub's API
     lists (the files' names have the version in them). Until that answers, or if it
     can't be reached, the buttons go to the release's page, where every file is.
     ========================================================= */
  const RELEASE_PAGE = "https://github.com/shikoko/tributary/releases/latest";
  const RELEASE_API = "https://api.github.com/repos/shikoko/tributary/releases/latest";
  // Which file each system gets, by processor: a Mac's one app is for both.
  const FILES = {
    mac: { x64: /_universal\.dmg$/, arm: /_universal\.dmg$/ },
    win: { x64: /_x64-setup\.exe$/, arm: /_arm64-setup\.exe$/ },
    linux: { x64: /_amd64\.AppImage$/, arm: /_aarch64\.AppImage$/ },
  };
  const ARCH_NAME = { x64: "x64", arm: "ARM" };
  // The processor: Chromium browsers say when asked; Linux on ARM says so in its user agent.
  const archGuess = /aarch64|arm64|armv8/i.test(ua) ? "arm" : "x64";
  const archOf = navigator.userAgentData && navigator.userAgentData.getHighEntropyValues
    ? navigator.userAgentData.getHighEntropyValues(["architecture"]).then((v) => (v.architecture === "arm" ? "arm" : v.architecture === "x86" ? "x64" : archGuess)).catch(() => archGuess)
    : Promise.resolve(archGuess);
  const releaseOf = () => {
    // Once a visit: GitHub allows sixty requests an hour without signing in.
    try {
      const kept = JSON.parse(sessionStorage.getItem("tributary.release") || "null");
      if (kept && kept.assets) return Promise.resolve(kept);
    } catch (e) { /* no storage: ask */ }
    return fetch(RELEASE_API, { headers: { Accept: "application/vnd.github+json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((release) => {
        const kept = { tag: release.tag_name, assets: (release.assets || []).map((a) => ({ name: a.name, url: a.browser_download_url })) };
        try { sessionStorage.setItem("tributary.release", JSON.stringify(kept)); } catch (e) { /* not kept */ }
        return kept;
      });
  };
  Promise.all([releaseOf(), archOf])
    .then(([release, arch]) => {
      const file = (system, which) => release.assets.find((a) => FILES[system][which].test(a.name));
      $$("[data-dl] .btn, [data-plats] .plat").forEach((link) => {
        const found = file(link.dataset.os, arch) || file(link.dataset.os, "x64");
        if (!found) return;
        link.href = found.url;
        link.title = found.name;
        const name = link.querySelector(".f");
        if (name) name.textContent = found.name;
      });
      // The other processor's files, for Windows and Linux, and the release's page.
      const other = arch === "arm" ? "x64" : "arm";
      const also = $("[data-also]");
      const links = [["win", "Windows"], ["linux", "Linux"]]
        .map(([system, label]) => [file(system, other), other === "arm" ? `${label} on ARM` : `${label} (${ARCH_NAME[other]})`])
        .filter(([found]) => found);
      if (!also || !links.length) return;
      also.textContent = "Also: ";
      links.forEach(([found, label]) => {
        const a = document.createElement("a");
        a.href = found.url;
        a.title = found.name;
        a.textContent = label;
        also.append(a, " · ");
      });
      const page = document.createElement("a");
      page.href = RELEASE_PAGE;
      page.textContent = `every file in ${release.tag}`;
      also.append(page);
      also.hidden = false;
    })
    .catch(() => { /* the buttons keep the release's page */ });

  // Scroll-triggered entrances.
  const revealIO = "IntersectionObserver" in window
    ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); revealIO.unobserve(e.target); } }), { rootMargin: "0px 0px -10% 0px" })
    : null;
  $$(".reveal").forEach((n) => (revealIO ? revealIO.observe(n) : n.classList.add("in")));

  // The section being read lights its link.
  const navLinks = $$(".nav .links a");
  const sections = navLinks.map((a) => $(a.getAttribute("href")));
  function spy() {
    const mid = innerHeight * 0.4;
    let on = -1;
    sections.forEach((s, i) => { const r = s.getBoundingClientRect(); if (r.top < mid && r.bottom > mid) on = i; });
    navLinks.forEach((a, i) => a.classList.toggle("on", i === on));
  }

  /* =========================================================
     Hero: a git graph on each side of the headline. Lanes branch
     off and merge back with the app's rounded bends; the two
     trunks (main and feature/sync) meet in one commit above the
     app, and the river runs on into it. Drawn in as the page
     loads; the lanes drift a little slower than the page.
     ========================================================= */
  const hero = $("#hero"), hsvg = $("#hero-graph"), hlabels = $("#hero-labels"), frame = $("#frame");
  // Rows of each side, one commit per row. col 2 is the lane nearest the headline.
  const SIDES = [
    {
      side: -1, shift: 0,
      trunk: { color: "--l1", commits: [0, 2, 6, 8, 9, 10], merges: [2], label: "main", head: true, av: { 0: "MC" } },
      lanes: [
        { col: 1, color: "--l2", from: 2, to: 6, commits: [3, 5], av: { 3: "PN" } },
        { col: 0, color: "--l3", tip: 1, to: 9, commits: [1, 4, 7], label: "art/tavern-sign", av: { 1: "RB" } },
      ],
    },
    {
      side: 1, shift: 0.5,
      trunk: { color: "--l4", commits: [0, 1, 3, 7, 9, 10], merges: [3], label: "feature/sync", av: { 0: "SO" } },
      lanes: [
        { col: 1, color: "--l5", from: 3, to: 7, commits: [4, 6], av: { 4: "DR" } },
        { col: 0, color: "--l2", tip: 2, to: 9, commits: [2, 5, 8], label: "fix/door", av: { 2: "TP" } },
      ],
    },
  ];
  let HG = null;

  function buildHero() {
    const W = hero.clientWidth, H = hero.clientHeight;
    hsvg.setAttribute("width", W); hsvg.setAttribute("height", H);
    hsvg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    hsvg.innerHTML = ""; hlabels.innerHTML = "";
    const f = at(frame), hp = at(hero);
    const mx = W / 2, fy = f.y - hp.y;
    const wide = W >= 1080;
    const yh = fy - (wide ? 54 : 46);           // where the trunks meet
    const RH = 42, G = 36, Y0 = 124, R = 14, RB = 28, V = 620; // row, lane gap, first row, bends, drawing speed
    const base = clamp(mx - 640, 36, 1e4);
    const defs = svg("defs", null, hsvg);
    const halo = svg("radialGradient", { id: "hero-halo" }, defs);
    svg("stop", { offset: "0", style: "stop-color: var(--l5); stop-opacity: .5" }, halo);
    svg("stop", { offset: "1", style: "stop-color: var(--l5); stop-opacity: 0" }, halo);

    const tails = [], clusters = [], labelBoxes = [];
    let trunkEnd = 0;
    const lanePath = (g, d, color, delay, dur, ease) => {
      const p = svg("path", { d, class: "lane draw glow" + (ease ? " ease" : ""), pathLength: 1 }, g);
      p.style.stroke = `var(${color})`; p.style.color = `var(${color})`;
      p.style.setProperty("--dl", delay.toFixed(2) + "s"); p.style.setProperty("--dur", dur.toFixed(2) + "s");
      return p;
    };
    const commitDot = (g, x, y, color, who, merge) => {
      const d = (0.25 + (y - Y0) / V).toFixed(2) + "s";
      const n = svg("g", { class: "pop" + (who ? " av" : "") }, g);
      n.style.setProperty("--dl", d);
      if (who) {
        svg("circle", { cx: x, cy: y, r: 16, fill: "var(--page)" }, n);
        const c = svg("circle", { cx: x, cy: y, r: 13, fill: PEOPLE[who][1] }, n);
        c.style.stroke = `var(${color})`; c.style.strokeWidth = 2.5;
        svgInitials(n, x, y, 13, who);
      } else if (merge) {
        const c = svg("circle", { cx: x, cy: y, r: 7, class: "ring" }, n); c.style.stroke = `var(${color})`;
      } else {
        const c = svg("circle", { cx: x, cy: y, r: 6.5, class: "c" }, n); c.style.fill = `var(${color})`;
      }
      return d;
    };
    const addLabel = (x, y, color, text, head, side, delay) => {
      const l = el("span", "hl-label" + (head ? " head" : "") + (side > 0 ? " r" : ""), (head ? '<svg viewBox="0 0 24 24"><path d="M20 6 9.5 16.5 4 11"/></svg>' : "") + esc(text));
      l.style.setProperty("--c", `var(${color})`);
      l.style.left = x + "px"; l.style.top = y + "px";
      l.style.setProperty("--dl", delay);
      return l;
    };

    if (wide) {
      SIDES.forEach((S) => {
        const X = (c) => (S.side < 0 ? base + c * G : W - base - c * G);
        const Y = (r) => Y0 + (r + S.shift) * RH;
        const g = svg("g", { class: "cluster" }, hsvg);
        const lanesG = svg("g", null, g), connG = svg("g", null, g), dotsG = svg("g", null, g);
        const labels = el("div", "hl-side", null, hlabels);
        labels.style.position = "absolute"; labels.style.inset = "0";
        const xt = X(2), T = S.trunk;
        const yEnd = Y(10) + RH * 0.6;
        // Branches first, so the trunk is drawn over their joins.
        S.lanes.forEach((L) => {
          const xc = X(L.col);
          let pts, y0;
          if (L.from != null) { y0 = Y(L.from); pts = [[xt, y0], [xc, y0], [xc, Y(L.to)], [xt, Y(L.to)]]; }
          else { y0 = Y(L.tip); pts = [[xc, y0], [xc, Y(L.to)], [xt, Y(L.to)]]; }
          const len = Math.abs(Y(L.to) - y0) + Math.abs(xt - xc) * (L.from != null ? 2 : 1);
          lanePath(lanesG, rounded(pts, R), L.color, 0.25 + (y0 - Y0) / V, len / V);
          L.commits.forEach((r) => commitDot(dotsG, xc, Y(r), L.color, L.av && L.av[r], false));
          if (L.label) {
            const gx = xt + S.side * -26;
            const conn = svg("path", { d: `M${xc} ${Y(L.tip)}H${gx}`, class: "lane draw", pathLength: 1 }, connG);
            conn.style.stroke = `var(${L.color})`; conn.style.strokeWidth = 1.5; conn.style.opacity = 0.55;
            const dl = 0.35 + (Y(L.tip) - Y0) / V;
            conn.style.setProperty("--dl", dl.toFixed(2) + "s"); conn.style.setProperty("--dur", ".3s");
            labels.appendChild(addLabel(gx, Y(L.tip), L.color, L.label, false, S.side, (dl + 0.2).toFixed(2) + "s"));
          }
        });
        lanePath(lanesG, `M${xt} ${Y(0)}V${yEnd}`, T.color, 0.25, (yEnd - Y(0)) / V);
        T.commits.forEach((r) => commitDot(dotsG, xt, Y(r), T.color, T.av && T.av[r], T.merges.includes(r)));
        if (T.label) {
          const gx = xt + S.side * -26;
          const conn = svg("path", { d: `M${xt} ${Y(0)}H${gx}`, class: "lane draw", pathLength: 1 }, connG);
          conn.style.stroke = `var(${T.color})`; conn.style.strokeWidth = 1.5; conn.style.opacity = 0.55;
          conn.style.setProperty("--dl", ".35s"); conn.style.setProperty("--dur", ".25s");
          labels.appendChild(addLabel(gx, Y(0), T.color, T.label, T.head, S.side, ".5s"));
        }
        trunkEnd = Math.max(trunkEnd, 0.25 + (yEnd - Y(0)) / V);
        // The tail: on from the cluster, round the corner and in to the commit they share.
        const tail = lanePath(hsvg, "", T.color, 0, 0.9, true);
        hsvg.insertBefore(tail, hsvg.firstChild.nextSibling);
        tails.push({ p: tail, x: xt, yEnd, side: S.side });
        clusters.push({ g, labels });
        labelBoxes.push(labels);
      });
    } else {
      // Narrow screens: one lane from each edge, meeting in the commit.
      [[-1, "--l1", "MC"], [1, "--l4", "SO"]].forEach(([side, color, who]) => {
        const x0 = side < 0 ? -12 : W + 12;
        const tail = lanePath(hsvg, `M${x0} ${yh}H${mx}`, color, 0.2, 0.9, true);
        const xs = [0.14, 0.32].map((k) => (side < 0 ? W * k : W * (1 - k)));
        commitDot(hsvg, xs[0], yh, color, null, false);
        const g = svg("g", { class: "pop av" }, hsvg); g.style.setProperty("--dl", ".6s");
        svg("circle", { cx: xs[1], cy: yh, r: 16, fill: "var(--page)" }, g);
        const c = svg("circle", { cx: xs[1], cy: yh, r: 13, fill: PEOPLE[who][1] }, g);
        c.style.stroke = `var(${color})`; c.style.strokeWidth = 2.5;
        svgInitials(g, xs[1], yh, 13, who);
        tail.style.setProperty("--dl", ".15s");
      });
      trunkEnd = 0.2;
    }
    tails.forEach((t) => t.p.style.setProperty("--dl", trunkEnd.toFixed(2) + "s"));
    const mergeAt = trunkEnd + 0.85;
    // The commit they meet in, and the river into the app.
    const river = svg("path", { class: "river", d: `M${mx - 6} ${yh}L${mx - 26} ${fy + 2}H${mx + 26}L${mx + 6} ${yh}Z` }, hsvg);
    river.style.setProperty("--dl", (mergeAt + 0.15).toFixed(2) + "s");
    const m = svg("g", { class: "pop" }, hsvg);
    svg("circle", { cx: mx, cy: yh, r: 40, class: "halo" }, m);
    m.style.setProperty("--dl", mergeAt.toFixed(2) + "s");
    svg("circle", { cx: mx, cy: yh, r: 17, class: "merge-c" }, m);
    svg("circle", { cx: mx, cy: yh, r: 6.5, class: "merge-d" }, m);

    HG = { W, mx, yh, fy, RB, tails, clusters, room: wide ? yh - RB - Math.max(...tails.map((t) => t.yEnd)) - 12 : 0 };
    updateHero();
  }

  function updateHero() {
    if (!HG) return;
    const y = Math.max(0, scrollY);
    const s = RM ? 0 : Math.min(y * 0.2, HG.room);
    HG.clusters.forEach((c) => {
      c.g.setAttribute("transform", `translate(0 ${s.toFixed(1)})`);
      c.labels.style.transform = `translateY(${s.toFixed(1)}px)`;
    });
    HG.tails.forEach((t) => t.p.setAttribute("d", rounded([[t.x, t.yEnd + s], [t.x, HG.yh], [HG.mx, HG.yh]], HG.RB)));
    const e = RM ? 1 : 1 - Math.pow(1 - clamp(y / (innerHeight * 0.85), 0, 1), 2);
    frame.style.setProperty("--tilt", (20 * (1 - e)).toFixed(2) + "deg");
    frame.style.setProperty("--sc", (0.94 + 0.06 * e).toFixed(3));
  }

  /* =========================================================
     The journey: as you scroll past the hero's commit, two
     branches spawn from it and lead down the page's sides. Each
     feature is a commit in its colour, on a loop that splits off
     and joins again; at the end they flow into the download
     section's mark. Drawn by scrolling; complete without motion.
     ========================================================= */
  const jsvg = $("#journey"), dlMark = $("#dl-mark");
  /** The download mark's geometry, in its own pixels (index.html draws the same, for no script). */
  const MARK = { lanes: [32, 66, 100, 134, 168], arrive: 10, splits: [38, 60, 82, 104], curve: 130, cx: 100, cy: 218 };
  const JOURNEY = ["graph", "theming", "undo", "art", "big-files", "reviews", "search", "simple"];
  let JY = null;
  /** A polyline with each corner rounded by its own radius (radii[i] for pts[i + 1]). */
  function roundedEach(pts, radii) {
    let d = `M${r2(pts[0][0])} ${r2(pts[0][1])}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const [px, py] = pts[i - 1], [cx, cy] = pts[i], [nx, ny] = pts[i + 1];
      const l1 = Math.hypot(cx - px, cy - py), l2 = Math.hypot(nx - cx, ny - cy);
      if (!l1 || !l2) continue;
      const r = Math.min(radii[i - 1], i === 1 ? l1 : l1 / 2, i === pts.length - 2 ? l2 : l2 / 2);
      const ux = (cx - px) / l1, uy = (cy - py) / l1, vx = (nx - cx) / l2, vy = (ny - cy) / l2;
      const ax = cx - ux * r, ay = cy - uy * r, bx = cx + vx * r, by = cy + vy * r, k = 0.5523 * r;
      d += `L${r2(ax)} ${r2(ay)}C${r2(ax + ux * k)} ${r2(ay + uy * k)} ${r2(bx - vx * k)} ${r2(by - vy * k)} ${r2(bx)} ${r2(by)}`;
    }
    const last = pts[pts.length - 1];
    return d + `L${r2(last[0])} ${r2(last[1])}`;
  }
  // How far the pen must have come for each point of a lane to be drawn: its depth on the
  // page, plus a little for each step across, so a run across is drawn by scrolling too.
  const ACROSS = 0.12, STEP = 5;
  function sampled(p, startKey, ox = 0, oy = 0) {
    const len = p.getTotalLength(), n = Math.max(1, Math.ceil(len / STEP));
    const keys = new Float32Array(n + 1), xs = new Float32Array(n + 1), ys = new Float32Array(n + 1);
    let prev = p.getPointAtLength(0), k = startKey == null ? prev.y + oy : startKey;
    keys[0] = k; xs[0] = prev.x + ox; ys[0] = prev.y + oy;
    for (let i = 1; i <= n; i++) {
      const pt = p.getPointAtLength(Math.min(len, i * STEP));
      k += Math.abs(pt.y - prev.y) + ACROSS * Math.abs(pt.x - prev.x);
      keys[i] = k; xs[i] = pt.x + ox; ys[i] = pt.y + oy; prev = pt;
    }
    p.style.strokeDasharray = `${len + 2} ${len + 2}`;
    p.style.strokeDashoffset = len + 2;
    return { p, len, n, keys, xs, ys, shown: -1 };
  }
  function keyNear(t, x, y) {
    let best = 0, bd = Infinity;
    for (let i = 0; i <= t.n; i++) { const dd = Math.abs(t.xs[i] - x) + Math.abs(t.ys[i] - y); if (dd < bd) { bd = dd; best = i; } }
    return t.keys[best];
  }
  function revealTrack(t, pen) {
    let lo = -1, hi = t.n;
    if (pen >= t.keys[t.n]) lo = t.n;
    else { while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t.keys[m] <= pen) lo = m; else hi = m; } }
    if (lo === t.shown) return;
    t.shown = lo;
    const len = lo < 0 ? 0 : lo === t.n ? t.len + 2 : lo * STEP;
    t.p.style.strokeDashoffset = t.len + 2 - len;
  }

  function buildJourney() {
    if (!jsvg || !HG) return;
    const main = $("main");
    const W = main.clientWidth, H = main.offsetHeight;
    jsvg.setAttribute("width", W); jsvg.setAttribute("height", H); jsvg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    jsvg.innerHTML = "";
    const top = at(main).y;
    const Y = (e) => at(e).y - top;
    // The content's left edge, and the hero's window, which the lanes must pass outside.
    const first = $("#graph");
    const contentLeft = Math.min(at(first).x + parseFloat(getComputedStyle(first).paddingLeft), at(frame).x - 6);
    const mode = contentLeft >= 112 ? "full" : contentLeft >= 44 ? "pair" : "single";
    const side = (s) => (s < 0 ? (x) => x : (x) => W - x);
    const trunkX = mode === "full" ? contentLeft - 92 : Math.max(7, Math.round(contentLeft / 2));
    const loopX = trunkX + 30;
    const lanesG = svg("g", null, jsvg), loopsG = svg("g", null, jsvg), nodesG = svg("g", null, jsvg);
    const { mx, yh, fy } = HG;
    const spawn = yh + Math.round((fy - yh) / 2);
    // The mark they flow into: its five lanes, in the page. The two branches arrive across its
    // top and turn down into the outer lanes; the others split off them, as the hero's do,
    // and all five bend in, like the logo's, to the commit.
    const mk = at(dlMark), mkX = mk.x - at(main).x, mkY = mk.y - top;
    const LX = MARK.lanes.map((x) => mkX + x), arriveY = mkY + MARK.arrive, curveY = mkY + MARK.curve;
    const cX = mkX + MARK.cx, cY = mkY + MARK.cy;
    const intoX = [LX[0], LX[4]];
    // On down from a lane's last corner, then the logo's bend into the commit.
    const intoLogo = (x) => `C${r2(x)} ${r2(curveY + (cY - curveY) * 0.54)} ${r2(cX)} ${r2(cY - (cY - curveY) * 0.486)} ${r2(cX)} ${r2(cY)}`;
    const trunks = [];
    const sides = mode === "single" ? [-1] : [-1, 1];
    sides.forEach((s, k) => {
      const X = side(s), x = X(trunkX), color = s < 0 ? "var(--l1)" : "var(--l5)";
      const ix = intoX[k];
      const d = roundedEach([[mx, yh], [mx, spawn], [x, spawn], [x, arriveY], [ix, arriveY], [ix, curveY]], [Math.min(16, spawn - yh - 2), 26, 26, 18]) + intoLogo(ix);
      const p = svg("path", { d, class: "jl trunk" }, lanesG);
      p.style.stroke = color;
      trunks.push({ s, x, X, color, t: null, p });
    });
    trunks.forEach((tr) => (tr.t = sampled(tr.p, yh)));
    // A commit by each feature's heading, in its colour: on a loop beside the trunk on the
    // heading's side, or on the trunk itself when there's no room for one.
    const nodes = [], loops = [];
    JOURNEY.forEach((id) => {
      const sec = document.getElementById(id);
      if (!sec) return;
      const head = $(".kicker", sec) || $("h2", sec);
      const hb = at(head);
      const ny = Y(head) + hb.h / 2;
      const color = getComputedStyle(sec).getPropertyValue("--c").trim() || "var(--l1)";
      const headSide = hb.x + hb.w / 2 - at(main).x < W / 2 ? -1 : 1;
      const tr = trunks.find((t) => t.s === headSide) || trunks[0];
      let nx = tr.x, owner = tr.t;
      if (mode === "full") {
        const lx = tr.X(loopX), ys = ny - 70, ye = ny + 128;
        const p = svg("path", { d: roundedEach([[tr.x, ys], [lx, ys], [lx, ye], [tr.x, ye]], [13, 13]), class: "jl loop" }, loopsG);
        p.style.stroke = color;
        const t = sampled(p, keyNear(tr.t, tr.x, ys));
        loops.push(t);
        nx = lx; owner = t;
      }
      const g = svg("g", { class: "jn" }, nodesG);
      const small = nx < 24 || nx > W - 24;
      const halo = svg("circle", { cx: nx, cy: ny, r: small ? 9 : 13, class: "halo" }, g); halo.style.stroke = color;
      const c = svg("circle", { cx: nx, cy: ny, r: small ? 5.5 : 7.5, class: "ring" }, g); c.style.fill = color;
      nodes.push({ g, key: keyNear(owner, nx, ny) });
    });
    // The hero's commit and its river, again, over the lanes leaving it.
    const copy = svg("g", { class: "copy" }, jsvg);
    svg("path", { class: "river", d: `M${mx - 6} ${yh}L${mx - 26} ${fy + 2}H${mx + 26}L${mx + 6} ${yh}Z` }, copy);
    svg("circle", { cx: mx, cy: yh, r: 17, class: "mc" }, copy);
    svg("circle", { cx: mx, cy: yh, r: 6.5, class: "md" }, copy);
    // The middle lanes split off the arriving branches, each at a commit, with the app's bend.
    // From both sides: pink off the left, green off the right, amber off pink; from one: each off the last.
    const COLOURS = ["var(--l1)", "var(--l2)", "var(--l3)", "var(--l4)", "var(--l5)"];
    const lanes = [];
    lanes[0] = trunks[0].t;
    if (trunks[1]) lanes[4] = trunks[1].t;
    const SPLITS = trunks[1] ? [[0, 1, MARK.splits[0]], [4, 3, MARK.splits[0]], [1, 2, MARK.splits[1]]] : [[0, 1, MARK.splits[0]], [1, 2, MARK.splits[1]], [2, 3, MARK.splits[2]], [3, 4, MARK.splits[3]]];
    const markLanes = [];
    SPLITS.forEach(([from, to, sy]) => {
      const y = mkY + sy;
      const p = svg("path", { d: roundedEach([[LX[from], y], [LX[to], y], [LX[to], curveY]], [14]) + intoLogo(LX[to]), class: "jl" }, lanesG);
      p.style.stroke = COLOURS[to];
      const key = keyNear(lanes[from], LX[from], y);
      lanes[to] = sampled(p, key);
      markLanes.push(lanes[to]);
      const g = svg("g", { class: "jn" }, nodesG);
      const c = svg("circle", { cx: LX[from], cy: y, r: 4.5, class: "split" }, g); c.style.fill = COLOURS[from];
      nodes.push({ g, key });
    });
    dlMark.classList.add("journey-on");
    const done = Math.max(...lanes.map((t) => keyNear(t, cX, cY)));
    JY = { trunks, loops, nodes, copy, markLanes, done, yh };
    updateJourney();
  }

  function updateJourney() {
    if (!JY) return;
    const docH = document.documentElement.scrollHeight;
    const atEnd = scrollY + innerHeight >= docH - 4;
    // The pen runs a little ahead of the middle of the screen, further ahead as the page goes on.
    const progress = clamp(scrollY / Math.max(1, docH - innerHeight), 0, 1);
    const pen = RM || atEnd ? Infinity : scrollY + innerHeight * (0.7 + 0.22 * progress) - at($("main")).y;
    JY.trunks.forEach((tr) => revealTrack(tr.t, pen));
    JY.loops.forEach((t) => revealTrack(t, pen));
    JY.markLanes.forEach((t) => revealTrack(t, pen));
    JY.nodes.forEach((nd) => nd.g.classList.toggle("on", pen >= nd.key));
    JY.copy.classList.toggle("on", pen >= JY.yh + 2);
    dlMark.classList.toggle("done", pen >= JY.done - 2);
  }

  /* =========================================================
     1. The commit graph: commits arrive at the top, branches
        merge, and pointing at a lane lights it up.
     ========================================================= */
  const BRANCH = {
    main: { c: "--l1", col: 0 }, "art/tavern-sign": { c: "--l2", col: 1 }, "fix/door": { c: "--l3", col: 1 }, "feature/sync": { c: "--l4", col: 2 },
  };
  // [id, branch, message, author, parents, minutes]; oldest first.
  const HISTORY = [
    ["a1", "main", "Initial commit", "MC", [], -14000],
    ["a2", "main", "Set up the notebook project", "MC", ["a1"], -12500],
    ["s1", "feature/sync", "Start the sync protocol", "SO", ["a2"], -11000],
    ["a3", "main", "Add a sidebar for notebooks", "LF", ["a2"], -9800],
    ["s2", "feature/sync", "Send changes in small batches", "SO", ["s1"], -8600],
    ["a4", "main", "Speed up opening large notebooks", "PN", ["a3"], -7300],
    ["t1", "art/tavern-sign", "Block out the tavern sign", "RB", ["a4"], -6100],
    ["a5", "main", "Fix the note counter in the sidebar", "LF", ["a4"], -5200],
    ["t2", "art/tavern-sign", "Paint the tavern sign", "RB", ["t1"], -4100],
    ["s3", "feature/sync", "Resolve conflicting edits", "DR", ["s2"], -2900],
    ["a6", "main", "Add a theme picker", "MC", ["a5"], -1500],
    // What arrives, one at a time.
    ["t3", "art/tavern-sign", "Sign: paint a mug of ale next to the mark", "RB", ["t2"], 0],
    ["a7", "main", "Merge pull request #23 from art/tavern-sign", "MC", ["a6", "t3"], 6],
    ["s4", "feature/sync", "Document the sync protocol", "DR", ["s3"], 13],
    ["a8", "main", "Merge pull request #24 from feature/sync", "MC", ["a7", "s4"], 19],
    ["a9", "main", "Prepare the 0.3 release notes", "PN", ["a8"], 26],
    ["d1", "fix/door", "Make the door creak", "TP", ["a9"], 33],
    ["d2", "fix/door", "Oil the door hinge", "TP", ["d1"], 39],
  ].map(([id, b, m, a, p, t]) => ({ id, b, m, a, p, t }));
  const BASE_N = 11;
  const TAGS = { a4: "v0.2.0" };
  const MERGED = { "art/tavern-sign": "a7", "feature/sync": "a8" };

  function initGraph() {
    const gd = $("#gd"), view = $(".gd-view", gd), body = $("#gd-body"), status = $("#gd-status");
    const RH = 44, LANE = 22, X0 = 14;
    let n = BASE_N, hovered = null, flash = null, flashTimer = 0;

    function rel(t, now) {
      const d = now - t;
      if (d < 1) return "just now";
      if (d < 60) return `${Math.round(d)} min ago`;
      if (d < 1440) return `${Math.round(d / 60)} hours ago`;
      const days = Math.round(d / 1440);
      return days === 1 ? "yesterday" : `${days} days ago`;
    }

    function render(arrived) {
      const list = HISTORY.slice(0, n).reverse();
      const row = new Map(list.map((c, i) => [c.id, i]));
      const now = list[0].t;
      const ids = new Set(list.map((c) => c.id));
      const merged = (b) => MERGED[b] && ids.has(MERGED[b]);
      const tips = {};
      list.forEach((c) => { if (!(c.b in tips)) tips[c.b] = c.id; });
      body.innerHTML = "";
      const frag = document.createDocumentFragment();
      list.forEach((c, i) => {
        const r = el("div", "gd-row" + (c.p.length > 1 ? " merge" : "") + (arrived && i === 0 ? " arrive" : ""), null, frag);
        r.dataset.b = c.b;
        const chips = [];
        if (tips[c.b] === c.id && !merged(c.b)) {
          const head = c.b === "main";
          chips.push(`<span class="chip${head ? " head" : ""}" data-b="${c.b}" style="--c: var(${BRANCH[c.b].c})">${head ? ICON.check : ""}${c.b}</span>`);
        }
        if (TAGS[c.id]) chips.push(`<span class="chip tag" data-b="${c.b}" style="--c: var(--border-strong)">${TAGS[c.id]}</span>`);
        const msg = esc(c.m).replace(/#(\d+)/, '<span class="pr">#$1</span>');
        r.innerHTML = `<span class="lbl">${chips.join("")}</span><span class="g"></span><span class="msg">${msg}</span><span class="who">${PEOPLE[c.a][0]}</span><span class="when">${rel(c.t, now)}</span>`;
      });
      body.appendChild(frag);
      // The graph, over the label and graph columns.
      const g0 = $(".gd-row .g", body);
      const gx = g0 ? g0.offsetLeft : 190;
      const W = gx + X0 + 3 * LANE + 30, H = list.length * RH;
      const s = svg("svg", { class: "gd-svg", width: W, height: H, viewBox: `0 0 ${W} ${H}` });
      const X = (c) => gx + X0 + BRANCH[c.b].col * LANE, Y = (i) => i * RH + RH / 2;
      const edges = svg("g", null, s), nodes = svg("g", null, s);
      const edge = (d, b, fresh) => {
        const p = svg("path", { d, class: "e" + (fresh ? " new" : ""), "data-b": b, pathLength: fresh ? 1 : null }, edges);
        p.style.stroke = `var(${BRANCH[b].c})`; p.style.color = `var(${BRANCH[b].c})`;
        svg("path", { d, class: "hit", "data-b": b }, edges);
      };
      list.forEach((c, i) => {
        const fresh = arrived && i === 0;
        c.p.forEach((pid, k) => {
          const j = row.get(pid);
          const parent = HISTORY.find((h) => h.id === pid);
          const y2 = j == null ? H + RH : Y(j);
          if (k === 0) {
            if (BRANCH[parent.b].col === BRANCH[c.b].col) edge(`M${X(c)} ${Y(i)}V${y2}`, c.b, fresh);
            else edge(rounded([[X(c), Y(i)], [X(c), y2], [X(parent), y2]], 11), c.b, fresh);
          } else {
            edge(rounded([[X(c), Y(i)], [X(parent), Y(i)], [X(parent), y2]], 11), parent.b, fresh);
          }
        });
        // A line from the label to its commit.
        if (gx > 40 && ((tips[c.b] === c.id && !merged(c.b)) || TAGS[c.id])) {
          const ln = svg("path", { d: `M${gx - 10} ${Y(i)}H${X(c) - 12}`, class: "cn", "data-b": c.b }, edges);
          ln.style.stroke = TAGS[c.id] && !(tips[c.b] === c.id) ? "var(--border-strong)" : `var(${BRANCH[c.b].c})`;
        }
        const nd = svg("g", { class: "n" + (fresh ? " new" : ""), "data-b": c.b }, nodes);
        if (c.p.length > 1) {
          svg("circle", { cx: X(c), cy: Y(i), r: 9, class: "ring" }, nd);
          const m = svg("circle", { cx: X(c), cy: Y(i), r: 6, class: "m" }, nd);
          m.style.stroke = `var(${BRANCH[c.b].c})`;
        } else {
          svg("circle", { cx: X(c), cy: Y(i), r: 15, class: "ring" }, nd);
          const a = svg("circle", { cx: X(c), cy: Y(i), r: 12.5, fill: PEOPLE[c.a][1] }, nd);
          a.style.stroke = `var(${BRANCH[c.b].c})`; a.style.strokeWidth = 2.5;
          svgInitials(nd, X(c), Y(i), 12.5, c.a);
          svg("title", null, nd).textContent = `${PEOPLE[c.a][0]} on ${c.b}`;
        }
      });
      body.appendChild(s);
      light();
    }

    function light() {
      const b = hovered || flash;
      gd.classList.toggle("hl", !!b);
      $$("[data-b]", gd).forEach((e) => e.classList.toggle("lit", !!b && e.dataset.b === b));
    }
    function slide() {
      body.classList.remove("slide");
      body.style.transform = `translateY(${-RH}px)`;
      void body.offsetHeight;
      body.classList.add("slide");
      body.style.transform = "translateY(0)";
    }
    function step() {
      n++;
      render(true);
      slide();
      const c = HISTORY[n - 1];
      status.textContent = c.p.length > 1 ? "Merged" : `New on ${c.b}`;
      flash = c.p.length > 1 ? HISTORY.find((h) => h.id === c.p[1]).b : c.b;
      light();
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { flash = null; light(); status.textContent = "Live"; }, 1700);
    }

    view.addEventListener("pointerover", (e) => {
      const t = e.target.closest("[data-b]");
      const b = t ? t.dataset.b : null;
      if (b !== hovered) { hovered = b; light(); }
    });
    view.addEventListener("pointerleave", () => { hovered = null; light(); });

    if (RM) n = HISTORY.length;
    render(false);
    addEventListener("resize", () => render(false));

    autoplay(gd, async (t) => {
      for (;;) {
        await wait(n === BASE_N ? 1400 : 2600, t);
        if (hovered) continue;
        if (n < HISTORY.length) { step(); continue; }
        await wait(2600, t);
        body.style.transition = "opacity .5s"; body.style.opacity = "0";
        await wait(550, t);
        n = BASE_N; render(false);
        body.style.opacity = "1";
        setTimeout(() => (body.style.transition = ""), 600);
      }
    });
  }

  /* =========================================================
     1b. Make it yours: the app's appearance settings
         (src/lib/appearance.ts) restyling a live commit list.
     ========================================================= */
  const LANE_PALETTES = {
    vivid: {
      dark: ["#1fb5ff", "#ff4f9a", "#8ce04a", "#ffad1f", "#a77bff", "#19d7b4", "#ff6a45", "#ffe24a", "#4d7cff", "#e65cff", "#36e07c", "#ff8e3c"],
      light: ["#0a8bd1", "#d72e79", "#4b931b", "#cf8300", "#7a4fe3", "#0b9a81", "#dc4b26", "#a88b00", "#2f5ee3", "#b33ccc", "#17984f", "#d4661a"],
    },
    soft: {
      dark: ["#7cc4e8", "#e895b8", "#a9cf88", "#e3bd78", "#b9a3e8", "#7fd1c0", "#e8a08a", "#ddd08a", "#8fa5e8", "#d49ae3", "#86d4a4", "#e8b088"],
      light: ["#4a8fb5", "#b5628a", "#6a934b", "#a7833d", "#7c68b3", "#4a978a", "#b36b56", "#958737", "#5770b3", "#9760a8", "#4a996b", "#b37d4c"],
    },
    safe: {
      dark: ["#56b4e9", "#e69f00", "#19b38a", "#f0e442", "#cc79a7", "#e8702a", "#3d93dc", "#a0a8b8"],
      light: ["#2a8cc6", "#c28600", "#009e73", "#9c8f00", "#b0588a", "#d55e00", "#0072b2", "#677083"],
    },
  };
  const PALETTE_NAMES = { vivid: "Vivid", soft: "Soft", safe: "Colour-blind safe" };
  const ACCENTS = [
    { name: "Azure", color: "#1fb5ff", end: "#4d7cff" }, { name: "Blue", color: "#4d7cff", end: "#8a5cff" },
    { name: "Violet", color: "#a77bff", end: "#e65cff" }, { name: "Pink", color: "#ff4f9a", end: "#ff6a45" },
    { name: "Coral", color: "#ff6a45", end: "#ff9a2e" }, { name: "Amber", color: "#ffad1f", end: "#ff7a2e" },
    { name: "Green", color: "#2fd07a", end: "#14b8a6" }, { name: "Teal", color: "#19c9b4", end: "#1f9bff" },
    { name: "Graphite", color: "#8e97a8", end: "#6c7486" },
  ];
  const CURVES = { mixed: "Mixed", round: "Round", smooth: "Smooth", tight: "Tight", sweep: "Sweep" };
  const CI_DOTS = { beside: "Beside", ringed: "Ringed", halo: "Halo", filled: "Filled" };
  const CHECK_COLOURS = { dark: { pending: "#ffad1f", success: "#36e07c", failure: "#ff5c6c" }, light: { pending: "#d68000", success: "#189e52", failure: "#d63040" } };
  const MOCK_BG = { dark: [26, 29, 36], light: [245, 246, 248] };

  // Colour arithmetic, as appearance.ts does it.
  const hex2rgb = (h) => { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
  const rgb2hex = (c) => "#" + c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("");
  const mixRgb = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const lum = (c) => { const ch = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]); };
  const contrastOf = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  function readable(c, bg, toward, min = 4.5) { let r = c; for (let i = 0; i < 30 && contrastOf(r, bg) < min; i++) r = mixRgb(r, toward, 0.08); return r; }
  const textOn = (h) => (contrastOf(hex2rgb(h), [13, 15, 19]) > contrastOf(hex2rgb(h), [255, 255, 255]) ? "#0d0f13" : "#ffffff");
  function accentRoles(acc, theme) {
    const c = hex2rgb(acc.color), e = hex2rgb(acc.end), W = [255, 255, 255], B = [0, 0, 0];
    const bg = MOCK_BG[theme], toward = theme === "dark" ? W : B;
    const text = theme === "dark" ? mixRgb(c, W, 0.45) : mixRgb(c, B, 0.4);
    return {
      "--m-accent": acc.color,
      "--m-accent-text": rgb2hex(readable(text, bg, toward)),
      "--m-accent-fill": rgb2hex(readable(c, W, B, 5.2)),
      "--m-accent-fill-2": rgb2hex(readable(e, W, B, 5.2)),
      "--m-on-accent": "#ffffff",
    };
  }

  /** How a line turns from one lane to another, as graphPainter.ts's turn(), as SVG path data. */
  function turnD(start, at, end, radius, style) {
    const toward = (from, to, dist) => { const l = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1; return [to[0] + ((from[0] - to[0]) / l) * dist, to[1] + ((from[1] - to[1]) / l) * dist]; };
    const first = Math.hypot(start[0] - at[0], start[1] - at[1]), second = Math.hypot(end[0] - at[0], end[1] - at[1]);
    let legs, pull;
    if (style === "round" || style === "tight") { const r = Math.min(style === "tight" ? Math.min(radius, 7) : radius, first, second); legs = [r, r]; pull = 0.5523; }
    else if (style === "sweep") { legs = [first, second]; pull = 0.5523; }
    else { legs = [Math.min(first, radius + 1), Math.min(second, radius + 1)]; pull = 0.8; }
    const a = toward(start, at, legs[0]), b = toward(end, at, legs[1]);
    const P = (p) => `${r2(p[0])} ${r2(p[1])}`;
    return `M${P(start)}L${P(a)}C${P([a[0] + (at[0] - a[0]) * pull, a[1] + (at[1] - a[1]) * pull])} ${P([b[0] + (at[0] - b[0]) * pull, b[1] + (at[1] - b[1]) * pull])} ${P(b)}L${P(end)}`;
  }
  const bendFor = (curves, from, to) => (curves === "mixed" ? (Math.abs(to - from) === 1 ? "smooth" : "round") : curves);

  // A small CI mark on a dot, as Settings' "Checks on dots" draws it.
  function ciMark(g, x, y, r, lane, ci, state, look, bg) {
    const col = CHECK_COLOURS[look][state];
    const add = (attrs, style) => { const c = svg("circle", attrs, g); Object.assign(c.style, style || {}); if (state === "pending" && !RM) c.classList.add("tm-ci-run"); return c; };
    if (ci === "beside") {
      // As the app: half outside the node's lower right, cut out of it by a ring of the
      // row's colour.
      svg("circle", { cx: x, cy: y, r }, g).style.fill = lane;
      const d = Math.round(((r + 1.7) / Math.SQRT2) * 2) / 2;
      svg("circle", { cx: x + d, cy: y + d, r: 5 }, g).style.fill = bg;
      add({ cx: x + d, cy: y + d, r: 3.5 }, { fill: col });
    } else if (ci === "ringed") {
      svg("circle", { cx: x, cy: y, r: r + 2.2 }, g).style.fill = bg;
      add({ cx: x, cy: y, r: r }, { fill: col, stroke: lane, strokeWidth: 2 });
    } else if (ci === "halo") {
      svg("circle", { cx: x, cy: y, r: r + 3.2 }, g).style.fill = bg;
      add({ cx: x, cy: y, r: r + 2.1 }, { fill: "none", stroke: col, strokeWidth: 2 });
      svg("circle", { cx: x, cy: y, r: r - 0.6 }, g).style.fill = lane;
    } else {
      svg("circle", { cx: x, cy: y, r: r + 1.6 }, g).style.fill = bg;
      add({ cx: x, cy: y, r: r + 0.6 }, { fill: col });
    }
  }

  function initTheming() {
    const card = $("#tm"), opts = $("#tm-opts"), app = $("#tm-app");
    const st = { lanes: "vivid", curves: "mixed", ci: "ringed", accent: 0, theme: "dark" };
    // The commit list: [lane, branch's palette colour, author or null for a merge, message, parents (rows), ci, date].
    const ROWS = [
      { col: 3, c: 3, a: "TP", m: "Oil the door hinge", p: [6], ci: "success", d: "now", label: "fix/door" },
      { col: 0, c: 0, m: "Merge pull request #24 from feature/sync", p: [2, 3], ci: "pending", d: "4 min", label: "main", head: true },
      { col: 0, c: 0, a: "MC", m: "Add a theme picker", p: [4], ci: "success", d: "1 hr" },
      { col: 2, c: 2, a: "DR", m: "Document the sync protocol", p: [10], ci: "failure", d: "2 hr", label: "feature/sync" },
      { col: 0, c: 0, m: "Merge pull request #23 from art/tavern-sign", p: [7, 5], ci: "success", d: "3 hr" },
      { col: 1, c: 1, a: "RB", m: "Sign: paint a mug of ale", p: [8], d: "5 hr" },
      { col: 3, c: 3, a: "TP", m: "Make the door creak", p: [17], ci: "pending", d: "1 day" },
      { col: 0, c: 0, a: "LF", m: "Fix the note counter", p: [9], ci: "success", d: "1 day", tag: "v0.3.0" },
      { col: 1, c: 1, a: "RB", m: "Paint the tavern sign", p: [9], d: "2 days" },
      { col: 0, c: 0, a: "PN", m: "Speed up opening notebooks", p: [12], ci: "success", d: "2 days" },
      { col: 2, c: 2, a: "SO", m: "Resolve conflicting edits", p: [11], ci: "success", d: "3 days" },
      { col: 2, c: 2, a: "SO", m: "Start the sync protocol", p: [12], d: "4 days" },
      { col: 0, c: 0, a: "LF", m: "Add a sidebar for notebooks", p: [13], d: "5 days" },
      { col: 0, c: 0, m: "Merge pull request #12 from docs/guide", p: [15, 14], ci: "success", d: "6 days", tag: "v0.2.0" },
      { col: 1, c: 4, a: "PN", m: "Write the first guide", p: [16], d: "6 days" },
      { col: 0, c: 0, a: "LF", m: "Add notebooks", p: [16], d: "7 days" },
      { col: 0, c: 0, a: "MC", m: "Choose the editor kit", p: [17], d: "8 days" },
      { col: 0, c: 0, a: "SO", m: "Sketch the app", p: [19], d: "9 days" },
      { col: 1, c: 5, a: "DR", m: "Try a canvas graph", p: [20], ci: "failure", d: "9 days" },
      { col: 0, c: 0, a: "MC", m: "Pick a name", p: [20], d: "10 days" },
      { col: 0, c: 0, a: "MC", m: "Initial commit", p: [], d: "11 days" },
    ];
    const SEL = 1;
    const icon = {
      branch: '<svg viewBox="0 0 24 24"><circle cx="6" cy="5" r="2.2"/><circle cx="6" cy="19" r="2.2"/><circle cx="18" cy="7" r="2.2"/><path d="M6 7.2v9.6M18 9.2c0 5-12 3-12 7.6"/></svg>',
      search: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>',
      fetch: '<svg viewBox="0 0 24 24"><path d="M7 18a4.5 4.5 0 0 1-.5-9A6 6 0 0 1 18 8.5a4 4 0 0 1-1 9.5"/><path d="M12 11v8m-3-3 3 3 3-3"/></svg>',
      pull: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/></svg>',
      push: '<svg viewBox="0 0 24 24"><path d="M12 20V9M7.5 13.5 12 9l4.5 4.5M5 4.5h14"/></svg>',
      sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>',
      moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.3A8.5 8.5 0 1 1 9.7 3.5a6.8 6.8 0 0 0 10.8 10.8Z"/></svg>',
    };

    // ---- The settings ----
    function row(title, text, inner) {
      const r = el("div", "tm-row", `<h4>${title}</h4><p>${text}</p>`, opts);
      r.appendChild(inner);
      return r;
    }
    const lanesBox = el("div", "tm-choices");
    lanesBox.setAttribute("role", "radiogroup"); lanesBox.setAttribute("aria-label", "Graph colours");
    Object.keys(PALETTE_NAMES).forEach((k) => {
      const b = el("button", "tm-opt", `<span class="tm-sw"></span>${PALETTE_NAMES[k]}`, lanesBox);
      b.type = "button"; b.dataset.v = k; b.setAttribute("role", "radio");
    });
    row("Graph colours", "The branches' lines and labels in the commit list.", lanesBox);
    const curvesBox = el("div", "tm-choices");
    curvesBox.setAttribute("role", "radiogroup"); curvesBox.setAttribute("aria-label", "Graph line bends");
    Object.keys(CURVES).forEach((k) => {
      const b = el("button", "tm-opt", `<svg width="40" height="30" viewBox="0 0 40 30" aria-hidden="true"></svg>${CURVES[k]}`, curvesBox);
      b.type = "button"; b.dataset.v = k; b.setAttribute("role", "radio");
    });
    row("Graph line bends", "How lines turn from one lane to another. Mixed turns smoothly to the next lane and round further.", curvesBox);
    const ciBox = el("div", "tm-choices");
    ciBox.setAttribute("role", "radiogroup"); ciBox.setAttribute("aria-label", "Checks on dots");
    Object.keys(CI_DOTS).forEach((k) => {
      const b = el("button", "tm-opt", `<svg width="40" height="30" viewBox="0 0 40 30" aria-hidden="true"></svg>${CI_DOTS[k]}`, ciBox);
      b.type = "button"; b.dataset.v = k; b.setAttribute("role", "radio");
    });
    row("Checks on dots", "How a dot shows its commit's checks: passed, failed or still running.", ciBox);
    const accBox = el("div", "tm-accs");
    accBox.setAttribute("role", "radiogroup"); accBox.setAttribute("aria-label", "Accent colour");
    ACCENTS.forEach((a, i) => {
      const b = el("button", "tm-acc", null, accBox);
      b.type = "button"; b.dataset.v = i; b.title = a.name; b.setAttribute("aria-label", a.name); b.setAttribute("role", "radio");
      b.style.setProperty("--a", a.color); b.style.setProperty("--b", a.end);
    });
    row("Accent colour", "Buttons, links and what's selected.", accBox);
    const themeBox = el("div", "seg tm-seg");
    themeBox.setAttribute("role", "radiogroup"); themeBox.setAttribute("aria-label", "Light or dark");
    [["dark", "Dark", icon.moon], ["light", "Light", icon.sun]].forEach(([v, name, ic]) => {
      const b = el("button", null, `${ic}${name}`, themeBox);
      b.type = "button"; b.dataset.v = v; b.setAttribute("role", "radio");
    });
    row("Theme", "The app in light or dark. This page stays dark.", themeBox);

    function drawIcons() {
      const pal = LANE_PALETTES[st.lanes][st.theme];
      $$(".tm-sw", lanesBox).forEach((sw, i) => {
        const k = Object.keys(PALETTE_NAMES)[i];
        sw.innerHTML = LANE_PALETTES[k][st.theme].slice(0, 7).map((c) => `<i style="background:${c}"></i>`).join("");
      });
      $$("button", curvesBox).forEach((b) => {
        const s = $("svg", b); s.innerHTML = "";
        [[2, pal[2]], [1, pal[1]]].forEach(([n, c]) => {
          const p = svg("path", { d: turnD([8, 8], [8 + n * 12, 8], [8 + n * 12, 28], 9, bendFor(b.dataset.v, 0, n)), fill: "none", "stroke-width": 2.4, "stroke-linecap": "round" }, s);
          p.style.stroke = c;
        });
        svg("path", { d: "M8 2V28", "stroke-width": 2.4, "stroke-linecap": "round" }, s).style.stroke = pal[0];
        svg("circle", { cx: 8, cy: 8, r: 3.6 }, s).style.fill = pal[0];
      });
      $$("button", ciBox).forEach((b) => {
        const s = $("svg", b); s.innerHTML = "";
        svg("path", { d: turnD([14, 13], [26, 13], [26, 28], 8, "smooth"), fill: "none", "stroke-width": 2.4, "stroke-linecap": "round" }, s).style.stroke = pal[1];
        svg("path", { d: "M14 2V28", "stroke-width": 2.4, "stroke-linecap": "round" }, s).style.stroke = pal[0];
        ciMark(s, 14, 13, 4.6, pal[0], b.dataset.v, "success", "dark", "var(--opt-bg)");
      });
    }
    function sync() {
      const acc = ACCENTS[st.accent];
      card.style.setProperty("--tm-accent", acc.color);
      const mark = (box, v, sel = "button") => $$(sel, box).forEach((b) => { const on = b.dataset.v === String(v); b.classList.toggle("on", on); b.setAttribute("aria-checked", on); });
      mark(lanesBox, st.lanes); mark(curvesBox, st.curves); mark(ciBox, st.ci); mark(accBox, st.accent); mark(themeBox, st.theme);
      drawIcons();
      drawApp();
    }

    // ---- The commit list it restyles ----
    function drawApp() {
      const look = st.theme;
      const pal = LANE_PALETTES[st.lanes][look];
      app.dataset.theme = look;
      Object.entries(accentRoles(ACCENTS[st.accent], look)).forEach(([k, v]) => app.style.setProperty(k, v));
      const bg = look === "dark" ? "#14161b" : "#ffffff", selBg = look === "dark" ? "#252b38" : "#e1e6ef";
      app.innerHTML = `<div class="tm-tools"><span class="tm-chip">${icon.branch}main</span><span class="tm-search">${icon.search}<span>Search 31 commits</span></span><span class="tm-tb">${icon.fetch}Fetch</span><span class="tm-tb">${icon.pull}Pull</span><span class="tm-push">${icon.push}Push<b>1</b></span></div>
        <div class="tm-head"><span>Branch / tag</span><span>Graph</span><span style="padding-left:8px">Message</span><span>Date</span></div><div class="tm-list"></div>`;
      const list = $(".tm-list", app);
      ROWS.forEach((r, i) => {
        const lc = pal[r.c % pal.length];
        const pills = [];
        if (r.label) pills.push(`<span class="tm-pill${r.head ? " head" : ""}" style="--lc:${lc};--on:${textOn(lc)}">${r.head ? "✓ " : ""}${r.label}</span>`);
        if (r.tag) pills.push(`<span class="tm-pill tag">${r.tag}</span>`);
        el("div", "tm-row-c" + (i === SEL ? " sel" : "") + (r.a ? "" : " merge"),
          `<span class="l">${pills.join("")}</span><span class="g"></span><span class="m">${esc(r.m).replace(/#(\d+)/, '<span class="pr">#$1</span>')}</span><span class="d">${r.d}</span>`, list);
      });
      const g0 = $(".tm-row-c .g", list);
      const gx = g0 ? g0.offsetLeft : 124;
      const RH = 28, LW = 18, corner = Math.min(RH / 2, LW) - 1;
      const X = (col) => gx + 10 + col * LW, Yr = (i) => i * RH + RH / 2;
      const H = ROWS.length * RH, Wd = gx + 10 + 4 * LW + 10;
      const s = svg("svg", { class: "tm-svg", width: Wd, height: H, viewBox: `0 0 ${Wd} ${H}` }, list);
      const edges = svg("g", null, s), nodes = svg("g", null, s);
      const line = (d, c) => { const p = svg("path", { d, class: "e" }, edges); p.style.stroke = c; };
      ROWS.forEach((r, i) => {
        r.p.forEach((pi, k) => {
          const pr = ROWS[pi];
          if (k === 0) {
            if (pr.col === r.col) line(`M${X(r.col)} ${Yr(i)}V${Yr(pi)}`, pal[r.c % pal.length]);
            else {
              // Down to the parent's row, then across into it.
              const top = Yr(pi) - RH / 2;
              line(`M${X(r.col)} ${Yr(i)}V${top}` + turnD([X(r.col), top], [X(r.col), Yr(pi)], [X(pr.col), Yr(pi)], corner, bendFor(st.curves, r.col, pr.col)).replace(/^M[^L]*/, ""), pal[r.c % pal.length]);
            }
          } else {
            // Across from the merge, then down to the merged branch.
            const bottom = Yr(i) + RH / 2;
            line(turnD([X(r.col), Yr(i)], [X(pr.col), Yr(i)], [X(pr.col), bottom], corner, bendFor(st.curves, r.col, pr.col)) + `V${Yr(pi)}`, pal[pr.c % pal.length]);
          }
        });
        if (r.label || r.tag) {
          const ln = svg("path", { d: `M${gx - 6} ${Yr(i)}H${X(r.col) - 10}`, class: "e" }, edges);
          ln.style.stroke = r.tag && !r.label ? (look === "dark" ? "#353b48" : "#c8cdd6") : pal[r.c % pal.length];
          ln.style.strokeWidth = 1; ln.style.opacity = 0.6;
        }
      });
      ROWS.forEach((r, i) => {
        const lc = pal[r.c % pal.length], x = X(r.col), y = Yr(i);
        const g = svg("g", null, nodes);
        const ringBg = i === SEL ? selBg : bg;
        // The graph as dots (Settings: "Commits on the graph"): a merge a small one; each
        // shows its checks as "Checks on dots" says.
        const rad = r.p.length > 1 ? 4.4 : 5.8;
        if (r.ci) ciMark(g, x, y, rad, lc, st.ci, r.ci, look, ringBg);
        else { svg("circle", { cx: x, cy: y, r: rad + 1.8 }, g).style.fill = ringBg; svg("circle", { cx: x, cy: y, r: rad }, g).style.fill = lc; }
        svg("title", null, g).textContent = r.a ? `${PEOPLE[r.a][0]}: ${r.m}` : r.m;
      });
    }

    const pick = (box, key, parse = (v) => v) => box.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      auto.stop();
      st[key] = parse(b.dataset.v);
      sync();
    });
    pick(lanesBox, "lanes"); pick(curvesBox, "curves"); pick(ciBox, "ci"); pick(accBox, "accent", Number); pick(themeBox, "theme");
    sync();
    let lastW = app.clientWidth;
    addEventListener("resize", () => { if (app.clientWidth !== lastW) { lastW = app.clientWidth; drawApp(); } });
    // On screen, it tries a few settings by itself, until you pick one.
    const TOUR = [["curves", "sweep"], ["lanes", "soft"], ["ci", "halo"], ["accent", 3], ["theme", "light"], ["curves", "tight"], ["lanes", "safe"], ["ci", "filled"], ["accent", 6], ["theme", "dark"], ["curves", "round"], ["ci", "beside"], ["lanes", "vivid"], ["accent", 0], ["curves", "mixed"], ["ci", "ringed"]];
    let step = 0;
    const auto = autoplay(card, async (t) => {
      for (;;) {
        await wait(2300, t);
        const [k, v] = TOUR[step++ % TOUR.length];
        st[k] = v;
        sync();
      }
    }, 0.35);
  }

  /* =========================================================
     2. Undo: three things you did, each with Undo.
     ========================================================= */
  function initUndo() {
    const card = $("#ud"), list = $("#ud-list"), stage = $("#ud-stage");
    const ACTIONS = [
      {
        id: "rebase", icon: ICON.rebase, k: "var(--l4)", time: "just now",
        title: "Rebased <code>feature/sync</code> onto <code>main</code>",
        done: "feature/sync was moved onto main. Its two commits have new ids.",
        undone: "feature/sync is back where it was, with its old ids.",
      },
      {
        id: "delete", icon: ICON.trash, k: "var(--l2)", time: "2 min ago",
        title: "Deleted branch <code>fix/door</code>",
        done: "fix/door is gone. Its two commits aren't on any branch now.",
        undone: "fix/door is back, at the same commit as before.",
      },
      {
        id: "discard", icon: ICON.discard, k: "var(--l3)", time: "5 min ago",
        title: "Discarded changes in 3 files",
        done: "Three files were put back as they were in the last commit.",
        undone: "Your changes to the three files are back.",
      },
    ];
    const state = ACTIONS.map(() => false); // undone?
    let sel = 0;
    const rows = ACTIONS.map((a, i) => {
      const li = el("li", "ud-item", null, list);
      li.style.setProperty("--k", a.k);
      li.innerHTML = `<span class="ud-ic">${a.icon}</span><span><span class="ud-t">${a.title}</span><span class="ud-s">${a.time}</span></span><button type="button" class="btn-s">${ICON.undo}<span>Undo</span></button>`;
      li.addEventListener("click", (e) => {
        auto.stop();
        if (e.target.closest("button")) toggle(i); else select(i);
      });
      return li;
    });

    // The stage: a small graph for the rebase and the branch, a file list for the discard.
    let vis = null;
    function graphStage(kind, W) {
      const RH = 36, XM = 20, XB = 46, TX = 72, H = 6 * RH;
      const Y = (r) => RH / 2 + r * RH;
      const s = svg("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": kind === "rebase" ? "A branch with two commits, moved onto main" : "A branch with two commits" });
      const lanes = svg("g", null, s), nodes = svg("g", null, s), text = svg("g", null, s);
      const brColor = kind === "rebase" ? "var(--l4)" : "var(--l3)";
      const main = [["6c1f2e8", "Add a theme picker"], ["5a91950", "Fix the note counter in the sidebar"], ["1b444ad", "Speed up opening large notebooks"], ["3e0b7c4", "Add a sidebar for notebooks"]];
      const msgs = kind === "rebase" ? ["Document the sync protocol", "Resolve conflicting edits"] : ["Oil the door hinge", "Make the door creak"];
      const ids = kind === "rebase" ? { now: ["c41e9a0", "8b2d7f3"], before: ["58454c0", "9b0e4d1"] } : { now: ["2c7a8f0", "4e1d9a2"], before: ["2c7a8f0", "4e1d9a2"] };
      const line = (d, color, cls) => { const p = svg("path", { d, class: "e" + (cls ? " " + cls : "") }, lanes); p.style.stroke = color; return p; };
      line(`M${XM} ${Y(2)}V${H + 4}`, "var(--l1)");
      const ghost = kind === "rebase" ? line(rounded([[XB, Y(0)], [XB, Y(4)], [XM, Y(4)]], 11), brColor, "ghost") : null;
      if (ghost) ghost.style.strokeDasharray = "2 6";
      const br = line("", brColor);
      const tx = (x, y, sha, msg, parent) => {
        const t = svg("text", { x, y }, parent || text);
        t.innerHTML = `<tspan class="sha">${sha}</tspan><tspan dx="10" style="fill: var(--text)">${esc(msg)}</tspan>`;
        return t;
      };
      main.forEach(([sha, m], k) => { const c = svg("circle", { cx: XM, cy: Y(k + 2), r: 7, class: "n" }, nodes); c.style.fill = "var(--l1)"; tx(TX, Y(k + 2), sha, m); });
      const side = svg("g", null, s);
      const bnodes = [0, 1].map((r) => { const c = svg("circle", { cx: XB, cy: Y(r), r: 7, class: "n" }, side); c.style.fill = brColor; return c; });
      const btext = [0, 1].map((r) => tx(TX, Y(r), "", msgs[r], side));
      const chip = (row, name, color, head) => {
        const g = svg("g", { class: "lab" }, s);
        const w = Math.round(name.length * 7.1 + (head ? 30 : 18));
        const r = svg("rect", { x: W - w, y: Y(row) - 11, width: w, height: 22, rx: 6 }, g);
        r.style.fill = head ? color : `color-mix(in srgb, ${color} 16%, var(--card))`; r.style.stroke = head ? "none" : color;
        const t = svg("text", { x: W - w + (head ? 22 : 9), y: Y(row) }, g);
        t.textContent = name;
        if (head) {
          t.style.fill = "var(--on-lane)"; t.style.fontWeight = 600;
          const ck = svg("path", { d: `M${W - w + 8} ${Y(row)}l3.5 3.5 6-7` }, g);
          ck.style.stroke = "var(--on-lane)"; ck.style.strokeWidth = 2.2; ck.style.fill = "none"; ck.style.strokeLinecap = "round"; ck.style.strokeLinejoin = "round";
        }
        return g;
      };
      chip(2, "main", "var(--l1)", true);
      const lab = chip(0, kind === "rebase" ? "feature/sync" : "fix/door", brColor, false);
      let fork = kind === "rebase" ? 2 : 4;
      const draw = () => br.setAttribute("d", rounded([[XB, Y(0)], [XB, Y(fork)], [XM, Y(fork)]], 11));
      draw();
      // Room for the messages before the labels.
      const room = (row) => (W - (row === 0 ? (kind === "rebase" ? 112 : 84) : row === 2 ? 66 : 0) - TX - 76) / 7.2;
      $$("text", s).forEach((t) => {
        const last = t.lastChild;
        if (!last || !last.textContent || t.parentNode.classList.contains("lab")) return;
        const row = Math.round((parseFloat(t.getAttribute("y")) - RH / 2) / RH);
        const max = Math.floor(room(row));
        if (last.textContent.length > max) last.textContent = last.textContent.slice(0, Math.max(6, max - 1)).trimEnd() + "…";
      });
      return {
        node: s,
        set(undone, animate) {
          const anim = animate && !RM && !!s.animate;
          btext.forEach((t, r) => {
            t.firstChild.textContent = undone ? ids.before[r] : ids.now[r];
            if (anim && kind === "rebase") t.firstChild.animate([{ fill: "var(--t4)" }, { fill: "var(--t4)", offset: 0.6 }, { fill: "var(--muted)" }], { duration: 1400 });
          });
          if (kind === "rebase") {
            const to = undone ? 4 : 2;
            if (ghost) ghost.style.opacity = undone ? 0 : 0.4;
            if (!anim) { fork = to; draw(); return; }
            const from = fork, t0 = performance.now();
            const tick = (now) => {
              const p = clamp((now - t0) / 1000, 0, 1), e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
              fork = from + (to - from) * e; draw();
              if (p < 1) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          } else {
            // Deleted: the lane fades and its label goes; undone, they come back.
            const gone = !undone;
            if (!br.animate) { br.style.opacity = gone ? 0.2 : 1; lab.style.opacity = gone ? 0 : 1; return; }
            const opts = { duration: anim ? 650 : 0, fill: "forwards", easing: "cubic-bezier(.2,.7,.2,1)" };
            br.animate([{ opacity: gone ? 0.2 : 1, strokeDasharray: gone ? "2 6" : "none" }], opts);
            bnodes.forEach((c) => c.animate([{ opacity: gone ? 0.25 : 1 }], opts));
            lab.animate([{ opacity: gone ? 0 : 1, transform: gone ? "translateX(12px)" : "none" }], opts);
            btext.forEach((t) => t.animate([{ opacity: gone ? 0.35 : 1 }], opts));
          }
        },
      };
    }
    function filesStage() {
      const ul = el("ul", "ud-files");
      [["src/sync/", "client.ts", 24, 3], ["src/sync/", "protocol.ts", 9, 12], ["docs/", "sync.md", 31, 0]].forEach(([p, nme, a, d]) => {
        el("li", null, `<span class="st">M</span><span class="nm"><span>${p}</span>${nme}</span><span class="ct"><span class="add">+${a}</span> <span class="del">−${d}</span></span>`, ul);
      });
      return { node: ul, set(undone) { ul.classList.toggle("gone", !undone); } };
    }
    function show(i, animate) {
      const a = ACTIONS[i];
      stage.innerHTML = "";
      const cap = el("div", "ud-cap", `<span>${a.id === "discard" ? "Changes" : "Graph"}</span><span>${a.id === "discard" ? "notebook" : "notebook · main"}</span>`, stage);
      cap.setAttribute("aria-hidden", "true");
      const box = el("div", "ud-vis", null, stage);
      vis = a.id === "discard" ? filesStage() : graphStage(a.id, Math.max(260, box.clientWidth));
      box.appendChild(vis.node);
      vis.set(state[i], false);
      const toast = el("div", "ud-toast" + (state[i] ? "" : " warn"), `${state[i] ? ICON.check : ICON.info}<span>${state[i] ? a.undone : a.done}</span>`, stage);
      toast.setAttribute("role", "status");
      return toast;
    }
    function select(i) {
      sel = i;
      rows.forEach((r, k) => r.classList.toggle("sel", k === i));
      show(i, false);
    }
    function toggle(i) {
      if (sel !== i) select(i);
      state[i] = !state[i];
      const li = rows[i], a = ACTIONS[i];
      li.classList.toggle("undone", state[i]);
      $(".ud-s", li).textContent = state[i] ? "Undone just now" : a.time;
      $("button", li).innerHTML = state[i] ? `${ICON.redo}<span>Redo</span>` : `${ICON.undo}<span>Undo</span>`;
      vis.set(state[i], true);
      const toast = $(".ud-toast", stage);
      toast.className = "ud-toast bump" + (state[i] ? "" : " warn");
      toast.innerHTML = `${state[i] ? ICON.check : ICON.info}<span>${state[i] ? a.undone : a.done}</span>`;
    }
    select(0);
    let lastW = stage.clientWidth;
    addEventListener("resize", () => { if (stage.clientWidth !== lastW) { lastW = stage.clientWidth; show(sel); } });
    const auto = autoplay(card, async (t) => {
      for (;;) {
        for (let i = 0; i < ACTIONS.length; i++) {
          if (state[i]) continue;
          select(i);
          await wait(1500, t);
          const b = $("button", rows[i]);
          b.classList.add("press");
          await wait(160, t);
          b.classList.remove("press");
          toggle(i);
          await wait(2600, t);
        }
        await wait(1200, t);
        ACTIONS.forEach((a, i) => { if (state[i]) { sel = i; show(i); toggle(i); } });
        select(0);
      }
    });
    card.addEventListener("keydown", () => auto.stop());
  }

  /* =========================================================
     3. Art: the demo's tavern sign and coin, painted with the
        same code as the demo repository, before and after.
     ========================================================= */
  function sign(mug) {
    return (x, y) => {
      const frameEdge = x < 10 || y < 10 || x > 245 || y > 245;
      if (frameEdge) return [46, 30, 20, 255];
      const seam = ((y % 59) + 59) % 59 < 3;
      const grain = Math.sin(x / 9 + Math.sin(y / 23) * 3) * 14 + Math.sin(y * 1.7) * 6;
      let [r, g, b] = seam ? [70, 44, 28] : [150 + grain, 98 + grain * 0.7, 56 + grain * 0.4];
      if (Math.hypot(x - 84, y - 128) < 34) [r, g, b] = [178, 42, 36];
      if (mug) {
        const body = x >= 150 && x <= 196 && y >= 104 && y <= 172;
        const foam = x >= 146 && x <= 200 && y >= 90 && y < 104 && Math.sin(x / 4) * 4 + 98 < y + 6;
        const handle = Math.abs(Math.hypot(x - 198, y - 136) - 16) < 5 && x > 198;
        if (foam) [r, g, b] = [246, 240, 222];
        else if (body) [r, g, b] = x < 158 || x > 188 ? [196, 128, 24] : [232, 166, 38];
        else if (handle) [r, g, b] = [196, 128, 24];
      }
      return [r, g, b, 255].map((v) => clamp(Math.round(v), 0, 255));
    };
  }
  function coin(shiny) {
    const [r, g, b] = shiny ? [255, 196, 46] : [168, 112, 62];
    return (x, y) => {
      const dx = x - 47.5, dy = y - 47.5, distance = Math.hypot(dx, dy);
      const alpha = clamp(44 - distance, 0, 1);
      if (alpha === 0) return [0, 0, 0, 0];
      let light = 1 - (dx + dy) / 160 - (distance > 37 ? 0.25 : 0);
      if (shiny) light += Math.max(0, 0.6 - Math.hypot(dx + 16, dy + 16) / 14);
      if (Math.abs(dx) < 4 && Math.abs(dy) < 18 && distance < 37) light -= 0.3;
      const shade = (c) => clamp(Math.round(c * light), 0, 255);
      return [shade(r), shade(g), shade(b), Math.round(alpha * 255)];
    };
  }
  /** Paints `paint` (defined on a `units` × `units` grid) into a canvas, smoothed by 3 × 3 samples. */
  function paintCanvas(canvas, units, paint) {
    const S = canvas.width, ctx = canvas.getContext("2d"), img = ctx.createImageData(S, S), d = img.data;
    const k = units / S, N = 3;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
          const p = paint((x + (i + 0.5) / N) * k - 0.5, (y + (j + 0.5) / N) * k - 0.5);
          const w = p[3] / 255; r += p[0] * w; g += p[1] * w; b += p[2] * w; a += p[3];
        }
        const o = (y * S + x) * 4, wa = a / 255;
        d[o] = wa ? r / wa : 0; d[o + 1] = wa ? g / wa : 0; d[o + 2] = wa ? b / wa : 0; d[o + 3] = a / (N * N);
      }
    }
    ctx.putImageData(img, 0, 0);
    return img;
  }
  function initArt() {
    const card = $("#ad"), view = $("#ad-view"), handle = $("#ad-handle"), op = $("#ad-opacity");
    const [cb, ca, cd] = ["before", "after", "diff"].map((k) => $(".ad-" + k, view));
    const caption = $("#ad-caption"), who = $("#ad-who");
    const ART = {
      sign: { units: 256, before: sign(false), after: sign(true), who: "RB", msg: "Sign: paint a mug of ale next to the mark" },
      coin: { units: 96, before: coin(false), after: coin(true), who: "RB", msg: "Shinier coins for the tip jar" },
    };
    let mode = "swipe", pos = 50, cur = null;
    const setPos = (p) => { pos = clamp(p, 0, 100); view.style.setProperty("--pos", pos + "%"); handle.setAttribute("aria-valuenow", Math.round(pos)); };
    function load(name) {
      cur = name;
      const A = ART[name];
      const b = paintCanvas(cb, A.units, A.before), a = paintCanvas(ca, A.units, A.after);
      // The changed pixels: lit up over a dimmed, grey copy of the new picture.
      const ctx = cd.getContext("2d"), img = ctx.createImageData(cd.width, cd.height), d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const diff = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) + Math.abs(a.data[i + 3] - b.data[i + 3]);
        if (diff > 24) { d[i] = 255; d[i + 1] = 45; d[i + 2] = 146; d[i + 3] = 255; }
        else {
          const l = (a.data[i] * 0.3 + a.data[i + 1] * 0.59 + a.data[i + 2] * 0.11) * 0.42 + 18;
          d[i] = d[i + 1] = d[i + 2] = l; d[i + 3] = a.data[i + 3];
        }
      }
      ctx.putImageData(img, 0, 0);
      // The numbers the app shows, counted on the real pixels.
      let count = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let y = 0; y < A.units; y++) for (let x = 0; x < A.units; x++) {
        const p = A.before(x, y), q = A.after(x, y);
        if (p[0] !== q[0] || p[1] !== q[1] || p[2] !== q[2] || p[3] !== q[3]) { count++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      }
      const pct = ((count / (A.units * A.units)) * 100).toFixed(1);
      caption.innerHTML = `<b>${count.toLocaleString("en")} pixels changed</b> (${pct}%), in a ${x1 - x0 + 1} × ${y1 - y0 + 1} area at ${x0}, ${y0}.`;
      who.innerHTML = `${avatar(A.who)}<span><b>${PEOPLE[A.who][0]}</b> · ${esc(A.msg)}</span>`;
      $$(".ad-size", card).forEach((s) => (s.textContent = `${A.units} × ${A.units}`));
      $$(".ad-files button", card).forEach((bt) => { const on = bt.dataset.art === name; bt.classList.toggle("on", on); bt.setAttribute("aria-selected", on); });
    }
    function setMode(m) {
      mode = m;
      view.dataset.mode = m; card.dataset.mode = m;
      $$(".ad-modes button", card).forEach((bt) => { const on = bt.dataset.mode === m; bt.classList.toggle("on", on); bt.setAttribute("aria-checked", on); });
    }
    $$(".ad-modes button", card).forEach((bt) => bt.addEventListener("click", () => { auto.stop(); setMode(bt.dataset.mode); }));
    $$(".ad-files button", card).forEach((bt) => bt.addEventListener("click", () => { auto.stop(); load(bt.dataset.art); }));
    op.addEventListener("input", () => { auto.stop(); view.style.setProperty("--op", op.value / 100); });
    let dragging = false;
    const fromEvent = (e) => { const r = view.getBoundingClientRect(); setPos(((e.clientX - r.left) / r.width) * 100); };
    view.addEventListener("pointerdown", (e) => {
      if (mode !== "swipe") return;
      auto.stop(); dragging = true; handle.classList.add("drag");
      view.setPointerCapture(e.pointerId); fromEvent(e); e.preventDefault();
    });
    view.addEventListener("pointermove", (e) => { if (dragging) fromEvent(e); });
    const end = () => { dragging = false; handle.classList.remove("drag"); };
    view.addEventListener("pointerup", end); view.addEventListener("pointercancel", end);
    handle.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 10 : 2;
      const k = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step }[e.key];
      if (k) { auto.stop(); setPos(pos + k); e.preventDefault(); }
      if (e.key === "Home") { setPos(0); e.preventDefault(); }
      if (e.key === "End") { setPos(100); e.preventDefault(); }
    });
    setMode("swipe"); setPos(50);
    load("sign");
    view.style.setProperty("--op", op.value / 100);
    // Once on screen, the line sweeps across to show what it does.
    const sweep = (to, ms, t) => new Promise((res, rej) => {
      const from = pos, t0 = performance.now();
      const tick = (now) => {
        if (!t.alive) return rej(new Error("stop"));
        const p = clamp((now - t0) / ms, 0, 1), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        setPos(from + (to - from) * e);
        p < 1 ? requestAnimationFrame(tick) : res();
      };
      requestAnimationFrame(tick);
    });
    const auto = autoplay(card, async (t) => {
      await wait(500, t);
      await sweep(22, 1100, t); await wait(250, t);
      await sweep(78, 1500, t); await wait(250, t);
      await sweep(50, 1000, t);
      await wait(1600, t);
      setMode("pixels");
      await wait(3200, t);
      setMode("swipe");
      auto.stop();
    }, 0.45);
  }

  /* =========================================================
     3b. Models: the demo's stool (tools/preview/demo.mjs), before
         and after it got a back, in two views that turn together.
         Drawn with a small z-buffer, so what's behind stays behind
         at every angle.
     ========================================================= */
  function stoolParts(back) {
    const legs = [-0.35, 0.35].flatMap((x) => [-0.35, 0.35].map((z) => [x, 0.4, z, 0.08, 0.8, 0.08]));
    const parts = [[0, 0.84, 0, 0.9, 0.08, 0.9], ...legs];
    if (back) parts.push([0, 1.35, -0.41, 0.9, 0.9, 0.08], [-0.35, 1.05, -0.41, 0.08, 0.5, 0.08], [0.35, 1.05, -0.41, 0.08, 0.5, 0.08]);
    return parts;
  }
  const BOX_FACES = [
    [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
    [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
    [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
    [[0, -1, 0], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]]],
    [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
    [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
  ];
  function modelOf(parts) {
    const faces = [];
    parts.forEach(([x, y, z, w, h, d]) => BOX_FACES.forEach(([n, cs]) => faces.push({ n, pts: cs.map(([a, b, c]) => [x + (a * w) / 2, y + (b * h) / 2, z + (c * d) / 2]) })));
    const all = faces.flatMap((f) => f.pts), min = [0, 1, 2].map((k) => Math.min(...all.map((p) => p[k]))), max = [0, 1, 2].map((k) => Math.max(...all.map((p) => p[k])));
    const size = max.map((v, k) => +(v - min[k]).toFixed(2));
    return { faces, all, stats: { Meshes: 1, Vertices: faces.length * 4, Triangles: faces.length * 2, Materials: 1, Size: size.map(String).join(" × ") } };
  }
  /** Colours packed for a Uint32Array over ImageData (little-endian: ABGR). */
  const pack = (r, g, b, a = 255) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;

  function initModel() {
    const card = $("#md"), A = $("#md-a"), B = $("#md-b"), wire = $("#md-wire"), stats = $("#md-stats"), who = $("#md-who");
    if (!card) return;
    const models = [modelOf(stoolParts(false)), modelOf(stoolParts(true))];
    const keys = Object.keys(models[0].stats);
    stats.innerHTML = `<thead><tr><th></th><td>Before</td><td>After</td></tr></thead><tbody>${keys.map((k) => {
      const [a, b] = models.map((m) => m.stats[k]);
      return `<tr><th>${k}</th><td>${a}</td><td${String(a) === String(b) ? "" : ' class="ch"'}>${b}</td></tr>`;
    }).join("")}</tbody>`;
    who.innerHTML = `${avatar("RB")}<span><b>Rosa Bell</b> · A slower door with a longer creak, and a stool with a back</span>`;
    // Both views are framed by the larger model's bounding sphere, so they share one scale,
    // and the sphere looks the same from every side: nothing leaves the view as it turns.
    const pts = models.flatMap((m) => m.all);
    const lo = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k]))), hi = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])));
    const centre = lo.map((v, k) => (v + hi[k]) / 2);
    const RADIUS = Math.max(...pts.map((p) => Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2])));
    const DIST = RADIUS * 3.4, MARGIN = 0.12;
    let yaw = -0.7, pitch = 0.36;
    const BASE = [205, 172, 138];
    const LIGHT = (() => { const v = [0.45, 0.8, 0.55], l = Math.hypot(...v); return v.map((c) => c / l); })();
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const norm = (a) => { const l = Math.hypot(...a); return a.map((c) => c / l); };
    const views = [A, B].map((canvas, i) => ({ canvas, model: models[i], off: document.createElement("canvas"), buf: null }));

    function camera(w, h) {
      const eye = [centre[0] + DIST * Math.cos(pitch) * Math.sin(yaw), centre[1] + DIST * Math.sin(pitch), centre[2] + DIST * Math.cos(pitch) * Math.cos(yaw)];
      const f = norm(sub(centre, eye)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
      // The sphere's outline is a circle of this radius on screen: (1 - 2 × margin) of the view.
      const focal = ((0.5 - MARGIN) * Math.min(w, h) * Math.sqrt(DIST * DIST - RADIUS * RADIUS)) / RADIUS;
      const cx = w / 2, cy = h / 2;
      const proj = (p) => { const v = sub(p, eye), z = dot(v, f); return [cx + (dot(v, r) * focal) / z, cy - (dot(v, u) * focal) / z, 1 / z]; };
      return { eye, proj };
    }
    // Fills a triangle of screen points [x, y, 1/z], nearest wins.
    function tri(s, a, b, c, col) {
      const { W, H, px, zb } = s;
      const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(area) < 1e-9) return;
      const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      const inv = 1 / area;
      for (let y = y0; y <= y1; y++) {
        const py = y + 0.5;
        for (let x = x0; x <= x1; x++) {
          const qx = x + 0.5;
          const w0 = ((b[0] - qx) * (c[1] - py) - (b[1] - py) * (c[0] - qx)) * inv;
          if (w0 < -1e-7) continue;
          const w1 = ((c[0] - qx) * (a[1] - py) - (c[1] - py) * (a[0] - qx)) * inv;
          if (w1 < -1e-7) continue;
          const w2 = 1 - w0 - w1;
          if (w2 < -1e-7) continue;
          const iz = w0 * a[2] + w1 * b[2] + w2 * c[2], i = y * W + x;
          if (iz > zb[i]) { zb[i] = iz; px[i] = col; }
        }
      }
    }
    // An edge, drawn where it's in front (or on) what's there, faintly where it's behind.
    function edge(s, a, b, col, behind) {
      const { W, H, px, zb } = s;
      const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
      const t = s.thick;
      for (let k = 0; k <= n; k++) {
        const u = k / n, x = Math.floor(a[0] + dx * u - t / 2), y = Math.floor(a[1] + dy * u - t / 2), iz = a[2] + (b[2] - a[2]) * u;
        for (let oy = 0; oy < t; oy++) for (let ox = 0; ox < t; ox++) {
          const X = x + ox, Y = y + oy;
          if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
          const i = Y * W + X, seen = iz >= zb[i] * (1 - 0.004);
          if (seen === !behind) px[i] = col;
        }
      }
    }
    function draw(view) {
      const { canvas, model, off } = view;
      const dpr = Math.min(2, devicePixelRatio || 1);
      const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
      if (!w || !h) return;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      // Rendered a little larger than the canvas and scaled down, for smooth edges.
      const S = clamp(Math.sqrt(1.7e6 / (w * h)), 1, 2), W = Math.round(w * S), H = Math.round(h * S);
      if (!view.buf || view.buf.W !== W || view.buf.H !== H) {
        off.width = W; off.height = H;
        const img = off.getContext("2d").createImageData(W, H);
        view.buf = { W, H, img, px: new Uint32Array(img.data.buffer), zb: new Float32Array(W * H), thick: Math.max(1, Math.round(S * 1.25)) };
      }
      const s = view.buf, ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, w, h);
      const cam = camera(w, h);
      // The floor: a grid fading out, and the stool's soft shadow.
      ctx.lineWidth = dpr;
      for (let i = -6; i <= 6; i++) {
        const k = i * 0.25;
        [[[k, 0, -1.5], [k, 0, 1.5]], [[-1.5, 0, k], [1.5, 0, k]]].forEach(([a, b]) => {
          const pa = cam.proj(a), pb = cam.proj(b);
          ctx.strokeStyle = `rgba(255,255,255,${0.07 - Math.abs(i) * 0.008})`;
          ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
        });
      }
      const shadow = [[-0.55, 0, -0.55], [0.55, 0, -0.55], [0.55, 0, 0.55], [-0.55, 0, 0.55]].map(cam.proj);
      ctx.fillStyle = "rgba(0,0,0,.28)";
      ctx.filter = `blur(${8 * dpr}px)`;
      ctx.beginPath(); shadow.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill();
      ctx.filter = "none";
      // The model, into the z-buffer: each face lit by how it faces the light.
      s.px.fill(0); s.zb.fill(0);
      const wf = wire.checked, scaled = (p) => [p[0] * S, p[1] * S, p[2]];
      const faces = model.faces.map((fc) => ({ fc, p: fc.pts.map((q) => scaled(cam.proj(q))), facing: dot(fc.n, sub(cam.eye, fc.pts[0])) > 0 }));
      faces.forEach(({ fc, p, facing }) => {
        if (!facing) return;
        let col;
        if (wf) col = pack(236, 214, 190, 18);
        else {
          const lit = 0.46 + 0.54 * Math.max(0, dot(fc.n, LIGHT)) - (fc.n[1] < 0 ? 0.08 : 0);
          col = pack(...BASE.map((c) => Math.round(clamp(c * lit, 0, 255))));
        }
        tri(s, p[0], p[1], p[2], col);
        tri(s, p[0], p[2], p[3], col);
      });
      if (wf) {
        // Every triangle's edges: behind first, faintly, then what's in view over them.
        const faint = pack(236, 214, 190, 60), bright = pack(240, 222, 200, 240);
        [true, false].forEach((behind) => faces.forEach(({ p }) => {
          [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]].forEach(([i, j]) => edge(s, p[i], p[j], behind ? faint : bright, behind));
        }));
      }
      off.getContext("2d").putImageData(s.img, 0, 0);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      ctx.drawImage(off, 0, 0, w, h);
    }
    const drawBoth = () => { views.forEach(draw); card.dataset.yaw = (((yaw * 180) / Math.PI) % 360).toFixed(2); };
    let dragging = null;
    [A, B].forEach((cv) => {
      cv.addEventListener("pointerdown", (e) => { auto.stop(); dragging = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); cv.classList.add("drag"); e.preventDefault(); });
      cv.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        yaw -= (e.clientX - dragging.x) * 0.011;
        pitch = clamp(pitch + (e.clientY - dragging.y) * 0.008, 0.08, 1.15);
        dragging = { x: e.clientX, y: e.clientY };
        drawBoth();
      });
      const end = () => { dragging = null; cv.classList.remove("drag"); };
      cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
      cv.tabIndex = 0;
      cv.addEventListener("keydown", (e) => {
        const k = { ArrowLeft: [0.12, 0], ArrowRight: [-0.12, 0], ArrowUp: [0, -0.08], ArrowDown: [0, 0.08] }[e.key];
        if (!k) return;
        auto.stop(); yaw += k[0]; pitch = clamp(pitch + k[1], 0.08, 1.15); drawBoth(); e.preventDefault();
      });
    });
    wire.addEventListener("change", () => { auto.stop(); drawBoth(); });
    addEventListener("resize", drawBoth);
    drawBoth();
    // On screen, they turn slowly together until you take hold of one.
    const auto = autoplay(card, async (t) => {
      let lastT = performance.now();
      for (;;) {
        await new Promise((res) => requestAnimationFrame(res));
        if (!t.alive) throw new Error("stop");
        const now = performance.now();
        yaw += Math.min(0.05, (now - lastT) / 1000) * 0.45; lastT = now;
        drawBoth();
      }
    }, 0.25);
  }

  /* =========================================================
     4. Big files: Git LFS downloads, and locks.
     ========================================================= */
  function initBigFiles() {
    const card = $("#lfs"), ul = $("#lfs-files"), head = $("#lfs-head"), left = $("#lfs-left"), bar = $("#lfs-bar"), total = $("#lfs-total");
    const FILES = [
      ["Tavern.umap", "Content/Maps", 1240, "var(--kind-levels)", ICON.map, 44],
      ["DoorOpen.webm", "Content/Cinematics", 688, "var(--l5)", ICON.film, 51],
      ["Barber.uasset", "Content/Characters", 412, "var(--kind-art)", ICON.cube, 39],
      ["T_TavernSign.tga", "Content/Textures", 96, "var(--l2)", ICON.image, 47],
      ["DoorCreak.wav", "Content/Audio", 48, "var(--kind-audio)", ICON.music, 42],
    ].map(([n, p, mb, k, ic, speed]) => ({ n, p, mb, k, ic, speed, got: 0 }));
    const SUM = FILES.reduce((s, f) => s + f.mb, 0);
    const size = (mb) => (mb >= 1000 ? (mb / 1024).toFixed(2) + " GB" : Math.round(mb) + " MB");
    const secs = (s) => (s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.max(1, Math.round(s))} s`);
    total.textContent = `${FILES.length} files · ${size(SUM)}`;
    FILES.forEach((f) => {
      f.li = el("li", null, `<span class="fi">${f.ic}</span><span class="nm">${f.n}<span>${f.p}</span></span><span class="rt"></span><span class="bar"><i></i></span>`, ul);
      f.li.style.setProperty("--k", f.k);
      f.rt = $(".rt", f.li); f.bar = $(".bar i", f.li);
    });
    const PAR = 3, SCALE = 2.4;
    let elapsed = 0;
    function draw() {
      let got = 0, active = 0;
      FILES.forEach((f) => {
        got += f.got;
        const done = f.got >= f.mb;
        f.li.classList.toggle("done", done);
        f.bar.style.width = (f.got / f.mb) * 100 + "%";
        if (done) { f.rt.className = "rt done"; f.rt.textContent = `✓ ${size(f.mb)}`; }
        else if (f.running) { active++; f.rt.className = "rt"; f.rt.textContent = `${f.cur} MB/s · ${secs((f.mb - f.got) / f.cur)} left`; }
        else { f.rt.className = "rt"; f.rt.textContent = `Waiting · ${size(f.mb)}`; }
      });
      bar.style.width = (got / SUM) * 100 + "%";
      const nDone = FILES.filter((f) => f.got >= f.mb).length;
      if (nDone === FILES.length) { head.textContent = `All ${FILES.length} big files are here`; left.textContent = `in ${secs(elapsed)}`; }
      else {
        head.textContent = `Downloading ${FILES.length} big files · ${nDone} done`;
        const rate = FILES.filter((f) => f.running).reduce((s, f) => s + f.cur, 0) || 1;
        left.textContent = `${size(got)} of ${size(SUM)} · ${secs((SUM - got) / rate)} left`;
      }
    }
    function reset() { elapsed = 0; FILES.forEach((f) => { f.got = 0; f.running = false; }); draw(); }
    function finish() { FILES.forEach((f) => { f.got = f.mb; f.running = false; }); elapsed = 19; draw(); }
    function tick(dt) {
      elapsed += dt;
      let running = FILES.filter((f) => f.running && f.got < f.mb);
      FILES.forEach((f) => { if (running.length < PAR && !f.running && f.got < f.mb) { f.running = true; running.push(f); } });
      running.forEach((f) => {
        f.cur = Math.round(f.speed * (0.9 + Math.random() * 0.2));
        f.got = Math.min(f.mb, f.got + f.cur * dt);
        if (f.got >= f.mb) f.running = false;
      });
    }
    if (RM) finish(); else reset();
    autoplay(card, async (t) => {
      for (;;) {
        if (FILES.every((f) => f.got >= f.mb)) { await wait(3800, t); reset(); await wait(700, t); }
        while (FILES.some((f) => f.got < f.mb)) { await wait(160, t); tick(0.16 * SCALE); draw(); }
      }
    }, 0.35);

    // Locks.
    const lcard = $("#locks"), list = $("#lock-list"), note = $("#lock-note"), count = $("#lock-count");
    const ME = "me";
    const LOCKS = [
      ["Barber.uasset", "Content/Characters", "var(--kind-art)", ICON.cube, ME],
      ["Tavern.umap", "Content/Maps", "var(--kind-levels)", ICON.map, "RB"],
      ["MainMenu.uasset", "Content/UI", "var(--kind-art)", ICON.cube, "TP"],
      ["Chair.uasset", "Content/Props", "var(--kind-art)", ICON.cube, null],
      ["DoorCreak.wav", "Content/Audio", "var(--kind-audio)", ICON.music, null],
    ].map(([n, p, k, ic, by]) => ({ n, p, k, ic, by }));
    const DEFAULT_NOTE = `${ICON.info}<span>Nobody else can change a locked file until it's unlocked. Yours are unlocked when you submit them.</span>`;
    note.innerHTML = DEFAULT_NOTE;
    function lockCell(f) {
      if (!f.by) return `<button type="button" class="btn-s lock-btn">${ICON.lock}<span>Lock</span></button>`;
      if (f.by === ME) return `<button type="button" class="lock-chip me" style="--a: var(--l1)" title="Unlock"><span class="av" style="--a: var(--l1)">${ICON.user}</span>Locked by you</button>`;
      return `<span class="lock-chip" style="--a: ${PEOPLE[f.by][1]}">${avatar(f.by, 24)}Locked by ${PEOPLE[f.by][0].split(" ")[0]}</span>`;
    }
    function drawLocks() {
      list.innerHTML = "";
      LOCKS.forEach((f, i) => {
        const li = el("li", null, `<span class="fi">${f.ic}</span><span style="min-width:0"><div class="nm">${f.n}</div><div class="pt">${f.p}</div></span>${lockCell(f)}`, list);
        li.style.setProperty("--k", f.k);
        li.dataset.i = i;
        f.li = li;
      });
      count.textContent = `${LOCKS.filter((f) => f.by).length} locked`;
    }
    drawLocks();
    list.addEventListener("click", (e) => {
      const li = e.target.closest("li");
      if (!li) return;
      const f = LOCKS[li.dataset.i];
      if (e.target.closest(".lock-btn")) {
        f.by = ME; drawLocks();
        note.innerHTML = `${ICON.lock}<span>You locked <b>${f.n}</b>. Your team sees it at once.</span>`;
      } else if (e.target.closest(".lock-chip.me")) {
        f.by = null; drawLocks();
        note.innerHTML = `${ICON.unlock}<span>You unlocked <b>${f.n}</b>.</span>`;
      } else if (f.by && f.by !== ME) {
        const nm = PEOPLE[f.by][0];
        note.innerHTML = `${ICON.info}<span>${nm} is working on <b>${f.n}</b>. You can look at it, but ask ${nm.split(" ")[0]} before you change it.</span>`;
      }
    });
    if (!RM) {
      let remote = false;
      onVisible(lcard, () => {
        if (remote) return;
        remote = true;
        setTimeout(() => {
          const f = LOCKS[4];
          if (f.by) return;
          f.by = "DR"; drawLocks();
          f.li.classList.add("flash");
          note.innerHTML = `${ICON.lock}<span><b>Diego Ramos</b> just locked <b>${f.n}</b>.</span>`;
        }, 2600);
      }, null, 0.5);
    }
  }

  /* =========================================================
     5. A pull request: each check a stream flowing into one
        river (the app's CheckTributaries), its timeline below.
     ========================================================= */
  const TONE_COLOUR = { success: "var(--check-success)", failure: "var(--check-failure)", pending: "var(--check-pending)" };
  const mixing = () => "oklch";
  /** The colours of `states` mixed in proportion, as CSS. */
  function blendTones(states) {
    let colour = null, total = 0;
    for (const tone of ["success", "pending", "failure"]) {
      const count = states.filter((s) => s === tone).length;
      if (!count) continue;
      total += count;
      colour = colour ? `color-mix(in ${mixing(tone)}, ${TONE_COLOUR[tone]} ${Math.round((count / total) * 100)}%, ${colour})` : TONE_COLOUR[tone];
    }
    return colour;
  }
  const smoothstep = (t) => t * t * (3 - 2 * t);
  let tribsIds = 0;
  /**
   * The checks as streams into a river (the app's CheckTributaries), built once for `n`
   * checks at the box's width. Each check keeps its stream for good: when it changes, only
   * its colour and dash change in place, and the river's colour blends over; nothing moves.
   */
  function buildTributaries(box, n) {
    const width = Math.max(160, Math.round(box.clientWidth));
    const height = Math.min(160, Math.max(96, 24 + n * 9)), middle = height / 2;
    const confluence = Math.round(width * 0.66), riverEnd = width - 4, WAVE = 2.5;
    const wide = n === 1 ? WAVE : Math.min(5.5, WAVE + (n - 1) * 0.4);
    const arrival = (i) => (n === 1 ? middle : middle - (wide - WAVE) / 2 + (i * (wide - WAVE)) / (n - 1));
    const wave = (i) => {
      const start = n === 1 ? middle : 12 + (i * (height - 24)) / (n - 1), end = arrival(i), phase = i * 1.1;
      return (x) => { const s = smoothstep(Math.min(1, x / confluence)); return start + (end - start) * s + 7 * (1 - s) * Math.sin((2 * Math.PI * x) / 190 + phase); };
    };
    const leadIn = 18, narrowFrom = confluence + (riverEnd - confluence) * 0.45;
    const along = (x, a, b) => smoothstep(clamp((x - a) / (b - a), 0, 1));
    // The river's shape: from every stream, whatever becomes of them, so it never changes.
    const half = (x) => (x < confluence ? (wide / 2) * along(x, confluence - leadIn, confluence) : (wide / 2) * (1 - 0.6 * along(x, narrowFrom, riverEnd)));
    const edges = (x) => {
      if (x >= confluence) return [middle - half(x), middle + half(x)];
      const ys = Array.from({ length: n }, (_, i) => wave(i)(x)), k = along(x, confluence - leadIn, confluence);
      const t = Math.min(...ys) - WAVE / 2, b = Math.max(...ys) + WAVE / 2;
      return [t + (middle - wide / 2 - t) * k, b + (middle + wide / 2 - b) * k];
    };
    const xs = [];
    for (let x = confluence - leadIn; x < confluence; x += 2) xs.push(x);
    for (let x = confluence; x < riverEnd; x += 6) xs.push(x);
    xs.push(riverEnd);
    const riverD = `M${xs.map((x) => `${x} ${edges(x)[0].toFixed(2)}`).join(" L")} L${[...xs].reverse().map((x) => `${x} ${edges(x)[1].toFixed(2)}`).join(" L")} Z`;
    const dryX = confluence * 0.72;
    // Each stream's course: its wave to where they meet, then on through the river. Its length
    // is measured along the wave (pathLength 100 to the river), so dashes keep their size.
    const course = (i) => {
      const y = wave(i), pts = [];
      for (let x = 0; x < confluence; x += 4) pts.push([x, y(x)]);
      pts.push([confluence, arrival(i)]);
      const seg = (k) => Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
      let waveLength = 0, toDry = 0;
      for (let k = 0; k < pts.length - 1; k++) { const l = seg(k); waveLength += l; if (pts[k + 1][0] <= dryX) toDry += l; }
      const toD = (list) => list.map(([x, yy], j) => `${j ? "L" : "M"}${x} ${yy.toFixed(2)}`).join(" ");
      const shore = toD(pts), before = pts.length;
      const onward = (x) => middle + (arrival(i) - middle) * (1 - along(x, narrowFrom, riverEnd));
      for (let x = confluence + 6; x < riverEnd; x += 6) pts.push([x, onward(x)]);
      pts.push([riverEnd, onward(riverEnd)]);
      let rest = 0;
      for (let k = before - 1; k < pts.length - 1; k++) rest += seg(k);
      return { shore, whole: toD(pts), length: (100 * (waveLength + rest)) / waveLength, dry: (100 * toDry) / waveLength, dryY: y(dryX) };
    };
    const id = "tr" + ++tribsIds;
    const at01 = (x) => clamp(x / riverEnd, 0, 1);
    const onRiver = (o) => at01(confluence + (riverEnd - confluence) * o);
    const box4 = (x, y, w, h) => `x="${x}" y="${y}" width="${w}" height="${h}"`;
    const lx = confluence - leadIn;
    let defs = `<linearGradient id="${id}-c" gradientUnits="userSpaceOnUse" x1="${confluence}" y1="${middle}" x2="${riverEnd}" y2="${middle}"><stop offset="0"/><stop offset=".12"/><stop offset=".24"/><stop offset=".36" style="stop-color:var(--river)"/></linearGradient>
      <linearGradient id="${id}-mouth" gradientUnits="userSpaceOnUse" x1="${confluence}" y1="${middle}" x2="${riverEnd}" y2="${middle}"><stop offset=".3" stop-color="#fff"/><stop offset=".45" stop-color="#fff" stop-opacity=".75"/><stop offset=".58" stop-color="#fff" stop-opacity=".45"/><stop offset=".7" stop-color="#fff" stop-opacity=".2"/><stop offset=".8" stop-color="#fff" stop-opacity=".07"/><stop offset=".9" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <linearGradient id="${id}-rising" gradientUnits="userSpaceOnUse" x1="${lx}" y1="0" x2="${confluence}" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff"/></linearGradient>
      <mask id="${id}-rise" maskUnits="userSpaceOnUse" ${box4(lx - 8, -8, riverEnd - lx + 16, height + 16)}><rect ${box4(lx - 8, -8, riverEnd - lx + 16, height + 16)} fill="url(#${id}-rising)"/></mask>
      <linearGradient id="${id}-glowing" gradientUnits="userSpaceOnUse" x1="${lx}" y1="0" x2="${confluence + (riverEnd - confluence) * 0.25}" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".35" stop-color="#fff" stop-opacity=".15"/><stop offset=".7" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="#fff"/></linearGradient>
      <mask id="${id}-glow" maskUnits="userSpaceOnUse" ${box4(lx - 16, -16, riverEnd - lx + 32, height + 32)}><rect ${box4(lx - 16, -16, riverEnd - lx + 32, height + 32)} fill="url(#${id}-glowing)"/></mask>
      <mask id="${id}-flowing" maskUnits="userSpaceOnUse" ${box4(-8, -8, width + 16, height + 16)}><rect ${box4(-8, -8, width + 16, height + 16)} fill="url(#${id}-mouth)"/></mask>
      <mask id="${id}-fade" maskUnits="userSpaceOnUse" ${box4(lx - 12, 0, riverEnd - lx + 24, height)}><rect ${box4(lx - 12, 0, riverEnd - lx + 24, height)} fill="url(#${id}-mouth)"/></mask>`;
    const courses = Array.from({ length: n }, (_, i) => course(i));
    courses.forEach((_, i) => {
      defs += `<linearGradient id="${id}-w${i}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${riverEnd}" y2="0"><stop offset="${at01(confluence - Math.round(confluence * 0.3))}"/><stop offset="${at01(confluence)}"/><stop offset="${onRiver(0.12)}"/><stop offset="${onRiver(0.24)}"/><stop offset="${onRiver(0.36)}" style="stop-color:var(--river)"/></linearGradient>`;
    });
    let body = `<g mask="url(#${id}-fade)"><g mask="url(#${id}-glow)"><path class="tribs-river-glow" d="${riverD}" fill="url(#${id}-c)"/></g><path d="${riverD}" fill="url(#${id}-c)" mask="url(#${id}-rise)"/>`;
    body += `<path class="tribs-river-flow" d="M${confluence} ${middle} L${riverEnd} ${middle}"/>`;
    body += `<path class="tribs-river-sweep" d="M${confluence} ${middle} L${riverEnd} ${middle}" pathLength="100" style="animation-delay:${1900 + n * 90}ms"/></g>`;
    courses.forEach((c, i) => {
      const L = c.length.toFixed(2), D = c.dry.toFixed(2);
      body += `<g class="tribs-s pending queued" style="--length:${L};--dry:${D}">`
        + `<path class="tribs-ghost" d="${c.whole}" pathLength="${L}" mask="url(#${id}-flowing)"/>`
        + `<path class="tribs-line-s" d="${c.whole}" pathLength="${L}" mask="url(#${id}-flowing)" style="stroke:url(#${id}-w${i})"><title></title></path>`
        + `<circle class="tribs-ripple" cx="${dryX}" cy="${c.dryY.toFixed(2)}" r="3.5"/><circle class="tribs-end" cx="${dryX}" cy="${c.dryY.toFixed(2)}" r="3.5"/>`
        + `<path class="tribs-sweep" d="${c.shore}" pathLength="100" style="animation-delay:${900 + i * 90}ms"/></g>`;
    });
    box.innerHTML = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="The checks, as streams into a river"><defs>${defs}</defs>${body}</svg>`;
    const s = box.firstChild;
    const riverStops = [...s.querySelectorAll(`#${id}-c stop`)];
    const strands = courses.map((c, i) => {
      const g = s.querySelectorAll(".tribs-s")[i];
      return { g, c, line: $(".tribs-line-s", g), title: $("title", g), stops: [...s.querySelectorAll(`#${id}-w${i} stop`)], timer: 0 };
    });
    return {
      width,
      /** `checks` in the streams' order; `was` maps a key to its look before, for those that changed. */
      update(checks, from, was) {
        const mixTo = `color-mix(in oklch, ${from}, var(--river))`;
        [from, from, mixTo].forEach((col, k) => (riverStops[k].style.stopColor = col));
        checks.forEach((ch, i) => {
          const st = strands[i], look = ch.st;
          const before = was.get(ch.key);
          const settling = before !== undefined && (look === "success" || look === "failure") && !RM;
          const base = `tribs-s ${look}${ch.queued ? " queued" : ""}`;
          [TONE_COLOUR[look], from, from, mixTo].forEach((col, k) => (st.stops[k].style.stopColor = col));
          if (look === "failure") { st.line.style.stroke = "var(--check-failure)"; st.line.style.strokeDasharray = `${st.c.dry.toFixed(2)} ${st.c.length.toFixed(2)}`; }
          else { st.line.style.stroke = `url(#${id}-w${i})`; st.line.style.strokeDasharray = ""; }
          st.title.textContent = `${ch.g} · ${ch.n}: ${ch.queued ? "queued" : { success: "passed", failure: "failed", pending: "running" }[look]}`;
          if (settling) {
            // It refills in its new colour while its running look fades (restarted, as it's new).
            clearTimeout(st.timer);
            st.g.setAttribute("class", base);
            void getComputedStyle(st.line).animationName;
            st.g.setAttribute("class", base + " settling");
            st.until = performance.now() + 1600;
            st.timer = setTimeout(() => st.g.classList.remove("settling"), 1600);
          } else {
            // Anything else keeps a refill that's still going.
            st.g.setAttribute("class", base + (look !== "pending" && performance.now() < (st.until || 0) ? " settling" : ""));
          }
        });
      },
    };
  }

  function initPR() {
    const card = $("#pr"), streams = $("#pr-streams"), tribs = $("#pr-tribs"), verdict = $("#pr-verdict"), tl = $("#pr-timeline");
    const why = $("#pr-why"), rerun = $("#pr-rerun"), merge = $("#pr-merge"), stateEl = $("#pr-state"), revs = $("#pr-reviewers");
    // [group, name, starts (s), takes (s), how it fails].
    const CHECKS = [
      ["Build", "macOS", 0, 197], ["Build", "Windows", 6, 254], ["Build", "Linux", 4, 171], ["Build", "Linux ARM", 10, 236],
      ["Test", "Unit", 2, 48], ["Test", "e2e macOS", 60, 252], ["Test", "e2e Windows", 66, 280, "1 test failed in sync.spec.ts"], ["Test", "e2e Linux", 58, 229],
      ["Lint", "ESLint", 1, 22], ["Lint", "rustfmt", 1, 9], ["Lint", "Clippy", 3, 64], ["Lint", "Types", 2, 31],
      ["Assets", "Asset sizes", 0, 19], ["Assets", "Audio loudness", 0, 38, "door_creak.wav peaks at −0.4 dB"], ["Assets", "Textures", 1, 26], ["Assets", "LFS pointers", 0, 12],
    ].map(([g, n, start, takes, fail]) => ({ g, n, key: g + n, start, takes, fail, pass: !fail }));
    const GROUPS = ["Build", "Test", "Lint", "Assets"];
    const SCALE = 46; // seconds of checks for each second here
    const fmt = (s) => { s = Math.max(0, Math.round(s)); return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; };
    let t = 0, last = 0, raf = 0, merged = false, reviewers = null, prevLooks = new Map(), prevTone = null;
    const stateOf = (c) => (t < c.start ? "queued" : t < c.start + c.takes ? "running" : c.pass ? "success" : "failure");
    const asCheck = (c) => { const s = stateOf(c); return { ...c, st: s === "queued" || s === "running" ? "pending" : s, queued: s === "queued" }; };
    // The timeline's rows, built once.
    tl.innerHTML = GROUPS.map((g) => `<div class="tl-group" data-g="${g}"><div class="tl-gh"><span><b>${g}</b> · on the pull request</span><span class="tl-gt"></span></div>${CHECKS.filter((c) => c.g === g)
      .map((c) => `<div class="tl-row" data-k="${c.key}"><span class="tl-dot"></span><span class="tl-name">${c.n}</span><span class="tl-track"><span class="tl-bar"></span></span><span class="tl-time"></span>${c.fail ? `<span class="tl-why" title="${esc(c.fail)}">${esc(c.fail)}</span>` : ""}</div>`).join("")}</div>`).join("");
    CHECKS.forEach((c) => { c.row = $(`.tl-row[data-k="${c.key}"]`, tl); c.bar = $(".tl-bar", c.row); c.time = $(".tl-time", c.row); });
    const drawRevs = () => {
      revs.innerHTML = reviewers.map(([w, s]) => `<span class="rv ${s}">${avatar(w)}${PEOPLE[w][0]}${s === "ok" ? ICON.check : ICON.clock}<span style="position:absolute;left:-9999px">${s === "ok" ? "approved" : "waiting for a review"}</span></span>`).join("");
    };
    function drawTimeline() {
      const span = Math.max(360, ...CHECKS.map((c) => c.start + c.takes)) * 1.02;
      CHECKS.forEach((c) => {
        const s = stateOf(c);
        c.row.className = "tl-row " + (s === "running" ? "pending" : s === "queued" ? "pending queued" : s);
        const end = Math.min(t, c.start + c.takes);
        c.bar.style.left = (c.start / span) * 100 + "%";
        c.bar.style.width = (Math.max(0, end - c.start) / span) * 100 + "%";
        c.time.textContent = s === "queued" ? "Queued" : s === "running" ? fmt(t - c.start) : fmt(c.takes);
      });
      GROUPS.forEach((g) => {
        const cs = CHECKS.filter((c) => c.g === g), first = Math.min(...cs.map((c) => c.start)), lastEnd = Math.max(...cs.map((c) => c.start + c.takes));
        $(`.tl-group[data-g="${g}"] .tl-gt`, tl).textContent = t >= first ? fmt(Math.min(t, lastEnd) - first) : "";
      });
    }
    const order = CHECKS.slice().sort((a, b) => (a.g + a.n).localeCompare(b.g + b.n));
    let river = null, celebrateTimer = 0;
    function drawRiver() {
      const w = Math.max(160, Math.round(streams.clientWidth));
      if (!river || river.width !== w) { river = buildTributaries(streams, order.length); prevLooks = new Map(); }
      const checks = order.map(asCheck);
      const looks = new Map(checks.map((c) => [c.key, c.st + (c.queued ? "q" : "")]));
      const was = new Map();
      checks.forEach((c) => { const b = prevLooks.get(c.key); if (b !== undefined && b !== looks.get(c.key)) was.set(c.key, b); });
      if (prevLooks.size && !was.size) return;
      const tone = checks.some((c) => c.st === "failure") ? "failure" : checks.some((c) => c.st === "pending") ? "pending" : "success";
      const celebrate = !RM && prevTone !== null && prevTone !== "success" && tone === "success";
      const from = blendTones(checks.filter((c) => c.st !== "failure").map((c) => c.st)) || "var(--river)";
      tribs.className = "tribs " + tone + (celebrate ? " celebrating" : "");
      river.update(checks, from, was);
      prevLooks = looks; prevTone = tone;
      if (celebrate) { clearTimeout(celebrateTimer); celebrateTimer = setTimeout(() => tribs.classList.remove("celebrating"), 3400); }
      // The verdict, in the app's words.
      const failed = checks.filter((c) => c.st === "failure").map((c) => c.n), running = checks.filter((c) => c.st === "pending").map((c) => c.n);
      const passed = checks.filter((c) => c.st === "success").length;
      const short = (l) => (l.length === 1 ? l[0] : l.length === 2 ? `${l[0]} and ${l[1]}` : `${l[0]} and ${l.length - 1} more`);
      const still = running.length ? `, ${running.length} still running` : "";
      const word = tone === "failure" ? "Failing" : tone === "pending" ? "Running" : "Passing";
      const title = failed.length ? `${short(failed)} failed` : running.length ? `${short(running)} ${running.length === 1 ? "is" : "are"} still running` : `All ${checks.length} checks passed in ${fmt(Math.max(...CHECKS.map((c) => c.start + c.takes)))}`;
      const line = failed.length ? `${failed.length} of ${checks.length} checks failed${still}` : running.length ? `${passed} of ${checks.length} checks passed${still}` : "";
      $(".tribs-word", verdict).textContent = word;
      $(".tribs-title", verdict).textContent = title;
      $(".tribs-line", verdict).textContent = line;
    }
    function drawButtons() {
      const done = CHECKS.every((c) => stateOf(c) === "success" || stateOf(c) === "failure");
      const failed = CHECKS.some((c) => stateOf(c) === "failure");
      rerun.disabled = !(done && failed) && !merged;
      rerun.textContent = merged ? "Start again" : "Re-run failed";
      const ready = done && !failed && reviewers.every((r) => r[1] === "ok") && !merged;
      merge.disabled = !ready;
      merge.classList.toggle("done", merged);
      $("span", merge).textContent = merged ? "Merged" : "Merge pull request";
      stateEl.textContent = merged ? "Merged" : "Open";
      stateEl.classList.toggle("merged", merged);
      drawStatus(done, ready);
    }
    // One line saying where the request stands, in its colour: its words change in place.
    let rerunning = false, said = "";
    const statusIcon = { wait: ICON.clock, bad: ICON.x, run: ICON.clock, ok: ICON.check, merged: ICON.merge };
    function drawStatus(done, ready) {
      const failed = CHECKS.filter((c) => stateOf(c) === "failure").map((c) => c.n);
      const short = (l) => (l.length === 1 ? l[0] : `${l[0]} and ${l[1]}`);
      const [tone, words] = merged ? ["merged", "Merged into main"]
        : failed.length ? ["bad", `Can't be merged yet: ${short(failed)} failed`]
        : !done ? (rerunning ? ["run", "Running the failed checks again…"] : ["wait", `Waiting for ${CHECKS.length} checks…`])
        : ready ? ["ok", "Everything passed, and all three reviewers approved"]
        : ["wait", "Everything passed. Waiting for Diego Ramos's review…"];
      if (words === said) return;
      said = words;
      why.className = "pr-why";
      why.innerHTML = `<span class="pr-status ${tone}">${statusIcon[tone]}<span>${esc(words)}</span></span>`;
    }
    function draw() { drawTimeline(); drawRiver(); drawButtons(); }
    const busy = () => CHECKS.some((c) => t < c.start + c.takes);
    function tick(now) {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      t += dt * SCALE;
      draw();
      raf = busy() ? requestAnimationFrame(tick) : 0;
      if (!raf) onSettled();
    }
    let onSettled = () => {};
    function run() {
      if (RM) { t = Math.max(...CHECKS.map((c) => c.start + c.takes)); draw(); onSettled(); return; }
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
    }
    function reset() {
      t = 0; merged = false; rerunning = false;
      CHECKS.forEach((c, i) => { const o = [0, 6, 4, 10, 2, 60, 66, 58, 1, 1, 3, 2, 0, 0, 1, 0][i]; c.start = o; c.pass = !c.fail; c.takes = [197, 254, 171, 236, 48, 252, 280, 229, 22, 9, 64, 31, 19, 38, 26, 12][i]; });
      reviewers = [["MC", "ok"], ["PN", "ok"], ["DR", "wait"]];
      prevLooks = new Map(); prevTone = null;
      drawRevs(); draw();
    }
    function doRerun() {
      // The failed ones run again: amber and flowing once more, and they pass this time.
      CHECKS.filter((c) => stateOf(c) === "failure").forEach((c) => { c.start = t + 4; c.takes = Math.round(c.takes * 0.9); c.pass = true; });
      rerunning = true;
      onSettled = () => setTimeout(() => { reviewers[2][1] = "ok"; drawRevs(); drawButtons(); }, RM ? 0 : 700);
      run();
    }
    rerun.addEventListener("click", () => {
      auto.stop();
      if (merged) { reset(); onSettled = () => {}; run(); return; }
      doRerun();
    });
    merge.addEventListener("click", () => { auto.stop(); merged = true; drawButtons(); });
    reset();
    if (RM) run();
    let lastW = streams.clientWidth;
    addEventListener("resize", () => { if (streams.clientWidth !== lastW) { lastW = streams.clientWidth; drawRiver(); } });
    const settled = () => new Promise((res) => { const was = onSettled; onSettled = () => { was(); res(); }; run(); });
    const auto = autoplay(card, async (tk) => {
      for (;;) {
        if (t === 0) { await wait(600, tk); await settled(); }
        else if (busy()) { await settled(); }
        if (!tk.alive) throw new Error("stop");
        if (!merged && CHECKS.some((c) => stateOf(c) === "failure")) {
          await wait(2800, tk);
          rerun.classList.add("press"); await wait(160, tk); rerun.classList.remove("press");
          const p = new Promise((res) => { doRerun(); const was = onSettled; onSettled = () => { was(); res(); }; });
          await p;
          await wait(900, tk);
        }
        if (!merged) {
          await wait(1800, tk);
          merge.classList.add("press"); await wait(160, tk); merge.classList.remove("press");
          merged = true; drawButtons();
        }
        await wait(4200, tk);
        reset();
      }
    }, 0.3);
  }

  /* =========================================================
     6. Search: one box, results grouped by kind.
     ========================================================= */
  function initSearch() {
    const card = $("#sr"), input = $("#sr-input"), out = $("#sr-results"), box = $(".sr-box", card);
    const KINDS = [
      ["msg", "Commit messages", ICON.commit, "var(--l1)"],
      ["branch", "Branches", ICON.branch, "var(--l4)"],
      ["file", "Files", ICON.file, "var(--l3)"],
      ["code", "Code", ICON.code, "var(--l5)"],
    ];
    const DATA = {
      msg: [
        ["Sync notes between devices", "SO", "7d1e750"], ["Send sync changes in small batches", "SO", "3fa2c19"], ["Resolve conflicting edits on sync", "DR", "9b0e4d1"],
        ["Document the sync protocol", "DR", "58454c0"], ["Merge pull request #24 from feature/sync", "MC", "10e5fbb"], ["Make the door creak", "TP", "4e1d9a2"],
        ["Oil the door hinge", "TP", "2c7a8f0"], ["A slower door with a longer creak", "RB", "bfb8db5"], ["Record the tavern door, and model a stool", "TP", "87ad21a"],
        ["Paint the tavern sign", "RB", "a6e1581"], ["Sign: paint a mug of ale next to the mark", "RB", "94bc0a2"], ["Add a theme picker", "MC", "6c1f2e8"],
        ["High-contrast theme", "MC", "e3b9a71"], ["Speed up opening large notebooks", "PN", "1b444ad"], ["Fix the note counter in the sidebar", "LF", "5a91950"],
        ["Export a notebook as a PDF", "SO", "0f8c3d6"],
      ],
      branch: [["main", "you are here"], ["feature/sync", "merged"], ["origin/feature/sync", "on origin"], ["fix/door", "2 ahead"], ["art/tavern-sign", "merged"], ["feature/themes", "#20"], ["feature/export-pdf", "#21"]],
      file: [
        ["src/sync/client.ts", "12 KB"], ["src/sync/protocol.ts", "8 KB"], ["docs/sync.md", "4 KB"], ["Content/Audio/DoorCreak.wav", "48 MB"], ["Content/Cinematics/DoorOpen.webm", "688 MB"],
        ["Content/Textures/TavernSign.psd", "192 KB"], ["Content/Maps/Tavern.umap", "1.2 GB"], ["src/theme/picker.tsx", "6 KB"], ["src/theme/high-contrast.css", "3 KB"],
      ],
      code: [
        ["export async function syncNotebook(id: string) {", "src/sync/client.ts:42"], ["const SYNC_BATCH_SIZE = 64;", "src/sync/protocol.ts:8"], ["await syncNotebook(notebook.id);", "src/app/save.ts:117"],
        ["Door->Creak->Play(); // door_creak.wav", "Source/Tavern/Door.cpp:58"], ["const door = world.spawn(\"BP_Door\");", "src/levels/tavern.ts:31"], ["export function ThemePicker() {", "src/theme/picker.tsx:12"],
        ["applyTheme(theme, { contrast: \"high\" });", "src/theme/apply.ts:30"], ["const sign = load(\"T_TavernSign\");", "src/levels/tavern.ts:44"], ["return exportPdf(notebook, { pageSize: \"A4\" });", "src/export/pdf.ts:19"],
      ],
    };
    const mark = (text, q) => {
      if (!q) return esc(text);
      const i = text.toLowerCase().indexOf(q);
      if (i < 0) return esc(text);
      return esc(text.slice(0, i)) + "<mark>" + esc(text.slice(i, i + q.length)) + "</mark>" + mark(text.slice(i + q.length), q);
    };
    const codeHtml = (text, q) => {
      const re = /\b(export|async|function|const|await|return)\b|([A-Za-z_]\w*)(?=\()/g;
      let out = "", last = 0, m;
      while ((m = re.exec(text))) {
        out += mark(text.slice(last, m.index), q);
        out += `<span class="${m[1] ? "kw" : "fn"}">${mark(m[0], q)}</span>`;
        last = m.index + m[0].length;
      }
      return out + mark(text.slice(last), q);
    };
    let lastKey = null;
    function search(raw) {
      const q = raw.trim().toLowerCase();
      if (!q) {
        lastKey = null;
        out.innerHTML = `<div class="sr-empty">Search ${DATA.msg.length} commits, ${DATA.branch.length} branches, ${DATA.file.length} files and their code.</div>`;
        return;
      }
      const hits = {};
      KINDS.forEach(([k]) => (hits[k] = DATA[k].filter((row) => row[0].toLowerCase().includes(q))));
      const key = q + "|" + KINDS.map(([k]) => hits[k].length).join(",");
      const fresh = key.split("|")[1] !== (lastKey || "").split("|")[1];
      lastKey = key;
      let html = "", i = 0, first = true;
      KINDS.forEach(([k, name, ic, col]) => {
        const rows = hits[k];
        if (!rows.length) return;
        html += `<div class="sr-group"><div class="sr-gh" style="--k:${col}"><span class="k">${ic}</span>${name}<span class="n">${rows.length}</span></div>`;
        rows.slice(0, k === "msg" ? 3 : 2).forEach((row) => {
          let t;
          if (k === "msg") t = `<span class="t">${mark(row[0], q)}</span><span class="m">${PEOPLE[row[1]][0].split(" ")[0]} · ${row[2]}</span>`;
          else if (k === "branch") t = `<span class="t mono">${mark(row[0], q)}</span><span class="m">${row[1]}</span>`;
          else if (k === "file") { const s = row[0].lastIndexOf("/"); t = `<span class="t mono">${mark(row[0].slice(s + 1), q)}<small>${mark(row[0].slice(0, s), q)}</small></span><span class="m">${row[1]}</span>`; }
          else t = `<span class="t code">${codeHtml(row[0], q)}</span><span class="m">${row[1]}</span>`;
          html += `<div class="sr-item${first ? " top" : ""}" style="--i:${fresh ? i++ : 0}">${t}</div>`;
          first = false;
        });
        html += "</div>";
      });
      out.innerHTML = html || `<div class="sr-empty">Nothing matches “${esc(raw.trim())}”.</div>`;
      if (!fresh) $$(".sr-item", out).forEach((n) => (n.style.animation = "none"));
    }
    input.addEventListener("input", () => search(input.value));
    input.addEventListener("focus", () => auto.stop());
    $$(".try .q").forEach((b) => b.addEventListener("click", () => { auto.stop(); input.value = b.dataset.q; search(input.value); input.focus(); }));
    addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        const r = card.getBoundingClientRect();
        if (r.top < innerHeight && r.bottom > 0) { e.preventDefault(); input.focus(); }
      }
    });
    if (/Mac/.test(ua)) $(".sr-kbd", card).textContent = "⌘K";
    // Each query it types, and each suggested one, finds something of every kind.
    const everyKind = (q) => KINDS.every(([k]) => DATA[k].some((row) => row[0].toLowerCase().includes(q)));
    const QUERIES = ["sync", "door", "tavern", "theme"].filter(everyKind);
    $$(".try .q").forEach((b) => { if (!everyKind(b.dataset.q)) console.warn("A suggested search finds too little: " + b.dataset.q); });
    if (RM) { input.value = "sync"; search("sync"); } else search("");
    const auto = autoplay(card, async (t) => {
      for (let k = 0; ; k++) {
        const q = QUERIES[k % QUERIES.length];
        box.classList.add("typing");
        for (const ch of q) { input.value += ch; search(input.value); await wait(110 + Math.random() * 90, t); }
        box.classList.remove("typing");
        await wait(3000, t);
        box.classList.add("typing");
        while (input.value) { input.value = input.value.slice(0, -1); search(input.value); await wait(45, t); }
        box.classList.remove("typing");
        await wait(500, t);
      }
    }, 0.4);
  }

  /* =========================================================
     7. Simple mode: one switch morphs the window.
     ========================================================= */
  function initSimple() {
    const sm = $("#sm"), sw = $("#sm-switch"), files = $("#sm-files"), commits = $("#sm-commits"), gsvg = $("#sm-graph-svg");
    const FILES = [
      { n: "Barber.uasset", p: "Content/Characters", st: "M", k: "var(--kind-art)", ic: ICON.cube, pills: ["also", "lock"] },
      { n: "Theme.wav", p: "Content/Audio", st: "M", k: "var(--kind-audio)", ic: ICON.music, pills: ["big"] },
      { n: "Intro.mp4", p: "Content/Cinematics", st: "A", k: "var(--l5)", ic: ICON.film, pills: ["big"] },
      { n: "Chair.uasset", p: "Content/Props", st: "M", k: "var(--kind-art)", ic: ICON.cube, pills: [] },
    ];
    const PILL = { big: "Big file", lock: `${ICON.lock}Locked by you`, also: "Rosa changed it too" };
    el("li", "grp sm-tech", "Not staged · 1", files);
    FILES.forEach((f, i) => {
      if (i === 1) el("li", "grp sm-tech", "Staged · 3", files);
      const li = el("li", null, `<span class="ck sm-simple">${ICON.check}</span><span class="st ${f.st} sm-tech">${f.st}</span><span class="fic">${f.ic}</span><span class="fn">${f.n}</span><span class="fp">${f.p}</span><span class="tags sm-simple">${f.pills.map((p) => `<span class="pill ${p}">${PILL[p]}</span>`).join("")}</span>`, files);
      li.style.setProperty("--k", f.k);
      li.dataset.flip = "f" + i;
    });
    // The technical view's graph.
    const ROWS = [
      ["Hang a lantern by the door", "RB", 0, "main"], ["Add a tavern chair", "RB", 0], ["Pad the stool's seat", "RB", 1, "art/barber-v2"],
      ["Give the stool a back", "TP", 0], ["Stop the stool wobbling", "TP", 2, "fix/door"], ["Make the door creak", "TP", 1],
      ["Import the level instances", "DR", 0], ["Record the tavern door", "TP", 2], ["Light the tavern", "RB", 0], ["Furnish the tavern", "TP", 0], ["Set up the studio", "MC", 0],
    ];
    const LC = ["--l1", "--l2", "--l3"];
    const RH = 34, X = (c) => 18 + c * 20, Y = (r) => r * RH + RH / 2;
    const H = ROWS.length * RH;
    gsvg.setAttribute("width", 84); gsvg.setAttribute("height", H); gsvg.setAttribute("viewBox", `0 0 84 ${H}`);
    const lane = (d, c) => { const p = svg("path", { d, class: "e" }, gsvg); p.style.stroke = `var(${LC[c]})`; };
    lane(`M${X(0)} ${Y(0)}V${H}`, 0);
    lane(rounded([[X(1), Y(2)], [X(1), Y(6)], [X(0), Y(6)]], 9), 1);
    lane(rounded([[X(2), Y(4)], [X(2), Y(9)], [X(0), Y(9)]], 9), 2);
    ROWS.forEach(([m, w, c, label], r) => {
      const n = svg("circle", { cx: X(c), cy: Y(r), r: 6, class: "n" }, gsvg); n.style.fill = `var(${LC[c]})`;
      el("li", null, `${label ? `<span class="chip${label === "main" ? " head" : ""}" style="--c: var(${LC[c]})">${label === "main" ? ICON.check : ""}${label}</span>` : ""}<span>${esc(m)}</span><small>${w}</small>`, commits);
    });

    let busy = false, simple = false;
    function setMode(on, animate) {
      if (busy || on === simple) return;
      simple = on;
      sw.setAttribute("aria-checked", on);
      const going = $$(on ? ".sm-tech" : ".sm-simple", sm), coming = $$(on ? ".sm-simple" : ".sm-tech", sm);
      if (!animate || RM || !Element.prototype.animate) { sm.dataset.mode = on ? "simple" : "tech"; return; }
      busy = true;
      going.forEach((e) => e.classList.add("sm-going"));
      sm.classList.add("fade-out");
      setTimeout(() => {
        const flips = $$("[data-flip]", sm);
        const first = new Map(flips.map((e) => [e, e.getBoundingClientRect()]));
        sm.dataset.mode = on ? "simple" : "tech";
        sm.classList.remove("fade-out");
        going.forEach((e) => e.classList.remove("sm-going"));
        coming.forEach((e) => { e.classList.remove("sm-coming"); void e.offsetWidth; e.classList.add("sm-coming"); });
        flips.forEach((e) => {
          const f = first.get(e), l = e.getBoundingClientRect();
          if (!f.width || !l.width) return;
          const dx = f.left - l.left, dy = f.top - l.top;
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
          e.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 650, easing: "cubic-bezier(.2,.7,.2,1)" });
        });
        setTimeout(() => { busy = false; coming.forEach((e) => e.classList.remove("sm-coming")); }, 800);
      }, 210);
    }
    sw.addEventListener("click", () => { auto.stop(); setMode(!simple, true); });
    sm.dataset.mode = "tech";
    const auto = autoplay(sm, async (t) => {
      for (;;) {
        await wait(simple ? 4200 : 2200, t);
        sw.classList.remove("nudge"); void sw.offsetWidth; sw.classList.add("nudge");
        await wait(350, t);
        setMode(!simple, true);
      }
    }, 0.45);
  }

  /* ---- Start ---- */
  function safe(fn) { try { fn(); } catch (e) { console.error(e); } }
  safe(initGraph); safe(initTheming); safe(initUndo); safe(initArt); safe(initModel); safe(initBigFiles); safe(initPR); safe(initSearch); safe(initSimple);

  let raf = 0;
  addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; updateHero(); updateJourney(); spy(); }); }, { passive: true });
  // Rebuilt only when the hero's geometry changes: its width, or where the app's window starts.
  const geom = () => hero.clientWidth + ":" + (at(frame).y - at(hero).y);
  let rt = 0, lastGeom = "";
  const maybeRebuild = () => { const g = geom(); if (g !== lastGeom) { lastGeom = g; buildHero(); journeyLater(); } else updateHero(); };
  // The journey follows the page's layout: rebuilt when anything changes its size.
  let jt = 0, lastLayout = "";
  const journeyLater = () => { clearTimeout(jt); jt = setTimeout(() => {
    const layout = innerWidth + ":" + $("main").offsetHeight + ":" + at(dlMark).y + ":" + (HG ? HG.yh + ":" + HG.mx : "");
    if (layout !== lastLayout) { lastLayout = layout; safe(buildJourney); } else updateJourney();
  }, 160); };
  new ResizeObserver(journeyLater).observe(document.body);
  new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(maybeRebuild, 80); }).observe(hero);
  hero.classList.add("hero-in");
  maybeRebuild();
  spy();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { maybeRebuild(); journeyLater(); });
  addEventListener("load", () => { maybeRebuild(); journeyLater(); });
  safe(buildJourney);
  // Once drawn, later rebuilds (a resize) show the graph at once.
  setTimeout(() => hero.classList.remove("hero-in"), 3600);
})();
