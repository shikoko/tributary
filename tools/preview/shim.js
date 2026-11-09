// A stand-in for Tauri in an ordinary browser, loaded before the app by the preview server.
// The app's own commands go to the server, which runs them with the app's Rust code; the
// rest (dialogs, links, notifications, the window, updates) is faked here.
//
// Scripts can set `window.__PREVIEW__` before the page loads to steer the fakes:
//   pick           what the file / folder picker returns (a path, a list of them, or null);
//                  without it, the picker asks with a prompt
//   pullRequests   the pull requests to show, instead of asking GitHub; with it, opening
//                  one is faked too, and their details come from pullRequestDetails (by
//                  number), their comments from conversations (by number), and the new
//                  pull request dialog from newRequest; commenting, reviewing and merging
//                  change those
//   update         an update to offer, like { version: "0.2.0", notes: "…", date: null }
//   github         a stand-in GitHub sign-in, like { account: null, browserSignIn: true },
//                  instead of git's real credential helper
//   issues         a stand-in issue tracker: { all: [issues], mine: [their keys], user },
//                  instead of asking Jira, Linear, GitHub or GitLab
// and read what happened from it afterwards: opened (links and revealed files), notified.
(() => {
  const preview = (window.__PREVIEW__ = {
    pick: undefined,
    pullRequests: undefined,
    update: null,
    opened: [],
    notified: [],
    ...(window.__PREVIEW__ || {}),
  });

  // Events: Tauri calls back through functions registered with transformCallback.
  const callbacks = new Map();
  const listeners = new Map();
  let nextCallback = 1;
  const emit = (event, payload) => {
    for (const id of listeners.get(event) || []) callbacks.get(id)?.({ event, id, payload });
  };
  preview.emit = emit;
  new EventSource("/__preview/events").onmessage = (message) => {
    const { event, payload } = JSON.parse(message.data);
    emit(event, payload);
  };

  const server = async (command, args) => {
    const response = await fetch("/__preview/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Tributary-Preview": "1" },
      body: JSON.stringify({ command, args }),
    });
    if (!response.ok) throw `The preview server said ${response.status}`;
    const reply = await response.json();
    if ("err" in reply) throw reply.err;
    return reply.ok;
  };

  const pick = (options = {}) => {
    if (preview.pick !== undefined) return preview.pick;
    const answer = window.prompt(options.title || (options.directory ? "Folder" : "File"), options.defaultPath || "");
    if (!answer) return null;
    return options.multiple ? answer.split(",").map((path) => path.trim()) : answer;
  };

  const installUpdate = () =>
    new Promise((resolve) => {
      const total = 18_000_000;
      let downloaded = 0;
      const timer = setInterval(() => {
        downloaded = Math.min(total, downloaded + 3_000_000);
        emit("update-progress", { downloaded, total });
        if (downloaded >= total) {
          clearInterval(timer);
          preview.installed = true;
          resolve(null);
        }
      }, 300);
    });

  /** Any token but "bad" signs in, as a made-up user, after a moment. */
  const fakeSignIn = (token) =>
    new Promise((resolve, reject) =>
      setTimeout(() => {
        if (token === "bad") return reject("GitHub didn't accept that token. Check that it was copied whole and hasn't expired.");
        preview.github.account = { login: "maya-chen", name: "Maya Chen" };
        resolve(preview.github.account);
      }, 400),
    );

  /** Pull requests, when they're faked: their details, and opening new ones. */
  const faking = () => preview.pullRequests !== undefined;
  const fakeDetails = ({ number }) => {
    const known = preview.pullRequestDetails?.[number];
    if (known) return structuredClone(known);
    const pr = (preview.pullRequests || []).find((each) => each.number === number);
    if (!pr) return Promise.reject(`GitHub didn't show pull request #${number}: it isn't there.`);
    return {
      number,
      title: pr.title,
      url: pr.url,
      body: "",
      author: pr.author,
      state: pr.draft ? "draft" : "open",
      base: "main",
      branch: pr.branch,
      created: new Date().toISOString(),
      additions: null,
      deletions: null,
      files: null,
      comments: 0,
      mergeable: pr.draft ? null : "checking",
      reviews: [],
      checks: [],
      forge: pr.forge || "github",
    };
  };
  /** A request's conversation, made up when the script didn't give one. */
  const conversationOf = (number) => {
    preview.conversations = preview.conversations || {};
    preview.conversations[number] = preview.conversations[number] || { comments: [], you: "maya-chen", mergeMethods: ["merge", "squash", "rebase"], canRequestChanges: true };
    return preview.conversations[number];
  };
  const later = (value) => new Promise((resolve) => setTimeout(() => resolve(value), 300));
  const say = (number, body, more = {}) => {
    const conversation = conversationOf(number);
    const id = `fake${conversation.comments.length + 1}`;
    conversation.comments.push({ id, author: conversation.you, body, created: new Date().toISOString(), review: null, path: null, line: null, hunk: null, thread: null, reply: false, ...more });
  };
  const fakeComment = ({ number, body, thread }) => {
    if (thread) {
      // After the thread's last comment.
      const comments = conversationOf(number).comments;
      const at = comments.map((comment) => comment.thread).lastIndexOf(thread) + 1;
      comments.splice(at, 0, { id: `fake${comments.length + 1}`, author: conversationOf(number).you, body, created: new Date().toISOString(), review: null, path: null, line: null, hunk: null, thread, reply: true });
    } else say(number, body);
    return later(thread ? "Replied" : "Commented");
  };
  const fakeReview = ({ number, verdict, body }) => {
    const state = { approve: "approved", requestChanges: "changesRequested", comment: "commented" }[verdict];
    say(number, body, { review: state });
    const details = preview.pullRequestDetails?.[number];
    if (details) {
      const you = conversationOf(number).you;
      details.reviews = [...details.reviews.filter((review) => review.author !== you), { author: you, state }];
    }
    return later({ approve: `Approved #${number}`, requestChanges: `Asked for changes to #${number}`, comment: `Reviewed #${number}` }[verdict]);
  };
  const fakeMerge = ({ number, options }) => {
    const details = preview.pullRequestDetails?.[number];
    if (details) Object.assign(details, { state: "merged", mergeable: null });
    preview.merged = { number, ...options };
    return later(`Merged #${number}${options.deleteBranch && details ? ` and deleted ${details.branch}` : ""}`);
  };
  const fakeCreate = ({ request }) =>
    new Promise((resolve, reject) =>
      setTimeout(() => {
        const list = preview.pullRequests || [];
        if (list.some((pr) => pr.branch === request.branch)) return reject(`GitHub didn't open it: A pull request already exists for example:${request.branch}.`);
        const number = Math.max(14, ...list.map((pr) => pr.number)) + 1;
        const pr = { number, title: request.title, url: `https://github.com/example/feast/pull/${number}`, remote: "origin", branch: request.branch, draft: request.draft, author: "maya-chen", checks: null, forge: "github" };
        preview.pullRequests = [...list, pr];
        preview.created = request;
        resolve(pr);
      }, 300),
    );
  const fakeRequestInfo = ({ branch }) => ({
    forge: "github",
    remote: "origin",
    bases: ["main"],
    base: "main",
    signedIn: true,
    onRemote: true,
    unpushed: 0,
    commits: [{ summary: `Work on ${branch}`, body: "" }],
    ...(preview.newRequest || {}),
  });

  /** Commands that don't need the server, by name. */
  const local = {
    "plugin:event|listen": ({ event, handler }) => {
      listeners.set(event, [...(listeners.get(event) || []), handler]);
      return handler;
    },
    "plugin:event|unlisten": ({ event, eventId }) => {
      listeners.set(event, (listeners.get(event) || []).filter((id) => id !== eventId));
      return null;
    },
    "plugin:app|version": () => window.__PREVIEW_VERSION__ || "preview",
    "plugin:dialog|open": ({ options }) => pick(options),
    "plugin:opener|open_url": ({ url }) => {
      preview.opened.push(url);
      window.open(url, "_blank", "noopener");
      return null;
    },
    "plugin:opener|reveal_item_in_dir": (args) => {
      preview.opened.push(`reveal:${JSON.stringify(args)}`);
      console.info("Reveal in the file manager:", args);
      return null;
    },
    "plugin:notification|is_permission_granted": () => true,
    "plugin:notification|request_permission": () => "granted",
    "plugin:notification|notify": ({ options }) => {
      preview.notified.push(options);
      console.info("Notification:", options);
      return null;
    },
    "plugin:window|is_maximized": () => false,
    "plugin:webview|set_webview_zoom": ({ value }) => {
      document.documentElement.style.zoom = String(value);
      return null;
    },
    check_for_update: () => preview.update,
    install_update: installUpdate,
    issues: (args) => (preview.issues ? preview.issues.all.filter((issue) => args.keys.includes(issue.key)) : server("issues", args)),
    my_issues: (args) => (preview.issues ? preview.issues.all.filter((issue) => preview.issues.mine.includes(issue.key)) : server("my_issues", args)),
    tracker_status: (args) => (preview.issues ? { signedIn: Boolean(preview.issues.user), user: preview.issues.user ?? null } : server("tracker_status", args)),
    tracker_sign_in: (args) => (preview.issues ? ((preview.issues.user = "Maya Chen"), { signedIn: true, user: "Maya Chen" }) : server("tracker_sign_in", args)),
    tracker_sign_out: (args) => (preview.issues ? ((preview.issues.user = null), null) : server("tracker_sign_out", args)),
    pull_requests: (args) => (faking() ? structuredClone(preview.pullRequests) : server("pull_requests", args)),
    pull_request_details: (args) => (faking() ? fakeDetails(args) : server("pull_request_details", args)),
    request_conversation: (args) => (faking() ? structuredClone(conversationOf(args.number)) : server("request_conversation", args)),
    comment_on_request: (args) => (faking() ? fakeComment(args) : server("comment_on_request", args)),
    review_request: (args) => (faking() ? fakeReview(args) : server("review_request", args)),
    merge_request: (args) => (faking() ? fakeMerge(args) : server("merge_request", args)),
    create_pull_request: (args) => (faking() ? fakeCreate(args) : server("create_pull_request", args)),
    new_request_info: (args) => (faking() ? fakeRequestInfo(args) : server("new_request_info", args)),
    github_status: () =>
      preview.github
        ? { account: preview.github.account ?? null, tokenRejected: false, canKeepToken: true, browserSignIn: Boolean(preview.github.browserSignIn) }
        : server("github_status", {}),
    github_sign_in: (args) => (preview.github ? fakeSignIn(args.token) : server("github_sign_in", args)),
    github_sign_in_with_browser: () => (preview.github ? fakeSignIn("browser") : server("github_sign_in_with_browser", {})),
    github_sign_out: () => (preview.github ? ((preview.github.account = null), null) : server("github_sign_out", {})),
  };

  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    transformCallback: (callback) => {
      const id = nextCallback++;
      callbacks.set(id, callback);
      return id;
    },
    unregisterCallback: (id) => callbacks.delete(id),
    invoke: async (command, args = {}) => {
      if (local[command]) return local[command](args);
      // Menus, window buttons and the like: nothing to do in a browser.
      if (command.startsWith("plugin:")) return null;
      return server(command, args);
    },
  };
})();
