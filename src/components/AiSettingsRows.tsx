import { useEffect, useState } from "react";
import { aiForgetKey, aiKey, aiModels, aiSaveKey, asAppError, type AiKey, type AiModels, type AiProvider, type MessageStyle } from "../api";
import { KEY_PAGES, LOCAL_ADDRESS, PROVIDERS, STYLES, useAiSettings, withProvider } from "../lib/ai";
import type { SettingRow } from "./SettingsDialog";
import { Button } from "./ui/Button";

const COMPANY: Record<AiProvider, string> = { anthropic: "Anthropic", openai: "OpenAI", gemini: "Google", local: "the server" };

/**
 * Settings → AI: writing commit messages with AI, with your own key. Off until it's turned
 * on; then which provider (or a server on this computer), the key, kept by git's credential
 * helper, the model (from the provider's own list), and how messages are written.
 */
export function useAiRows(open: boolean): SettingRow[] {
  const { on, setOn, setup, setSetup, style, setStyle } = useAiSettings();
  const local = setup.provider === "local";
  // Which key and models: the provider's, or for a server on this computer, its address's.
  const where = `${setup.provider}|${local ? setup.address : ""}`;
  const [key, setKey] = useState<AiKey | null>(null);
  const [typed, setTyped] = useState("");
  const [saving, setSaving] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [models, setModels] = useState<AiModels | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [address, setAddress] = useState(setup.address);
  useEffect(() => setAddress(setup.address), [setup.address]);

  useEffect(() => {
    setKey(null);
    setKeyError(null);
    setTyped("");
    if (!open || !on) return;
    let current = true;
    aiKey(setup)
      .then((found) => current && setKey(found))
      .catch(() => current && setKey({ kept: false, ends: null }));
    return () => {
      current = false;
    };
    // `where` stands for the provider and the server's address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, on, where]);

  // The list comes from the provider, so it needs the key (a server on this computer may not).
  const ready = key !== null && (key.kept || local);
  useEffect(() => {
    setModels(null);
    setModelsError(null);
    if (!open || !on || !ready) return;
    let current = true;
    aiModels(setup)
      .then((found) => current && setModels(found))
      .catch((reason) => current && setModelsError(asAppError(reason).message));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, on, ready, where, key?.ends]);

  const rows: SettingRow[] = [
    {
      kind: "toggle",
      label: "Write commit messages with AI",
      hint: "A sparkle in the commit summary writes the message from your staged changes, when you click it. Off until you turn it on.",
      value: on,
      set: setOn,
    },
  ];
  if (!on) return rows;

  const save = async () => {
    setSaving(true);
    setKeyError(null);
    try {
      setKey(await aiSaveKey(setup, typed));
      setTyped("");
    } catch (reason) {
      setKeyError(asAppError(reason).message);
    }
    setSaving(false);
  };
  const page = KEY_PAGES[setup.provider];
  const picked = models?.models.find((model) => model.id === models.picked);
  const chosenListed = !setup.model || models?.models.some((model) => model.id === setup.model);

  rows.push({
    kind: "select",
    label: "Provider",
    hint: "Claude, OpenAI or Gemini with your own API key, or a model on your own computer (Ollama, LM Studio).",
    value: setup.provider,
    options: PROVIDERS.map((provider) => ({ value: provider.value, label: provider.label })),
    set: (value) => setSetup(withProvider(setup, value as AiProvider)),
  });
  if (local) {
    rows.push({
      kind: "custom",
      label: "Server's address",
      hint: "Ollama's is http://localhost:11434/v1, LM Studio's http://localhost:1234/v1. Start its server first.",
      content: (
        <input
          className="text-input settings-input"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          onBlur={() => address.trim() !== setup.address && setSetup({ ...setup, address: address.trim(), model: "" })}
          onKeyDown={(event) => event.key === "Enter" && (event.target as HTMLInputElement).blur()}
          placeholder={LOCAL_ADDRESS}
          spellCheck={false}
          autoCapitalize="off"
          aria-label="Server's address"
        />
      ),
    });
  }
  rows.push(
    key?.kept
      ? {
          kind: "custom",
          label: "API key",
          hint: `The one ending in ${key.ends ?? "…"}. Kept where git keeps your passwords (your system's keychain, with Git Credential Manager), not by Tributary.`,
          content: (
            <Button
              kind="outline"
              onClick={async () => {
                await aiForgetKey(setup).catch(() => {});
                setKey({ kept: false, ends: null });
              }}
            >
              Forget it
            </Button>
          ),
        }
      : {
          kind: "custom",
          label: local ? "API key (if it needs one)" : "API key",
          hint:
            key === null
              ? "Checking…"
              : `${page ? `Made at ${page.replace("https://", "")}. ` : ""}It's checked with ${COMPANY[setup.provider]}, then kept where git keeps your passwords (your system's keychain), not by Tributary.`,
          content: (
            <form
              className="ai-key-form"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <input
                className="text-input settings-input"
                type="password"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder={setup.provider === "anthropic" ? "sk-ant-…" : setup.provider === "openai" ? "sk-…" : setup.provider === "gemini" ? "AIza…" : "Optional"}
                disabled={key === null}
                aria-label="API key"
              />
              <Button type="submit" kind="primary" disabled={saving || !typed.trim()}>
                {saving ? "Checking…" : "Save"}
              </Button>
              {keyError && <p className="review-error">{keyError}</p>}
            </form>
          ),
        },
  );
  rows.push({
    kind: "select",
    label: "Model",
    hint: modelsError
      ? `Couldn't list the models: ${modelsError}`
      : !ready
        ? "Add the key first: the list comes from the provider."
        : models === null
          ? "Asking for the list…"
          : "Automatic is the newest of the quick ones, which are plenty for a commit message and cost the least.",
    value: setup.model,
    options: [
      { value: "", label: picked ? `Automatic (${picked.name})` : "Automatic" },
      ...(chosenListed ? [] : [{ value: setup.model, label: setup.model }]),
      ...(models?.models ?? []).map((model) => ({ value: model.id, label: model.name })),
    ],
    set: (value) => setSetup({ ...setup, model: value }),
    disabled: models === null,
  });
  rows.push(
    {
      kind: "select",
      label: "Style",
      hint: "How messages are written. The menu beside the sparkle changes it too.",
      value: style,
      options: STYLES.map((choice) => ({ value: choice.value, label: choice.label })),
      set: (value) => setStyle(value as MessageStyle),
    },
    {
      kind: "custom",
      label: "What's sent",
      hint: "Only your staged changes, only when you click the sparkle, straight to the provider: each file's changes cut short when they're long, files in Git LFS and files that aren't text by name only, the branch's name and, for this repository's style, its last commit summaries.",
      content: null,
    },
  );
  return rows;
}
