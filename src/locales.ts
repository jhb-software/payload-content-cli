/**
 * Why a locale can't be used, or undefined if it can. Payload reads the default
 * locale instead of an unknown one and drops writes to it, without an error.
 * Shared by the CLI and the MCP tools; `name` is how the caller passed it.
 */
export function localeProblem(
  locale: string,
  locales: string[] | null,
  name: string,
): string | undefined {
  if (!locales) return `This app has no locales. Leave out ${name}.`;
  // Payload reads `*` as `all`.
  if (locale === "all" || locale === "*" || locales.includes(locale)) return undefined;
  return `Unknown locale "${locale}". Use one of: ${locales.join(", ")}.`;
}
