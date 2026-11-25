// Commit messages written with AI: the settings, and the words about what was written.
import type { AiProvider, AiSetup, MessageStyle, WrittenMessage } from "../api";
import { plural } from "./format";
import { useStoredState } from "./settings";

/** The Settings section with these settings, to open it at. */
export const AI_SECTION = "AI";

/** Ollama's address, the likeliest server on this computer (the backend's default too). */
export const LOCAL_ADDRESS = "http://localhost:11434/v1";

export const DEFAULT_SETUP: AiSetup = { provider: "anthropic", model: "", address: "" };

export const PROVIDERS: { value: AiProvider; label: string; detail: string }[] = [
  { value: "anthropic", label: "Anthropic (Claude)", detail: "Your Anthropic API key" },
  { value: "openai", label: "OpenAI", detail: "Your OpenAI API key" },
  { value: "gemini", label: "Google Gemini", detail: "Your Google AI Studio key" },
  { value: "local", label: "On this computer", detail: "Ollama, LM Studio or another server like OpenAI's" },
];

export const STYLES: { value: MessageStyle; label: string; detail: string }[] = [
  { value: "repository", label: "Like this repository's messages", detail: "In the style of its last commits" },
  { value: "conventional", label: "Conventional commit", detail: "feat: fix: docs: …" },
  { value: "summary", label: "Summary only", detail: "One line, no description" },
];

/** Where each provider's keys are made, for the hint by the key. */
export const KEY_PAGES: Record<AiProvider, string | null> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  gemini: "https://aistudio.google.com/apikey",
  local: null,
};

/** The AI settings, the same everywhere they're used (Settings and the commit box). */
export function useAiSettings() {
  const [on, setOn] = useStoredState("ai.on", false);
  const [setup, setSetup] = useStoredState<AiSetup>("ai.setup", DEFAULT_SETUP);
  const [style, setStyle] = useStoredState<MessageStyle>("ai.style", "repository");
  // The offer in the commit box was answered (set up, or not now): it isn't made again.
  const [offered, setOffered] = useStoredState("ai.offered", false);
  return { on, setOn, setup, setSetup, style, setStyle, offered, setOffered };
}

/** Another provider: its models aren't the last one's, so the model goes back to the one picked. */
export function withProvider(setup: AiSetup, provider: AiProvider): AiSetup {
  return provider === setup.provider ? setup : { ...setup, provider, model: "" };
}

/** The line under the message: who wrote it, from what. */
export function writtenNote(written: WrittenMessage): string {
  const named = written.leftOut.length;
  if (written.files === 0) return `Written by ${written.by} from the names of ${plural(named, "staged file")}`;
  const more = named > 0 ? `, and ${named.toLocaleString()} more by name only` : "";
  return `Written by ${written.by} from ${plural(written.files, "staged file")}${more}`;
}

/** The same line's tooltip: what wasn't sent whole. */
export function writtenDetail(written: WrittenMessage): string {
  const parts: string[] = [];
  if (written.leftOut.length > 0) parts.push(`Sent by name only, not what's in them (in Git LFS, or not text): ${written.leftOut.join(", ")}.`);
  if (written.shortened) parts.push("Long changes were cut short before they were sent.");
  return parts.join(" ") || "Only the staged changes were sent.";
}
