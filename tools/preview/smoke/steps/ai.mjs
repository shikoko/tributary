// The smoke test: writing the commit message with AI, against a stand-in for a model on this
// computer that answers like OpenAI's API, through the app's own backend: the offer the first
// time, Settings → AI, the sparkle and its menu, the line under the message with Try again and
// Undo, and what it says when nothing answers.
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";

/** A stand-in model server: one model, and a message for each request, the replies in turn. */
async function standIn(replies) {
  const asked = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const reply = (data) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(data));
      };
      if (request.method === "GET" && request.url === "/v1/models") return reply({ object: "list", data: [{ id: "tiny-model", object: "model", created: 1 }] });
      if (request.method === "POST" && request.url === "/v1/chat/completions") {
        asked.push(JSON.parse(body));
        const content = replies[Math.min(asked.length, replies.length) - 1];
        return reply({ choices: [{ message: { role: "assistant", content } }] });
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end("{}");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}/v1`, asked, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** Change a stored setting as the app does, so every place showing it follows. */
const setting = (page, key, value) =>
  page.evaluate(
    ([key, value]) => {
      localStorage.setItem(`tributary.${key}`, JSON.stringify(value));
      window.dispatchEvent(new CustomEvent("tributary:setting", { detail: { key, value } }));
    },
    [key, value],
  );

export default async function ({ page, demos, step, accessible, expect, openNotebook }) {
  const git = (...args) => execFileSync("git", ["-C", demos.notebook, ...args], { encoding: "utf8" }).trim();
  const model = await standIn(["Add the onboarding tour\n\nShows new notebooks around once, with a way to skip it.", "```\nShow new notebooks around once\n```"]);
  const summary = page.getByPlaceholder("Commit summary");
  const description = page.getByPlaceholder("Description (optional)");
  await openNotebook();
  await page.locator(".commit-row", { has: page.locator(".summary.wip") }).click();
  expect(git("diff", "--cached", "--name-only") !== "", "nothing staged in the demo");

  await step("offers to write messages with AI the first time, with room between its buttons", async () => {
    await setting(page, "ai.offered", false);
    const offer = page.locator(".ai-offer");
    await offer.waitFor({ timeout: 5000 });
    // Set up and Not now well apart, so one isn't pressed for the other.
    const setUp = await offer.getByRole("button", { name: "Set up…" }).boundingBox();
    const notNow = await offer.getByRole("button", { name: "Not now" }).boundingBox();
    expect(notNow.x - (setUp.x + setUp.width) >= 12, `the buttons are ${Math.round(notNow.x - (setUp.x + setUp.width))}px apart`);
    await accessible("the offer to write messages with AI");
    await offer.getByRole("button", { name: "Not now" }).click();
    await offer.waitFor({ state: "detached", timeout: 5000 });
    expect((await page.evaluate(() => localStorage.getItem("tributary.ai.offered"))) === "true", "Not now wasn't remembered");
    // Off, there's no sparkle.
    expect((await page.locator(".ai-write").count()) === 0, "the sparkle shows before it's turned on");
  });

  await step("sets up a model on this computer in Settings → AI", async () => {
    await page.keyboard.press("Control+,");
    await page.getByRole("tab", { name: "AI", exact: true }).click();
    await page.getByRole("switch", { name: "Write commit messages with AI" }).click();
    await page.getByRole("combobox", { name: "Provider" }).selectOption("local");
    const address = page.getByRole("textbox", { name: "Server's address" });
    await address.fill(model.url);
    await address.press("Enter");
    // The models are the server's own: the one it has, picked.
    await page.getByRole("combobox", { name: "Model" }).locator("option", { hasText: "Automatic (tiny-model)" }).waitFor({ state: "attached", timeout: 10_000 });
    await page.getByText("API key (if it needs one)").waitFor({ timeout: 5000 });
    await accessible("Settings, AI");
    await page.getByRole("button", { name: "Done" }).click();
    await page.locator(".settings").waitFor({ state: "detached", timeout: 5000 });
  });

  await step("writes the message from the staged changes, tries again, and undoes it", async () => {
    const staged = git("diff", "--cached", "--name-only").split("\n");
    const unstagedOnly = git("diff", "--name-only")
      .split("\n")
      .filter((file) => file && !staged.includes(file));
    await summary.fill("onboarding");
    await page.getByRole("button", { name: "Write the message with AI" }).click();
    await page.waitForFunction(() => document.querySelector(".commit-box input")?.value === "Add the onboarding tour", null, { timeout: 15_000 });
    expect((await description.inputValue()) === "Shows new notebooks around once, with a way to skip it.", `the description is ${await description.inputValue()}`);
    const note = page.locator(".ai-note");
    await note.filter({ hasText: "Written by tiny-model from" }).waitFor({ timeout: 5000 });
    // Only what's staged was sent, with what had been typed.
    const sent = model.asked[0].messages[1].content;
    expect(sent.includes(`+++ b/${staged[0]}`), `${staged[0]} wasn't sent`);
    expect(!unstagedOnly.some((file) => sent.includes(`b/${file}`)), "unstaged changes were sent");
    expect(sent.includes("started writing:\nonboarding"), "what was typed wasn't sent");
    await accessible("a message written with AI");

    // Again: from what was typed, not from the first message.
    await note.getByRole("button", { name: "Try again" }).click();
    await page.waitForFunction(() => document.querySelector(".commit-box input")?.value === "Show new notebooks around once", null, { timeout: 15_000 });
    expect(model.asked[1].messages[1].content.includes("started writing:\nonboarding"), "trying again didn't start from what was typed");
    expect((await description.inputValue()) === "", "the description stayed");

    // The menu writes it another way.
    await page.getByRole("button", { name: "How the message is written" }).click();
    await page.locator(".menu-item", { hasText: "Summary only" }).click();
    for (let tries = 0; model.asked.length < 3 && tries < 100; tries++) await page.waitForTimeout(100);
    expect(model.asked[2]?.messages[0].content.includes("only the summary line"), "the style wasn't sent");

    await note.getByRole("button", { name: "Undo" }).click();
    await note.waitFor({ state: "detached", timeout: 5000 });
    expect((await summary.inputValue()) === "onboarding", `Undo left ${await summary.inputValue()}`);
    expect((await description.inputValue()) === "", "Undo left a description");
    // Changed by hand, the message is yours: no note.
    await page.getByRole("button", { name: "Write the message with AI" }).click();
    await note.waitFor({ timeout: 15_000 });
    await summary.fill("My own words");
    await note.waitFor({ state: "detached", timeout: 5000 });
    await summary.fill("");
  });

  await step("says what to fix when nothing answers", async () => {
    await model.close();
    await page.getByRole("button", { name: "Write the message with AI" }).click();
    const failed = page.locator(".ai-note.failed");
    await failed.filter({ hasText: "Nothing answered at" }).waitFor({ timeout: 15_000 });
    await failed.getByRole("button", { name: "AI settings…" }).click();
    await page.getByRole("tab", { name: "AI", exact: true, selected: true }).waitFor({ timeout: 5000 });
    await page.getByRole("button", { name: "Done" }).click();
    await setting(page, "ai.on", false);
  });
}
