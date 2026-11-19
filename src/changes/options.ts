/**
 * The options of "wlz new" before it asks anything.
 */

import { type Kind, resolveKind } from "../project/config.ts";
import { UsageError } from "../shared/foundations.ts";
import { checkMetadataEntry, type Metadata } from "./fragments.ts";

/** A --meta entry split at its first "=", such as ["pr", "42"]. */
export type MetaEntry = readonly [key: string, value: string];

/** The options of "wlz new" as the command line spells them. */
export type NewChangeInput = {
  readonly kind?: string | undefined;
  readonly body?: string | undefined;
  readonly meta?: readonly MetaEntry[] | undefined;
  readonly breaking?: boolean | undefined;
};

/** What "wlz new" knows from its options before it asks anything. */
export type ChangeOptions = {
  readonly kind: Kind | undefined;
  readonly body: string | undefined;
  /** The --meta entries with a value. */
  readonly metadata: Metadata;
  /** Every --meta key, including the ones given an empty value. */
  readonly givenKeys: ReadonlySet<string>;
  /** true for --breaking, false for --no-breaking, and undefined without either. */
  readonly breaking: boolean | undefined;
};

/** Checks that --breaking or --no-breaking agrees with the breaking policy of the kind. */
export function checkBreakingOption(
  kind: Kind,
  breaking: boolean | undefined,
): void {
  const label = JSON.stringify(kind.label);
  if (breaking === true && kind.breaking === "no") {
    throw new UsageError(
      `--breaking contradicts kind ${label}, which never breaks`,
    );
  }
  if (breaking === false && kind.breaking === "yes") {
    throw new UsageError(
      `--no-breaking contradicts kind ${label}, which always breaks`,
    );
  }
}

/** Decimal integers up to 15 digits fit a double exactly. */
const DECIMAL_INTEGER = /^(?:0|[1-9]\d{0,14})$/;

/** Trims the key and the value of a --meta entry, so "pr = 42" means pr=42. */
const trimMetaEntry = ([key, text]: MetaEntry): MetaEntry => [
  key.trim(),
  text.trim(),
];

/**
 * Turns --meta options into metadata. Decimal integers become YAML numbers,
 * so "pr=42" yields "pr: 42". An empty value, such as "pr=" from an unset
 * variable, leaves the entry out.
 */
function metadataFromOptions(options: readonly MetaEntry[]): Metadata {
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
  const metaOptions = (input.meta ?? []).map(trimMetaEntry);
  const kind =
    input.kind === undefined ? undefined : resolveKind(kinds, input.kind);
  if (kind !== undefined) checkBreakingOption(kind, input.breaking);
  return {
    kind,
    body:
      input.body === undefined ? undefined : await readBodyOption(input.body),
    metadata: metadataFromOptions(metaOptions),
    givenKeys: new Set(metaOptions.map(([key]) => key)),
    breaking: input.breaking,
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
