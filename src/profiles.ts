import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { z } from "zod";

const profileSchema = z.object({
  payloadUrl: z.url().optional(),
  apiKey: z.string().min(1).optional(),
  authCollection: z.string().min(1).optional(),
  outputDir: z.string().min(1).optional(),
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

export async function setProfile(
  name: string,
  profile: Profile,
): Promise<void> {
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
