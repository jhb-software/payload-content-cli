/**
 * Output routing for `--json`.
 *
 * A machine-readable mode is only useful if stdout carries the payload and
 * nothing else, so in JSON mode the human progress narration moves to stderr
 * rather than being dropped — a scripted `pull` stays observable in a terminal
 * while `$(payload-content pull --json)` still parses.
 *
 * Warnings and errors already go to stderr via console.warn/console.error and
 * need no routing; this module only concerns the progress chatter that would
 * otherwise land in the middle of a JSON document.
 */

let jsonMode = false;

export function setJsonOutput(enabled: boolean): void {
  jsonMode = enabled;
}

export function isJsonOutput(): boolean {
  return jsonMode;
}

/** Human-facing progress: stdout normally, stderr when stdout is reserved for JSON. */
export function progress(message: string): void {
  if (jsonMode) console.error(message);
  else console.log(message);
}

/** Write the machine-readable result. Always stdout, always the only thing there. */
export function emitJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}
