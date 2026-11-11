import { useLayoutEffect, useState, type ReactNode } from "react";
import * as Icons from "../components/Icons";
import { BUTTON_SIZES, Button, type ButtonKind } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";
import { Field } from "../components/ui/Field";
import { Switch } from "../components/ui/Switch";
import { DEFAULT_APPEARANCE, applyAppearance, lanePalette } from "../lib/appearance";
import "./catalogue.css";

/**
 * The catalogue: the app's building blocks on one page, to see them together and keep them
 * alike. Open the app with `?catalogue` (`npm run dev`, or the browser preview): it shows the
 * page twice, dark and light, side by side; `?catalogue&theme=dark` (or `light`) shows one.
 */
export default function Catalogue() {
  const theme = new URLSearchParams(location.search).get("theme");
  if (theme !== "dark" && theme !== "light") {
    return (
      <div className="catalogue-frames">
        <iframe title="Dark" src="?catalogue&theme=dark" />
        <iframe title="Light" src="?catalogue&theme=light" />
      </div>
    );
  }
  return <Page theme={theme} />;
}

const KINDS: { kind: ButtonKind; content: ReactNode; use: string }[] = [
  { kind: "primary", content: "Create branch", use: "The one thing to do in a dialog or a card." },
  { kind: "secondary", content: "Cancel", use: "Anything else beside it." },
  { kind: "outline", content: "Request changes", use: "Actions in a panel or a row, quieter than a dialog's." },
  { kind: "danger", content: "Delete branch", use: "Something that can't be taken back." },
  { kind: "link", content: "Show everything", use: "An action that reads as part of the text." },
  { kind: "icon", content: <Icons.GearIcon />, use: "An icon alone, with a title saying what it does." },
  {
    kind: "tool",
    content: (
      <>
        <Icons.FetchIcon />
        <span className="label">Fetch</span>
      </>
    ),
    use: "The toolbar's.",
  },
];

