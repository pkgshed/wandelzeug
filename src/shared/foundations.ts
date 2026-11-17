/**
 * Small helpers that every module shares: errors, records, strings and files.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { relative } from "node:path";

/** An error in how the command line was used. It exits with status 2. */
export class UsageError extends Error {
  override name = "UsageError";
}

export type RawRecord = Readonly<Record<string, unknown>>;

export const isRecord = (value: unknown): value is RawRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const hasErrorCode = (error: unknown, code: string): boolean =>
  error instanceof Error && (error as NodeJS.ErrnoException).code === code;

/** Runs an action and prefixes any error it throws with the given context. */
export function withContext<T>(context: string, action: () => T): T {
  try {
    return action();
  } catch (error) {
    throw new Error(`${context}: ${errorMessage(error)}`, { cause: error });
  }
}

/** The outcome of an action that may throw. */
type Attempt<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

/** Runs an action and captures its error message instead of throwing it. */
export function attempt<T>(action: () => T): Attempt<T> {
  try {
    return { ok: true, value: action() };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

/** Returns the first value that occurs more than once. */
export const findDuplicate = (values: readonly string[]): string | undefined =>
  values.find((value, index) => values.indexOf(value) !== index);

/** Formats a count with a noun that takes a plain "s" in the plural. */
export const countOf = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Orders strings by UTF-16 code units, so the result never depends on the locale. */
export function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export const mapValues = <V, W>(
  record: Readonly<Record<string, V>>,
  map: (value: V) => W,
): Record<string, W> =>
  Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, map(value)]),
  );

/** Formats a path relative to the working directory for messages. */
export const displayPath = (path: string): string =>
  relative(process.cwd(), path) || ".";

/** Lists a directory in a stable order. A missing directory has no entries. */
export async function listDirectory(directory: string): Promise<string[]> {
  try {
    const names = await readdir(directory);
    return names.sort(compareStrings);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return [];
    throw error;
  }
}

/** Creates a file unless it exists already, and reports whether it did. */
export async function readOptionalFile(
  path: string,
): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

export async function writeNewFile(
  path: string,
  content: string,
): Promise<boolean> {
  try {
    await writeFile(path, content, { flag: "wx" });
    return true;
  } catch (error) {
    if (hasErrorCode(error, "EEXIST")) return false;
    throw error;
  }
}
