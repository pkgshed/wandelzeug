/**
 * The data block of a release: what "wlz render" needs to render the
 * release again after a template changed. It holds the date and the
 * changes of the release, and a hash of the notes as wandelzeug last
 * rendered them, which reveals edits by hand. The block is an HTML comment
 * at the bottom of the release, which Markdown viewers hide: the date and
 * the hash as attributes on its first line, and the changes as YAML below.
 */

import { createHash } from "node:crypto";
import {
  type Change,
  changeFromFields,
  type MetadataValue,
  yamlEntry,
} from "../changes/fragments.ts";
import { isRecord, withContext } from "../shared/foundations.ts";
import { type IsoDate, parseIsoDate } from "../shared/versions.ts";

/** A hash of rendered notes, such as "h1:LXEWQrcmsEQBYnyp+6wy9Q==". */
export type NotesHash = string & { readonly __brand: "NotesHash" };

/** What a release needs to render again. */
export type ReleaseData = {
  readonly date: IsoDate;
  /** The hash of the notes as wandelzeug rendered them last. */
  readonly hash: NotesHash;
  /**
   * The changes, which the data block groups by kind in the order that
   * they come here. Their kinds stay as recorded, so a kind that left the
   * configuration shows up when the release renders instead of vanishing.
   */
  readonly changes: readonly Change[];
};

/**
 * Hashes rendered notes: "h1:" and the base64 of the first 128 bits of
 * their SHA-256. The notes count without surrounding blank lines and with
 * "\n" line breaks, so the line breaks of the file do not matter.
 */
export function notesHash(notes: string): NotesHash {
  const text = notes.replace(/\r\n/g, "\n").trim();
  const digest = createHash("sha256").update(text).digest();
  return `h1:${digest.subarray(0, 16).toString("base64")}` as NotesHash;
}

const NOTES_HASH = /^h1:[A-Za-z0-9+/]{22}==$/;

/** Text that would end the HTML comment around the data block. */
const COMMENT_END = /--!?>/;

/**
 * Formats one entry of the data block. A value that holds "-->" or "--!>"
 * would end the comment early, so it becomes a double-quoted string in
 * which the second dash is the escape \x2D.
 */
function dataEntry(key: string, value: MetadataValue): string {
  const endsComment = typeof value === "string" && COMMENT_END.test(value);
  if (!endsComment) return yamlEntry(key, value);
  const escaped = JSON.stringify(value).replace(/--(?=!?>)/g, "-\\x2D");
  return `${Bun.YAML.stringify(key)}: ${escaped}`;
}

/** Formats a kind as a key of the changes, with the same care for comment ends as dataEntry. */
function kindKey(kind: string): string {
  if (!COMMENT_END.test(kind)) return Bun.YAML.stringify(kind);
  return JSON.stringify(kind).replace(/--(?=!?>)/g, "-\\x2D");
}

/** Formats a change as an item of the list below its kind: its metadata, then its body. */
function changeItem(change: Change): string[] {
  const entries = [
    ...Object.entries(change.metadata).map(([key, value]) =>
      dataEntry(key, value),
    ),
    dataEntry("body", change.body),
  ];
  return entries
    .join("\n")
    .split("\n")
    .map((line, index) => {
      if (index === 0) return `  - ${line}`;
      return line === "" ? "" : `    ${line}`;
    });
}

/** Groups changes by kind, with the kinds in the order of their first change. */
function groupByKind(
  changes: readonly Change[],
): (readonly [string, readonly Change[]])[] {
  const kinds = [...new Set(changes.map((change) => change.kind))];
  return kinds.map((kind) => [
    kind,
    changes.filter((change) => change.kind === kind),
  ]);
}

/** Formats the date and the hash of a data block as attributes, such as "date=2026-11-17 hash=h1:...". */
export const formatDataAttributes = (data: ReleaseData): string =>
  `date=${data.date} hash=${data.hash}`;

/** Formats the changes of a data block as YAML that maps each kind to its changes. */
export const formatDataChanges = (changes: readonly Change[]): string[] =>
  groupByKind(changes).flatMap(([kind, group]) => [
    `${kindKey(kind)}:`,
    ...group.flatMap(changeItem),
  ]);

const DATA_ATTRIBUTES = ["date", "hash"] as const;
type DataAttribute = (typeof DATA_ATTRIBUTES)[number];

const isDataAttribute = (key: string): key is DataAttribute =>
  (DATA_ATTRIBUTES as readonly string[]).includes(key);

/** Splits attributes such as "date=2026-11-17 hash=h1:..." into their values. */
function parseDataAttributes(
  text: string,
): Partial<Record<DataAttribute, string>> {
  const entries = text.split(/\s+/).filter((entry) => entry !== "");
  return entries.reduce<Partial<Record<DataAttribute, string>>>(
    (attributes, entry) => {
      const separator = entry.indexOf("=");
      const key = entry.slice(0, Math.max(separator, 0));
      if (!isDataAttribute(key)) {
        throw new Error(
          `unknown data attribute ${JSON.stringify(entry)}, expected date=YYYY-MM-DD and hash=h1:...`,
        );
      }
      if (attributes[key] !== undefined) {
        throw new Error(`the data attribute ${key} appears twice`);
      }
      return { ...attributes, [key]: entry.slice(separator + 1) };
    },
    {},
  );
}

function parseDataDate(value: string | undefined): IsoDate {
  const date = value === undefined ? undefined : parseIsoDate(value);
  if (date === undefined) {
    throw new Error("the data block needs date=YYYY-MM-DD");
  }
  return date;
}

function parseDataHash(value: string | undefined): NotesHash {
  const isHash = value !== undefined && NOTES_HASH.test(value);
  if (!isHash) {
    throw new Error(
      'the data block needs hash= with "h1:" and 24 characters of base64',
    );
  }
  return value as NotesHash;
}

function parseDataChange(kind: string, value: unknown): Change {
  if (!isRecord(value)) {
    throw new Error("must be a mapping");
  }
  const { body, ...fields } = value;
  if ("kind" in fields) {
    throw new Error("kind comes from the group that holds the change");
  }
  if (typeof body !== "string") {
    throw new Error("body is missing");
  }
  return changeFromFields({ kind, ...fields }, body);
}

function parseKindGroup(kind: string, value: unknown): Change[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${kind} must hold a non-empty list of changes`);
  }
  return value.map((item: unknown, index) =>
    withContext(`${kind}[${index}]`, () => parseDataChange(kind, item)),
  );
}

/** Parses the YAML of the changes, which maps each kind to its changes, into one list. */
function parseDataChanges(yaml: string): Change[] {
  const groups: unknown = withContext("data block", () => Bun.YAML.parse(yaml));
  const hasGroups = isRecord(groups) && Object.keys(groups).length > 0;
  if (!hasGroups) {
    throw new Error("the data block must map each kind to a list of changes");
  }
  return Object.entries(groups).flatMap(([kind, group]) =>
    parseKindGroup(kind, group),
  );
}

/** Parses a data block from the attributes on its first line and the YAML of its changes. */
export function parseReleaseData(
  attributes: string,
  yaml: string,
): ReleaseData {
  const values = parseDataAttributes(attributes);
  return {
    date: parseDataDate(values.date),
    hash: parseDataHash(values.hash),
    changes: parseDataChanges(yaml),
  };
}
