import { useState } from "react";
import { GITLAB_COM, type Accounts, type Forge } from "../app/useAccounts";
import { Avatar } from "./Avatar";
import { ContextMenu } from "./ContextMenu";
import { UserIcon, WarningIcon } from "./Icons";

interface Props {
  accounts: Accounts;
  onSignIn: (forge: Forge) => void;
}

/**
 * Who you're signed in as on GitHub and GitLab, one chip each: a click on a signed-in one
 * offers signing in as someone else or signing out, on a signed-out one signing in.
 */
export function AccountChips({ accounts, onSignIn }: Props) {
  const [menu, setMenu] = useState<{ forge: Forge; x: number; y: number } | null>(null);
  const { github, gitlab } = accounts;
  const gitlabName = gitlab.host === GITLAB_COM ? "GitLab" : gitlab.host;
  const chips: { forge: Forge; name: string; login: string | null; fullName: string | null; checking: boolean; rejected: boolean }[] = [
    {
      forge: "github",
      name: "GitHub",
      login: github.status?.account?.login ?? null,
      fullName: github.status?.account?.name ?? null,
      checking: !github.status && !github.error,
      rejected: Boolean(github.status?.tokenRejected),
    },
    {
      forge: "gitlab",
      name: gitlabName,
      login: gitlab.status?.account?.username ?? null,
      fullName: gitlab.status?.account?.name ?? null,
      checking: !gitlab.status && !gitlab.error,
      rejected: Boolean(gitlab.status?.tokenRejected),
    },
  ];
  return (
    <div className="account-chips">
      {chips.map((chip) =>
        chip.login ? (
          <button
            key={chip.forge}
            className="account-chip on"
            title={`Signed in to ${chip.name} as ${chip.login}${chip.fullName ? ` (${chip.fullName})` : ""}`}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setMenu({ forge: chip.forge, x: rect.left, y: rect.bottom + 4 });
            }}
          >
            <Avatar name={chip.fullName || chip.login} email="" size={20} />
            <span>{chip.name}</span>
            <span className="account-login">@{chip.login}</span>
          </button>
        ) : (
          <button key={chip.forge} className={`account-chip${chip.rejected ? " rejected" : ""}`} onClick={() => onSignIn(chip.forge)} disabled={chip.checking}>
            {chip.rejected ? <WarningIcon size={13} /> : <UserIcon size={13} />}
            <span>{chip.checking ? `${chip.name}…` : chip.rejected ? `Sign in to ${chip.name} again` : `Sign in to ${chip.name}`}</span>
          </button>
        ),
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: "Sign in as someone else…", icon: <UserIcon />, onSelect: () => onSignIn(menu.forge) },
            {
              label: `Sign out of ${menu.forge === "github" ? "GitHub" : gitlabName}`,
              danger: true,
              separated: true,
              detail: "Git forgets the token too, so it asks again when you push",
              onSelect: () => accounts.signOut(menu.forge),
            },
          ]}
        />
      )}
    </div>
  );
}
