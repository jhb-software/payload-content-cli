/**
 * Error thrown by command logic instead of calling process.exit directly.
 * The CLI layer (wrapAction) is the only place that maps errors to exit
 * codes, so all library functions stay usable programmatically.
 */
export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, options?: { exitCode?: number }) {
    super(message);
    this.name = "CliError";
    this.exitCode = options?.exitCode ?? 1;
  }
}
