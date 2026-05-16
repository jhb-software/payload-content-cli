import { z } from "zod";
import dotenv from "dotenv";
import type { Profile } from "./profiles.js";

const configSchema = z.object({
  payloadUrl: z.url().optional(),
  apiKey: z.string().min(1).optional(),
  authCollection: z.string().default("api-keys"),
  outputDir: z.string().default("content"),
});

export type Config = z.infer<typeof configSchema>;

// Load .env into a separate bag rather than process.env. This lets us treat
// .env as a fallback that only applies when no profile is selected — matching
// AWS/Stripe CLI behavior where ambient cwd config does not silently shadow
// an explicit profile selection. Real env vars (set in the shell) still
// override profile values, and we warn when that happens.
const dotenvBag: Record<string, string> = {};
dotenv.config({ processEnv: dotenvBag, quiet: true });

const warnedKeys = new Set<string>();

function resolveEnv(key: string, hasProfile: boolean): string | undefined {
  return process.env[key] ?? (hasProfile ? undefined : dotenvBag[key]);
}

function warnIfShadowed(
  key: string,
  profileValue: string | undefined,
  envValue: string | undefined,
): void {
  if (
    profileValue === undefined ||
    envValue === undefined ||
    profileValue === envValue ||
    warnedKeys.has(key)
  ) {
    return;
  }
  warnedKeys.add(key);
  console.warn(
    `Warning: profile value for ${key} is overridden by environment variable ${key}.`,
  );
}

/**
 * Resolution order (last wins):
 * 1. Profile values (from --profile or PAYLOAD_PROFILE)
 * 2. .env (only when no profile is selected)
 * 3. Real environment variables (process.env)
 * 4. Explicit overrides (programmatic callers)
 */
export function loadConfig(
  overrides?: Partial<Config>,
  profile?: Profile,
): Config {
  const hasProfile = profile !== undefined;

  const url = resolveEnv("PAYLOAD_URL", hasProfile);
  const apiKey = resolveEnv("PAYLOAD_API_KEY", hasProfile);
  const authCollection = resolveEnv("PAYLOAD_AUTH_COLLECTION", hasProfile);
  const outputDir = resolveEnv("PAYLOAD_OUTPUT_DIR", hasProfile);

  if (hasProfile) {
    warnIfShadowed("PAYLOAD_URL", profile.payloadUrl, url);
    warnIfShadowed("PAYLOAD_API_KEY", profile.apiKey, apiKey);
    warnIfShadowed(
      "PAYLOAD_AUTH_COLLECTION",
      profile.authCollection,
      authCollection,
    );
    warnIfShadowed("PAYLOAD_OUTPUT_DIR", profile.outputDir, outputDir);
  }

  return configSchema.parse({
    payloadUrl: overrides?.payloadUrl ?? url ?? profile?.payloadUrl,
    apiKey: overrides?.apiKey ?? apiKey ?? profile?.apiKey,
    authCollection: authCollection ?? profile?.authCollection ?? "api-keys",
    outputDir:
      overrides?.outputDir ?? outputDir ?? profile?.outputDir ?? "content",
  });
}

export function resolvePayloadProfile(): string | undefined {
  return process.env.PAYLOAD_PROFILE ?? dotenvBag.PAYLOAD_PROFILE;
}

export function requireRemoteConfig(
  config: Config,
): asserts config is Config & { payloadUrl: string; apiKey: string } {
  const missing: string[] = [];
  if (!config.payloadUrl) missing.push("PAYLOAD_URL");
  if (!config.apiKey) missing.push("PAYLOAD_API_KEY");
  if (missing.length > 0) {
    throw new Error(
      `Missing required env vars: ${missing.join(", ")}. Set them in .env.`,
    );
  }
}
