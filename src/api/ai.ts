// Commit messages written with AI, with your own key.
import { invoke } from "./invoke";
import type { AiKey, AiModel, AiModels, AiProvider, AiSetup, MessageStyle, WrittenMessage } from "./generated";
export type { AiKey, AiModel, AiModels, AiProvider, AiSetup, MessageStyle, WrittenMessage };

/** Whether a key is kept for the provider (by git's credential helper). */
export function aiKey(setup: AiSetup): Promise<AiKey> {
  return invoke("ai_key", { setup });
}

/** Check the key with the provider, then keep it. */
export function aiSaveKey(setup: AiSetup, key: string): Promise<AiKey> {
  return invoke("ai_save_key", { setup, key });
}

export function aiForgetKey(setup: AiSetup): Promise<void> {
  return invoke("ai_forget_key", { setup });
}

/** The provider's models, from the provider, and the one used when none is chosen. */
export function aiModels(setup: AiSetup): Promise<AiModels> {
  return invoke("ai_models", { setup });
}

/** A message for the staged changes. `draft` is what was typed in the summary, to build on. */
export function writeCommitMessage(path: string, setup: AiSetup, style: MessageStyle, draft: string): Promise<WrittenMessage> {
  return invoke("write_commit_message", { path, setup, style, draft });
}
