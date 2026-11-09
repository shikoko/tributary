// A small WebDriver client (the W3C protocol over HTTP), enough to drive the desktop app
// through tauri-driver without another dependency.

const ELEMENT = "element-6066-11e4-a52e-4f735466cecf";

export async function startSession(server, application) {
  const response = await fetch(`${server}/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      capabilities: { alwaysMatch: { "tauri:options": { application }, browserName: "wry" } },
    }),
  });
  const body = await response.json();
  if (!response.ok || body.value?.error) throw new Error(`Couldn't start the app: ${body.value?.message ?? response.status}`);
  return new Session(server, body.value.sessionId);
}

class Session {
  constructor(server, id) {
    this.base = `${server}/session/${id}`;
  }

  async call(method, path, body) {
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const answer = await response.json().catch(() => ({}));
    if (!response.ok || answer.value?.error) {
      const error = new Error(answer.value?.message ?? `${method} ${path}: ${response.status}`);
      error.code = answer.value?.error;
      throw error;
    }
    return answer.value;
  }

  /** Run `script` (a function body; `arguments` are `args`) in the app and return its result. */
  execute(script, args = []) {
    return this.call("POST", "/execute/sync", { script, args });
  }

  /** Like execute, but the script calls `arguments[arguments.length - 1]` with the result. */
  executeAsync(script, args = []) {
    return this.call("POST", "/execute/async", { script, args });
  }

  async find(css) {
    const found = await this.call("POST", "/element", { using: "css selector", value: css });
    return found[ELEMENT];
  }

  async findAll(css) {
    const found = await this.call("POST", "/elements", { using: "css selector", value: css });
    return found.map((element) => element[ELEMENT]);
  }

  /** The first element matching `css` whose text includes `text`, when it shows up. */
  async waitFor(css, { text, timeout = 15_000 } = {}) {
    const until = Date.now() + timeout;
    for (;;) {
      const found = await this.execute(
        `const [css, text] = arguments;
         return [...document.querySelectorAll(css)].some((element) => !text || element.textContent.includes(text));`,
        [css, text ?? null],
      ).catch(() => false);
      if (found) return;
      if (Date.now() > until) throw new Error(`Nothing like ${css}${text ? ` with "${text}"` : ""} after ${timeout / 1000} s`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  /** Click the first element matching `css` whose text is `text` (or else includes it). */
  async click(css, text) {
    await this.waitFor(css, { text });
    const clicked = await this.execute(
      `const [css, text] = arguments;
       const all = [...document.querySelectorAll(css)];
       const element = !text ? all[0] : all.find((each) => each.textContent.trim() === text) ?? all.find((each) => each.textContent.includes(text));
       if (!element) return false;
       element.scrollIntoView({ block: "center" });
       element.click();
       return true;`,
      [css, text ?? null],
    );
    if (!clicked) throw new Error(`Couldn't click ${css}`);
  }

  /** Type into an input or textarea the way React notices. */
  async type(css, value) {
    await this.waitFor(css);
    await this.execute(
      `const [css, value] = arguments;
       const element = document.querySelector(css);
       const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value").set;
       setter.call(element, value);
       element.dispatchEvent(new Event("input", { bubbles: true }));`,
      [css, value],
    );
  }

  async screenshot() {
    return Buffer.from(await this.call("GET", "/screenshot"), "base64");
  }

  async quit() {
    await fetch(this.base, { method: "DELETE" }).catch(() => {});
  }
}
