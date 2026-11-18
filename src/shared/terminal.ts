/**
 * What the terminal of an output stream supports.
 */

/** The environment variables that decide about colours. */
type ColorEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Reports whether output to a stream may carry ANSI colours. FORCE_COLOR
 * decides first, as in Node.js and Bun: "0" and "false" turn colours off,
 * and any other value turns them on, even for a pipe. Then a non-empty
 * NO_COLOR turns them off (https://no-color.org). Otherwise, only a
 * terminal other than TERM=dumb gets colours.
 */
export function supportsColor(
  isTerminal: boolean,
  env: ColorEnvironment,
): boolean {
  const forced = env["FORCE_COLOR"];
  if (forced !== undefined) return forced !== "0" && forced !== "false";

  const declined = (env["NO_COLOR"] ?? "") !== "";
  if (declined) return false;

  return isTerminal && env["TERM"] !== "dumb";
}
