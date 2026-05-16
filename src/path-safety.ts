import * as path from "node:path";

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export function assertSafePathSegment(value: string, label: string): void {
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    path.basename(value) !== value ||
    WINDOWS_RESERVED_NAMES.test(value)
  ) {
    throw new Error(`Unsafe ${label}: ${JSON.stringify(value)}`);
  }
}

export function assertInsideDirectory(
  baseDir: string,
  targetPath: string,
): void {
  const relative = path.relative(baseDir, targetPath);
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Refusing to write outside ${baseDir}: ${targetPath}`);
  }
}

export function safeJoinPath(
  baseDir: string,
  ...segments: [string, ...string[]]
): string {
  for (const segment of segments) {
    assertSafePathSegment(segment, "path segment");
  }
  const targetPath = path.join(baseDir, ...segments);
  assertInsideDirectory(baseDir, targetPath);
  return targetPath;
}
