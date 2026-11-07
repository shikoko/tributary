// A stand-in for Tauri in an ordinary browser, loaded before the app by the preview server.
// The app's own commands go to the server, which runs them with the app's Rust code; the
// rest (dialogs, links, notifications, the window, updates) is faked here.
//
// Scripts can set `window.__PREVIEW__` before the page loads to steer the fakes:
//   pick           what the file / folder picker returns (a path, a list of them, or null);
//                  without it, the picker asks with a prompt
//   pullRequests   the pull requests to show, instead of asking GitHub
//   update         an update to offer, like { version: "0.2.0", notes: "…", date: null }
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
    pull_requests: (args) => (preview.pullRequests !== undefined ? preview.pullRequests : server("pull_requests", args)),
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
