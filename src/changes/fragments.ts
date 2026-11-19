/**
 * Changes and their fragment files in the unreleased directory.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { type Kind, RESERVED_KEYS, resolveKind } from "../project/config.ts";
import { type Project, unreleasedPath } from "../project/root.ts";
import {
  compareStrings,
  displayPath,
  isRecord,
  listDirectory,
  mapValues,
  type RawRecord,
  withContext,
} from "../shared/foundations.ts";
import { deriveTitle, slugify, truncateSlug } from "../shared/slugs.ts";
import { renderTemplate, type TemplateView } from "../shared/templates.ts";

/** A scalar front matter value. */
export type MetadataValue = string | number | boolean;

/** Front matter entries besides kind, such as a pull request number. */
export type Metadata = Readonly<Record<string, MetadataValue>>;

/** One change. Its kind always holds the label of a configured kind. */
export type Change = {
  readonly kind: string;
  /** Whether the change breaks compatibility, which bumps the major version. */
  readonly breaking: boolean;
  readonly metadata: Metadata;
  readonly body: string;
};

/**
 * A change as its fields state it. Without a "breaking" entry, whoever
 * reads the change decides what that means: a fragment file takes the
 * breaking policy of its kind, and a data block means not breaking.
 */
export type StatedChange = Omit<Change, "breaking"> & {
  readonly breaking: boolean | undefined;
};

/** A change read from a fragment file in the unreleased directory. */
export type Fragment = Change & {
  readonly path: string;
  readonly sequence: number | undefined;
};

export function checkMetadataEntry(
  key: string,
  value: unknown,
): [string, MetadataValue] {
  if (RESERVED_KEYS.includes(key)) {
    throw new Error(`metadata key ${JSON.stringify(key)} is reserved`);
  }
  const isScalar =
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean";
  if (!isScalar) {
    throw new Error(
      `metadata ${JSON.stringify(key)} must be a string, number or boolean`,
    );
  }
  return [key, value];
}

/** Parses front matter entries. An empty YAML value, such as "pr:", means the entry is absent. */
function parseMetadata(fields: RawRecord): Metadata {
  const entries = Object.entries(fields)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => checkMetadataEntry(key, value));
  return Object.fromEntries(entries);
}

type FrontMatterDocument = {
  readonly frontMatter: string;
  readonly body: string;
};

const BARE_LIST_MARKER = /^\s*(?:[*+-]|\d+[.)])(?=\s|$)/gm;

/** Reports whether a body holds no text besides list markers, such as a lone "* ". */
export const isBlankBody = (body: string): boolean =>
  body.replace(BARE_LIST_MARKER, "").trim() === "";

export function splitFrontMatter(text: string): FrontMatterDocument {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0] !== "---") {
    throw new Error('missing front matter, the first line must be "---"');
  }
  const closing = lines.indexOf("---", 1);
  if (closing === -1) {
    throw new Error('unterminated front matter, no closing "---" line');
  }
  return {
    frontMatter: lines.slice(1, closing).join("\n"),
    body: lines
      .slice(closing + 1)
      .join("\n")
      .trim(),
  };
}

/** Parses a "breaking" entry. An empty YAML value, such as "breaking:", means the entry is absent. */
function parseBreaking(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new Error("breaking must be true or false");
  }
  return value;
}

/**
 * Builds a change from its fields and its body, as a fragment file or the
 * data block of a release holds them. The kind stays as written, for the
 * caller to resolve against the configured kinds.
 */
export function changeFromFields(
  fields: RawRecord,
  body: string,
): StatedChange {
  const { kind, breaking, ...metadata } = fields;
  if (typeof kind !== "string") {
    throw new Error("kind is missing");
  }
  if (isBlankBody(body)) {
    throw new Error("body is empty");
  }
  return {
    kind,
    breaking: parseBreaking(breaking),
    metadata: parseMetadata(metadata),
    body,
  };
}

/**
 * Decides whether a change of a kind breaks compatibility. A kind that
 * always or never breaks answers for its changes, and a stated answer must
 * agree with it. A kind that asks takes the stated answer, and a change
 * without one does not break.
 */
export function resolveBreaking(
  kind: Kind,
  stated: boolean | undefined,
): boolean {
  switch (kind.breaking) {
    case "yes":
      if (stated === false) {
        throw new Error(
          `breaking: false contradicts kind ${JSON.stringify(kind.label)}, which always breaks`,
        );
      }
      return true;
    case "no":
      if (stated === true) {
        throw new Error(
          `breaking: true contradicts kind ${JSON.stringify(kind.label)}, which never breaks`,
        );
      }
      return false;
    case "ask":
      return stated ?? false;
  }
}

/**
 * Parses the text of a fragment file and resolves its kind against the
 * configured kinds, which also decides whether the change breaks.
 */
export function parseChange(text: string, kinds: readonly Kind[]): Change {
  const document = splitFrontMatter(text);
  const fields: unknown = Bun.YAML.parse(document.frontMatter);
  if (!isRecord(fields)) {
    throw new Error("front matter must be a mapping");
  }

  const stated = changeFromFields(fields, document.body);
  const kind = resolveKind(kinds, stated.kind);
  return {
    ...stated,
    kind: kind.label,
    breaking: resolveBreaking(kind, stated.breaking),
  };
}

/**
 * Formats one front matter entry. Text with line breaks becomes a literal
 * block, which reads better in a hand-edited file than an escaped string.
 */
