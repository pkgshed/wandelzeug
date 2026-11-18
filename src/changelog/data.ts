/**
 * The data block of a release: what "wlz render" needs to render the
 * release again after a template changed. It holds the date and the
 * changes of the release, and a hash of the notes as wandelzeug last
 * rendered them, which reveals edits by hand. The block is YAML in an HTML
 * comment at the bottom of the release, which Markdown viewers hide.
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
   * The changes in the order of their change files. Their kinds stay as
   * recorded, so a kind that left the configuration shows up when the
   * release renders instead of vanishing.
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

/** Formats a change as an item of the changes list. */
function changeItem(change: Change): string[] {
  const entries = [
    dataEntry("kind", change.kind),
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

/** Formats the lines of a data block, without the comment around it. */
export const formatReleaseData = (data: ReleaseData): string[] => [
  dataEntry("date", data.date),
  dataEntry("hash", data.hash),
  "changes:",
  ...data.changes.flatMap(changeItem),
];

const DATA_KEYS = ["date", "hash", "changes"];

function parseDataDate(value: unknown): IsoDate {
  const date = typeof value === "string" ? parseIsoDate(value) : undefined;
  if (date === undefined) {
    throw new Error("date must be a date as YYYY-MM-DD");
  }
  return date;
}

function parseDataHash(value: unknown): NotesHash {
  const isHash = typeof value === "string" && NOTES_HASH.test(value);
  if (!isHash) {
    throw new Error('hash must be "h1:" and 24 characters of base64');
  }
  return value as NotesHash;
}

function parseDataChange(value: unknown): Change {
  if (!isRecord(value)) {
    throw new Error("must be a mapping");
  }
  const { body, ...fields } = value;
  if (typeof body !== "string") {
    throw new Error("body is missing");
  }
  return changeFromFields(fields, body);
}

function parseDataChanges(value: unknown): Change[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("changes must be a non-empty list");
  }
  return value.map((item: unknown, index) =>
    withContext(`changes[${index}]`, () => parseDataChange(item)),
  );
}

/** Parses the YAML of a data block. */
export function parseReleaseData(yaml: string): ReleaseData {
  const fields: unknown = withContext("data block", () => Bun.YAML.parse(yaml));
  if (!isRecord(fields)) {
    throw new Error("the data block must be a mapping");
  }
  const unknown = Object.keys(fields).find((key) => !DATA_KEYS.includes(key));
  if (unknown !== undefined) {
    throw new Error(`unknown data block key ${JSON.stringify(unknown)}`);
  }
  return {
    date: parseDataDate(fields["date"]),
    hash: parseDataHash(fields["hash"]),
    changes: parseDataChanges(fields["changes"]),
  };
}
