import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);

const profileSchema = z
  .object({
    payloadUrl: z.url().optional(),
    apiKey: z.string().min(1).optional(),
    credentialCommand: z.string().min(1).optional(),
    authCollection: z.string().min(1).optional(),
    outputDir: z.string().min(1).optional(),
  })
  .refine((p) => !(p.apiKey && p.credentialCommand), {
    message: "Profile cannot set both apiKey and credentialCommand",
    path: ["credentialCommand"],
  });

export type Profile = z.infer<typeof profileSchema>;

const profilesFileSchema = z.record(z.string(), profileSchema);

export type ProfilesFile = z.infer<typeof profilesFileSchema>;

function getProfilesDir(): string {
  return path.join(os.homedir(), ".payload-content");
}

function getProfilesPath(): string {
  return path.join(getProfilesDir(), "profiles.json");
}

export async function loadProfiles(): Promise<ProfilesFile> {
  const filePath = getProfilesPath();
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return profilesFileSchema.parse(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw err;
  }
}

export async function saveProfiles(profiles: ProfilesFile): Promise<void> {
  const dir = getProfilesDir();
  const filePath = getProfilesPath();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  // mkdir's mode is only applied on creation; chmod ensures existing dirs
  // are tightened too. Best-effort on Windows where POSIX modes are a no-op.
  await fs.chmod(dir, 0o700).catch(() => {});
  await fs.writeFile(filePath, JSON.stringify(profiles, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
  await fs.chmod(filePath, 0o600).catch(() => {});
}

export async function getProfile(name: string): Promise<Profile | undefined> {
  const profiles = await loadProfiles();
  return profiles[name];
}

export async function setProfile(name: string, profile: Profile): Promise<void> {
  const profiles = await loadProfiles();
  profiles[name] = profile;
  await saveProfiles(profiles);
}

export async function removeProfile(name: string): Promise<boolean> {
  const profiles = await loadProfiles();
  if (!(name in profiles)) return false;
  delete profiles[name];
  await saveProfiles(profiles);
  return true;
}

export async function listProfiles(): Promise<string[]> {
  const profiles = await loadProfiles();
  return Object.keys(profiles);
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) return "*".repeat(16);
  return "*".repeat(12) + key.slice(-4);
}

const CREDENTIAL_COMMAND_TIMEOUT_MS = 30_000;

/**
 * Run a user-configured credential helper and return its stdout (trimmed).
 *
 * Modeled on AWS CLI's `credential_process` and Claude Code's `apiKeyHelper`:
 * the command is interpreted by the platform shell, so users can write
 * idiomatic invocations like `op read 'op://Private/payload/api-key'` or
 * `pass show payload/prod` without us reaching into any specific keychain.
 *
 * The default 30s timeout is sized for interactive helpers — most notably
 * macOS Keychain items with an "Always Ask" ACL, where the user has to
 * type their login password into a system prompt before `security` returns.
 */
export async function runCredentialCommand(
  command: string,
  options: { timeoutMs?: number } = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? CREDENTIAL_COMMAND_TIMEOUT_MS;
  const isWindows = process.platform === "win32";
  const shell = isWindows ? "cmd.exe" : "/bin/sh";
  const shellFlag = isWindows ? "/c" : "-c";

  try {
    const { stdout } = await execFileAsync(shell, [shellFlag, command], {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    });
    const key = stdout.trim();
    if (!key) {
      throw new Error(`credentialCommand produced empty output: ${command}`);
    }
    return key;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stderr?: string;
      code?: string | number;
      killed?: boolean;
      signal?: NodeJS.Signals;
    };
    // execFile sets killed=true and signal=SIGTERM when its `timeout` fires.
    // Surface that as a distinct, actionable message so callers (humans and
    // agents) can tell "user didn't approve the Keychain prompt in time"
    // apart from "the helper itself failed".
    if (e.killed && e.signal === "SIGTERM") {
      throw new Error(
        `credentialCommand timed out after ${Math.round(timeoutMs / 1000)}s (${command}). ` +
          `On macOS this usually means the Keychain access prompt was not approved in time — ` +
          `re-run the command and approve the prompt when it appears.`,
      );
    }
    const stderr = typeof e.stderr === "string" ? e.stderr.trim() : "";
    const reason = stderr || e.message;
    throw new Error(`credentialCommand failed (${command}): ${reason}`);
  }
}

/**
 * Resolve any deferred secret material on a profile (currently only
 * `credentialCommand`) and return a flat profile with `apiKey` populated.
 * The result is in-memory only; we never write the resolved key back to disk.
 */
export async function materializeProfile(profile: Profile): Promise<Profile> {
  if (!profile.credentialCommand) return profile;
  const apiKey = await runCredentialCommand(profile.credentialCommand);
  const { credentialCommand: _omit, ...rest } = profile;
  return { ...rest, apiKey };
}

export async function resolveProfile(name: string): Promise<Profile> {
  const profile = await getProfile(name);
  if (!profile) {
    const available = await listProfiles();
    const hint = available.length
      ? ` Available profiles: ${available.join(", ")}`
      : " No profiles configured. Run 'payload-content profile add <name>' to create one.";
    throw new Error(`Profile "${name}" not found.${hint}`);
  }
  return profile;
}