export function yamlEntry(key: string, value: MetadataValue): string {
  const isMultiLine = typeof value === "string" && value.includes("\n");
  if (!isMultiLine) {
    return Bun.YAML.stringify({ [key]: value }, null, 2).trimEnd();
  }

  // An explicit indentation indicator keeps the leading spaces of a first line.
  const indicator = /^\s/.test(value) ? "|2-" : "|-";
  const lines = value
    .split("\n")
    .map((line) => (line === "" ? "" : `  ${line}`));
  return [`${Bun.YAML.stringify(key)}: ${indicator}`, ...lines].join("\n");
}

/** Formats a change as the text of a fragment file. Only a breaking change says so. */
export function serializeChange(change: Change): string {
  const entries = [
    yamlEntry("kind", change.kind),
    ...(change.breaking ? [yamlEntry("breaking", true)] : []),
    ...Object.entries(change.metadata).map(([key, value]) =>
      yamlEntry(key, value),
    ),
  ];
  return `---\n${entries.join("\n")}\n---\n${change.body}\n`;
}

const SEQUENCE_PREFIX = /^(\d+)(?=-|\.md$)/;
const SEQUENCE_WIDTH = 3;

/**
 * A random ID in a fragment file name, such as "k7m2q": five characters of
 * Crockford's base32 in lower case. Branches that record a change at the
 * same time often pick the same sequence number, and the ID keeps their
 * file names apart, so git merges them without a conflict.
 */
export type FragmentId = string & { readonly __brand: "FragmentId" };

const FRAGMENT_ID_LENGTH = 5;

/**
 * Crockford's base32 alphabet in lower case. It works on file systems that
 * ignore case, and it leaves out i, l, o and u, so IDs rarely spell words.
 */
const CROCKFORD_BASE32 = "0123456789abcdefghjkmnpqrstvwxyz";

/**
 * Encodes five random bytes as an ID, one character per byte from its low
 * five bits. 256 is a multiple of 32, so every character is equally likely.
 */
export function encodeFragmentId(bytes: Uint8Array): FragmentId {
  if (bytes.length !== FRAGMENT_ID_LENGTH) {
    throw new Error(
      `a fragment ID needs ${FRAGMENT_ID_LENGTH} bytes, got ${bytes.length}`,
    );
  }
  const characters = Array.from(bytes, (byte) =>
    CROCKFORD_BASE32.charAt(byte & 0b11111),
  );
  return characters.join("") as FragmentId;
}

/** Draws a new random ID for a fragment file name. */
export const randomFragmentId = (): FragmentId =>
  encodeFragmentId(crypto.getRandomValues(new Uint8Array(FRAGMENT_ID_LENGTH)));

export const isFragmentFile = (fileName: string): boolean =>
  fileName.endsWith(".md") && !fileName.startsWith(".");

/** Reads the "nnn" sequence number from a fragment file name. */
export function fragmentSequence(fileName: string): number | undefined {
  const digits = SEQUENCE_PREFIX.exec(fileName)?.[1];
  return digits === undefined ? undefined : Number(digits);
}

/** Returns the sequence number that follows every existing fragment. */
export function nextSequence(fileNames: readonly string[]): number {
  const sequences = fileNames
    .filter(isFragmentFile)
    .map((fileName) => fragmentSequence(fileName))
    .filter((sequence) => sequence !== undefined);
  return Math.max(0, ...sequences) + 1;
}

function fragmentNameValues(
  change: Change,
  titleMaxLength: number,
): TemplateView {
  const title = truncateSlug(slugify(deriveTitle(change.body)), titleMaxLength);
  return {
    ...mapValues(change.metadata, (value) => slugify(String(value))),
    kind: slugify(change.kind),
    title,
  };
}

/** Builds the file name "nnn-<id>-<fragmentName>.md" for a change. */
export function fragmentFileName(
  project: Project,
  sequence: number,
  id: FragmentId,
  change: Change,
): string {
  const prefix = `${String(sequence).padStart(SEQUENCE_WIDTH, "0")}-${id}`;
  const values = fragmentNameValues(change, project.config.titleMaxLength);
  const name = renderTemplate(project.templates.fragmentName, values);
  return name === "" ? `${prefix}.md` : `${prefix}-${name}.md`;
}

/** Writes a change to the next free fragment file and returns its path. */
export async function recordChange(
  project: Project,
  change: Change,
): Promise<string> {
  const directory = unreleasedPath(project);
  await mkdir(directory, { recursive: true });
  const sequence = nextSequence(await listDirectory(directory));
  const fileName = fragmentFileName(
    project,
    sequence,
    randomFragmentId(),
    change,
  );
  const path = join(directory, fileName);
  await writeFile(path, serializeChange(change), { flag: "wx" });
  return path;
}

async function readFragment(
  path: string,
  kinds: readonly Kind[],
): Promise<Fragment> {
  const text = await readFile(path, "utf8");
  const change = withContext(`parse ${displayPath(path)}`, () =>
    parseChange(text, kinds),
  );
  return {
    ...change,
    path,
    sequence: fragmentSequence(basename(path)),
  };
}

/** Orders fragments by sequence number. Fragments without one come last. */
function compareFragments(a: Fragment, b: Fragment): number {
  const unnumbered = Number.MAX_SAFE_INTEGER;
  const bySequence = (a.sequence ?? unnumbered) - (b.sequence ?? unnumbered);
  if (bySequence !== 0) return bySequence;
  return compareStrings(basename(a.path), basename(b.path));
}

/** Reads all unreleased fragments in changelog order. */
export async function loadFragments(project: Project): Promise<Fragment[]> {
  const directory = unreleasedPath(project);
  const fileNames = (await listDirectory(directory)).filter(isFragmentFile);
  const fragments = await Promise.all(
    fileNames.map((fileName) =>
      readFragment(join(directory, fileName), project.config.kinds),
    ),
  );
  return fragments.sort(compareFragments);
}
