// SSH keys: the public halves in ~/.ssh, making a new key, and whether a host accepts one.
import { invoke } from "./invoke";
import type { SshCheck, SshKey } from "./generated";
export type { SshCheck, SshKey };

/** The SSH keys in ~/.ssh, by their public halves (the private ones are never read). */
export function sshKeys(): Promise<SshKey[]> {
  return invoke("ssh_keys");
}

/** Make a new Ed25519 key called `name` with ssh-keygen (never over one already there). */
export function generateSshKey(name: string, comment: string, passphrase: string): Promise<SshKey> {
  return invoke("generate_ssh_key", { name, comment, passphrase });
}

/** Whether `host` (like github.com) lets the key in, and as whom. */
export function checkSshKey(host: string, publicKey: string): Promise<SshCheck> {
  return invoke("check_ssh_key", { host, publicKey });
}
