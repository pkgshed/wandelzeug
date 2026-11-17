/**
 * The options of "wlz new" before it asks anything.
 */

import { type Kind, resolveKind } from "../project/config.ts";
import { UsageError } from "../shared/foundations.ts";
import { checkMetadataEntry, type Metadata } from "./fragments.ts";

/** The options of "wlz new" as the command line spells them. */
export type NewChangeInput = {
  readonly kind?: string | undefined;
  readonly body?: string | undefined;
  readonly meta?: readonly string[] | undefined;
};

/** What "wlz new" knows from its options before it asks anything. */
export type ChangeOptions = {
  readonly kind: Kind | undefined;
  readonly body: string | undefined;
  /** The --meta entries with a value. */
  readonly metadata: Metadata;
  /** Every --meta key, including the ones given an empty value. */
  readonly givenKeys: ReadonlySet<string>;
};

/** Decimal integers up to 15 digits fit a double exactly. */
const DECIMAL_INTEGER = /^(?:0|[1-9]\d{0,14})$/;

function splitMetaOption(option: string): [string, string] {
  const separator = option.indexOf("=");
  if (separator < 1) {
    throw new UsageError(
      `invalid --meta ${JSON.stringify(option)}, expected key=value`,
    );
  }
  const key = option.slice(0, separator).trim();
  const text = option.slice(separator + 1).trim();
  return [key, text];
}

/**
 * Turns --meta options into metadata. Decimal integers become YAML numbers,
 * so "pr=42" yields "pr: 42". An empty value, such as "pr=" from an unset
 * variable, leaves the entry out.
 */
function metadataFromOptions(
  options: readonly (readonly [string, string])[],
): Metadata {
  const entries = options
    .filter(([, text]) => text !== "")
    .map(([key, text]) => {
      const value = DECIMAL_INTEGER.test(text) ? Number(text) : text;
      return checkMetadataEntry(key, value);
    });
  return Object.fromEntries(entries);
}

const readBodyOption = async (body: string): Promise<string> =>
  body === "-" ? await Bun.stdin.text() : body;

/** Reads the options of "wlz new", including a body from stdin. */
export async function readChangeOptions(
  kinds: readonly Kind[],
  input: NewChangeInput,
): Promise<ChangeOptions> {
  const metaOptions = (input.meta ?? []).map(splitMetaOption);
  return {
    kind: input.kind === undefined ? undefined : resolveKind(kinds, input.kind),
    body:
      input.body === undefined ? undefined : await readBodyOption(input.body),
    metadata: metadataFromOptions(metaOptions),
    givenKeys: new Set(metaOptions.map(([key]) => key)),
  };
}

export const isInteractive = (): boolean => process.stdin.isTTY === true;

export function requireTerminal(option: string): void {
  if (!isInteractive()) {
    throw new UsageError(
      `missing ${option}, and stdin is not a terminal to ask for it`,
    );
  }
}
