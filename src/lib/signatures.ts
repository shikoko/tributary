// Commit signatures, in words.
import type { CommitSignature } from "../api";

const KINDS: Record<CommitSignature["kind"], string> = { gpg: "GPG", ssh: "SSH", x509: "X.509" };

/** A signature's mark ("Verified"), how it looks, and what it means. */
export function describeSignature(signature: CommitSignature): { label: string; tone: "good" | "neutral" | "warning" | "bad"; detail: string } {
  const kind = KINDS[signature.kind];
  const by = signature.signer ? ` by ${signature.signer}` : "";
  const key = signature.key ? ` (${kind} key ${signature.key})` : ` (${kind})`;
  switch (signature.status) {
    case "good":
      return { label: "Verified", tone: "good", detail: `Signed${by}${key}, and the signature checks out.` };
    case "untrusted":
      return { label: "Signed", tone: "neutral", detail: `A good signature${by}${key}, but the key isn't trusted on this computer.` };
    case "expired":
      return { label: "Signed, expired", tone: "warning", detail: `A good signature${by}${key}, but the key or the signature has expired.` };
    case "revoked":
      return { label: "Signed, key revoked", tone: "bad", detail: `Signed${by}${key} with a key that has been revoked.` };
    case "bad":
      return { label: "Bad signature", tone: "bad", detail: `The signature${key} doesn't match the commit: it was changed after it was signed.` };
    case "unchecked":
      return {
        label: "Signed",
        tone: "neutral",
        detail:
          signature.kind === "ssh"
            ? "Signed with an SSH key. Git checks SSH signatures against a list of allowed signers (gpg.ssh.allowedSignersFile), which isn't set up here."
            : `Signed${key}, but the key isn't on this computer, so it couldn't be checked.`,
      };
  }
}