function Page({ theme }: { theme: "dark" | "light" }) {
  useLayoutEffect(() => applyAppearance(DEFAULT_APPEARANCE, theme), [theme]);
  const tokens = useTokens(theme);
  const [on, setOn] = useState(true);
  const icons = Object.entries(Icons).filter(([name]) => name.endsWith("Icon")) as [string, (props: { size?: number }) => ReactNode][];

  return (
    <div className="catalogue">
      <header className="catalogue-head">
        <Icons.Logo size={28} />
        <div>
          <h1>Tributary's building blocks</h1>
          <p>{theme === "dark" ? "Dark" : "Light"}, with the default accent. The scales and colours are in theme.css; the parts in src/components/ui.</p>
        </div>
      </header>

      <Section title="Text" note="Nine steps: most of the interface is --type-sm, captions and counts --type-xs, text to read --type-base.">
        {tokens.text.map(([name, value]) => (
          <div key={name} className="catalogue-row">
            <code>
              {name} <span>{value}</span>
            </code>
            <span style={{ fontSize: `var(${name})` }}>Make the door creak</span>
          </div>
        ))}
      </Section>

      <Section title="Corners" note="Small marks and tags, then buttons and fields, then cards and windows.">
        <div className="catalogue-wrap">
          {tokens.radius.map(([name, value]) => (
            <div key={name} className="catalogue-corner">
              <span style={{ borderRadius: `var(${name})` }} />
              <code>
                {name} <span>{value}</span>
              </code>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Colours" note="Every colour role the theme defines, as it is in this theme.">
        <div className="catalogue-grid">
          {tokens.colours.map(([name, value]) => (
            <div key={name} className="catalogue-colour">
              <span style={{ background: `var(${name})` }} />
              <code title={value}>{name}</code>
            </div>
          ))}
        </div>
        <h3>Graph lanes</h3>
        <div className="catalogue-wrap">
          {lanePalette(DEFAULT_APPEARANCE, theme).map((colour, index) => (
            <span key={index} className="catalogue-lane" style={{ background: colour }} title={colour} />
          ))}
        </div>
      </Section>

      <Section title="Buttons" note="<Button kind=…>: each kind, its sizes, and turned off.">
        {KINDS.map(({ kind, content, use }) => (
          <div key={kind} className="catalogue-row">
            <code>
              {kind}
              <small>{use}</small>
            </code>
            <div className="catalogue-wrap">
              <Button kind={kind} title={kind}>
                {content}
              </Button>
              {BUTTON_SIZES[kind].map((size) => (
                <Button key={size} kind={kind} size={size} title={`${kind}, ${size}`}>
                  {content}
                </Button>
              ))}
              <Button kind={kind} disabled title={`${kind}, turned off`}>
                {content}
              </Button>
            </div>
          </div>
        ))}
        <div className="catalogue-row">
          <code>
            with an icon
            <small>The label trimmed to its letters, so it lines up with the icon.</small>
          </code>
          <div className="catalogue-wrap">
            <Button kind="outline">
              <Icons.DownloadIcon size={14} />
              <span className="button-label">Export to a file…</span>
            </Button>
            <Button kind="secondary">
              <Icons.BranchPlusIcon size={14} />
              <span className="button-label">New branch</span>
            </Button>
          </div>
        </div>
      </Section>

      <Section title="Switches" note="<Switch>: for a setting that takes effect straight away.">
        <div className="catalogue-wrap">
          <Switch on={on} onChange={setOn} label="A switch to try" />
          <Switch on={false} onChange={() => {}} label="Off" />
          <Switch on onChange={() => {}} label="On" />
          <Switch on onChange={() => {}} label="Turned off" disabled />
        </div>
      </Section>

      <Section title="Fields" note="<Field label=…>: what it's for, then its input.">
        <div className="catalogue-fields">
          <Field label="Branch name">
            <input className="text-input" defaultValue="feature/tavern-door" />
          </Field>
          <Field label="Message (optional)">
            <textarea className="text-input" rows={2} defaultValue="Make the door creak when it opens." />
          </Field>
          <Field label="Turned off">
            <input className="text-input" defaultValue="origin" disabled />
          </Field>
          <Field group label="Into">
            <div className="field-row">
              <input className="text-input" defaultValue="~/Projects" readOnly />
              <Button kind="secondary">Choose…</Button>
            </div>
          </Field>
        </div>
      </Section>

      <Section title="Chips" note="<Chip>: an icon (if any), then text trimmed to its letters so it sits in the middle.">
        <h3>States</h3>
        <div className="catalogue-wrap">
          <Chip className="request-state open" icon={<Icons.PullRequestIcon size={13} />}>
            Open
          </Chip>
          <Chip className="request-state draft" icon={<Icons.PullRequestIcon size={13} />}>
            Draft
          </Chip>
          <Chip className="request-state merged" icon={<Icons.MergeIcon size={13} />}>
            Merged
          </Chip>
          <Chip className="request-state closed" icon={<Icons.CloseIcon size={12} />}>
            Closed
          </Chip>
          <Chip className="request-review approved">Approved</Chip>
          <Chip className="request-review changesRequested">Asked for changes</Chip>
          <Chip className="request-review commented">Reviewed</Chip>
          <Chip className="about-beta">Beta</Chip>
        </div>
        <div className="catalogue-wrap">
          <Chip className="recent-chip changes">3 changes</Chip>
          <Chip className="recent-chip conflicts">1 conflict</Chip>
          <Chip className="recent-chip sync">
            <span>↑2</span>
            <span>↓1</span>
          </Chip>
          <Chip className="recent-chip missing">Folder not found</Chip>
        </div>
        <h3>Names</h3>
        <div className="catalogue-wrap">
          <span className="head-chip" title="Checked out branch">
            <Icons.BranchIcon size={14} />
            <span className="head-chip-name chip-text">feature/tavern-door</span>
          </span>
          <Chip className="request-ref">feature/tavern-door</Chip>
          <span className="name-chip">
            <span className="chip-text">main</span>
            <button aria-label="Remove main" title="Remove main">
              <Icons.CloseIcon size={10} />
            </button>
          </span>
          <Chip className="team-branch-chip">art/barber-v2</Chip>
          <span className="pr-badge success">
            <span className="pr-number chip-text">#12</span>
          </span>
          <span className="pr-badge failure">
            <span className="pr-number chip-text">#14</span>
          </span>
          <span className="pr-badge pending">
            <span className="pr-number chip-text">#19</span>
          </span>
          <span className="pr-badge draft">
            <span className="pr-number chip-text">#21</span>
          </span>
        </div>
      </Section>

      <Section title="Icons" note={`All ${icons.length}, at 16px (they take a size).`}>
        <div className="catalogue-icons">
          {icons.map(([name, Icon]) => (
            <div key={name} title={name}>
              <Icon />
              <code>{name.replace(/Icon$/, "")}</code>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="catalogue-section">
      <h2>{title}</h2>
      <p>{note}</p>
      {children}
    </section>
  );
}

interface Tokens {
  text: [string, string][];
  radius: [string, string][];
  colours: [string, string][];
}

/** The tokens theme.css puts on :root, with their values in this theme, read from the page. */
function useTokens(theme: string): Tokens {
  const [tokens, setTokens] = useState<Tokens>({ text: [], radius: [], colours: [] });
  useLayoutEffect(() => {
    const names = new Set<string>();
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule && rule.selectorText === ":root") {
          for (const name of Array.from(rule.style)) if (name.startsWith("--")) names.add(name);
        }
      }
    }
    const style = getComputedStyle(document.documentElement);
    const all = [...names].map((name): [string, string] => [name, style.getPropertyValue(name).trim()]);
    const px = (value: string) => parseFloat(value) || 0;
    setTokens({
      text: all.filter(([name]) => name.startsWith("--type-")).sort((a, b) => px(a[1]) - px(b[1])),
      radius: all.filter(([name]) => name.startsWith("--radius-")).sort((a, b) => px(a[1]) - px(b[1])),
      colours: all.filter(([, value]) => value !== "" && CSS.supports("color", value)),
    });
  }, [theme]);
  return tokens;
}
