import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

function shellQuote(s: string): string {
  // POSIX single-quote escape — safe for sh -c invocations on macOS/Linux.
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Canonical service/account naming for payload-content-managed Keychain
 * entries. Centralized so `profile add --keychain` and `profile remove`
 * agree on what we own.
 */
export function keychainEntryFor(profileName: string): { service: string; account: string } {
  return { service: `payload-content/${profileName}`, account: profileName };
}

export function buildKeychainCommand(profileName: string): string {
  const { service, account } = keychainEntryFor(profileName);
  return `security find-generic-password -w -s ${shellQuote(service)} -a ${shellQuote(account)}`;
}

/**
 * True when `command` is exactly the credentialCommand we would have written
 * for this profile. Used to decide whether `profile remove` should also
 * delete the underlying Keychain entry — we only touch entries we created,
 * never a user-authored `credentialCommand` (op, pass, vault, …).
 */
export function isManagedKeychainCommand(
  profileName: string,
  command: string | undefined,
): boolean {
  return command !== undefined && command === buildKeychainCommand(profileName);
}

export async function storeInMacKeychain(
  service: string,
  account: string,
  secret: string,
  options: { promptOnAccess?: boolean } = {},
): Promise<void> {
  // -U upserts (replaces an existing entry without prompting).
  // -w sets the password; passing it via argv keeps it off any shell history.
  //
  // ACL behavior:
  //   default (promptOnAccess=false): no -T flag. macOS's default ACL trusts
  //     /usr/bin/security itself, so subsequent `security find-generic-password`
  //     reads succeed silently. Good ergonomics for non-interactive use
  //     (CI, scripts, agents) but a process running as the user can also
  //     read it silently.
  //   promptOnAccess=true: pass `-T ""` for an empty trusted-apps list.
  //     macOS then prompts the user on every read, regardless of caller.
  //     Use for production keys or shared machines.
  const args = ["add-generic-password", "-U", "-s", service, "-a", account, "-w", secret];
  if (options.promptOnAccess) {
    args.push("-T", "");
  }
  try {
    await execFileP("security", args);
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    const reason = (e.stderr && String(e.stderr).trim()) || e.message;
    throw new Error(`Failed to store secret in macOS Keychain: ${reason}`);
  }
}

export async function deleteFromMacKeychain(
  service: string,
  account: string,
): Promise<"deleted" | "missing"> {
  try {
    await execFileP("security", ["delete-generic-password", "-s", service, "-a", account]);
    return "deleted";
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    const reason = (e.stderr && String(e.stderr).trim()) || e.message;
    // Item already gone — user nuked it via Keychain Access, or never created.
    // The goal is "make sure it's not there," so treat missing as success.
    if (/could not be found|errSecItemNotFound/i.test(reason)) {
      return "missing";
    }
    throw new Error(`Failed to delete Keychain entry: ${reason}`);
  }
}
