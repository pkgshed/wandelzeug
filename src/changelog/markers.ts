/**
 * The markers in the changelog: the release anchor, the BEGIN and END pair
 * around each release, the data block at the bottom of a release, and the
 * BEGIN and END pair around the link definitions of the releases.
 */

import { changelogPath, type Project } from "../project/root.ts";
import {
  attempt,
  displayPath,
  readOptionalFile,
  withContext,
} from "../shared/foundations.ts";
import {
  compareVersions,
  parseVersion,
  type Version,
} from "../shared/versions.ts";
import {
  formatDataAttributes,
  formatDataChanges,
  parseReleaseData,
  type ReleaseData,
} from "./data.ts";

/** A released version, named as the changelog writes it. */
export type Release = {
  readonly name: string;
  readonly version: Version;
};

/** A release that the changelog wraps in BEGIN and END markers. */
export type ReleaseSection = Release & {
  /** The index of the BEGIN line. The notes start on the line after it. */
  readonly begin: number;
  /** The index of the line after the notes: the first line of the data block, or the END line. */
  readonly notesEnd: number;
  /** The index of the END line. */
  readonly end: number;
  /** The data block, which releases without embedded data lack. */
  readonly data: ReleaseData | undefined;
};

/** The lines of the BEGIN and END pair around the link definitions. */
export type LinksRegion = {
  readonly begin: number;
  readonly end: number;
};

/** A changelog whose markers parsed without problems. */
export type ChangelogDocument = {
  readonly lines: readonly string[];
  readonly newline: string;
  /** The index of the line that holds the release anchor. */
  readonly anchor: number;
  /** The newest release from before wandelzeug, as the anchor records it. */
  readonly baseline: Release | undefined;
  /** The marked releases in the order of the file. */
  readonly releases: readonly ReleaseSection[];
  /** The markers around the link definitions, when there are some. */
  readonly links: LinksRegion | undefined;
};

/** Formats the anchor below which "batch" inserts new releases. */
export const anchorMarker = (baseline: string | undefined): string =>
  baseline === undefined
    ? "<!-- wlz:releases -->"
    : `<!-- wlz:releases baseline=${baseline} -->`;

/** The marker below which "batch" inserts the link definition of a new release. */
export const LINKS_BEGIN = "<!-- BEGIN wlz:links -->";

/** The marker that ends the link definitions of wandelzeug. Definitions below it belong to the project. */
export const LINKS_END = "<!-- END wlz:links -->";

export const beginMarker = (name: string): string =>
  `<!-- BEGIN wlz:release ${name} -->`;

export const endMarker = (name: string): string =>
  `<!-- END wlz:release ${name} -->`;

/** The line that closes the comment of a data block. */
const DATA_END = "-->";

/** Formats the comment that holds the data block of a release. */
export const dataComment = (data: ReleaseData): string[] => [
  `<!-- wlz:data ${formatDataAttributes(data)}`,
  ...formatDataChanges(data.changes),
  DATA_END,
];

/**
 * Formats a release as batch inserts it: the BEGIN marker, the notes, the
 * data block if there is one, and the END marker. The data block comes
 * last, so a reader of the file meets the notes first, and a blank line
 * sets it apart from the notes.
 */
export const releaseSection = (
  name: string,
  data: ReleaseData | undefined,
  notes: string,
): string =>
  [
    beginMarker(name),
    notes,
    ...(data === undefined ? [] : ["", ...dataComment(data)]),
    endMarker(name),
  ].join("\n");

const ANCHOR_MARKER = /^<!--\s*wlz:releases\b(.*?)-->$/;
const BEGIN_MARKER = /^<!--\s*BEGIN\s+wlz:release\s+(\S+)\s*-->$/;
/** The first line of a data block with its attributes. The comment goes on with the changes. */
const DATA_MARKER = /^<!--\s*wlz:data\b(.*)$/;
const END_MARKER = /^<!--\s*END\s+wlz:release\s+(\S+)\s*-->$/;
const LINKS_BEGIN_MARKER = /^<!--\s*BEGIN\s+wlz:links\s*-->$/;
const LINKS_END_MARKER = /^<!--\s*END\s+wlz:links\s*-->$/;
/** The single links anchor of wandelzeug 0.1, which the BEGIN and END pair replaced. */
const OLD_LINKS_MARKER = /^<!--\s*wlz:links\s*-->$/;

/** Any comment with the wlz: prefix, so a mistyped marker fails instead of passing as text. */
const ANY_MARKER = /^<!--\s*(?:BEGIN\s+|END\s+)?wlz:/;

type Marker =
  | { readonly type: "anchor"; readonly attributes: string }
  | { readonly type: "begin"; readonly name: string }
  | { readonly type: "data"; readonly attributes: string }
  | { readonly type: "end"; readonly name: string }
  | { readonly type: "linksBegin" }
  | { readonly type: "linksEnd" }
  | { readonly type: "oldLinks" }
  | { readonly type: "unknown" };

function classifyLine(line: string): Marker | undefined {
  const text = line.trim();
  const anchor = ANCHOR_MARKER.exec(text);
  if (anchor !== null) {
    return { type: "anchor", attributes: anchor[1] ?? "" };
  }

  const begin = BEGIN_MARKER.exec(text)?.[1];
  if (begin !== undefined) return { type: "begin", name: begin };
  const data = DATA_MARKER.exec(text);
  if (data !== null && !text.endsWith(DATA_END)) {
    return { type: "data", attributes: data[1] ?? "" };
  }
  const end = END_MARKER.exec(text)?.[1];
  if (end !== undefined) return { type: "end", name: end };
  if (LINKS_BEGIN_MARKER.test(text)) return { type: "linksBegin" };
  if (LINKS_END_MARKER.test(text)) return { type: "linksEnd" };
  if (OLD_LINKS_MARKER.test(text)) return { type: "oldLinks" };
  return ANY_MARKER.test(text) ? { type: "unknown" } : undefined;
}

/** Reports whether a changelog holds any wandelzeug marker or data block. */
export const hasAnyMarker = (text: string): boolean =>
  text.split(/\r?\n/).some((line) => classifyLine(line) !== undefined);

/** Reports whether a changelog holds the release anchor or the BEGIN marker of the links. */
export const hasMarker = (text: string, type: "anchor" | "links"): boolean => {
  const wanted = type === "anchor" ? "anchor" : "linksBegin";
  return text
    .split(/\r?\n/)
    .some((line) => classifyLine(line)?.type === wanted);
};

function parseReleaseName(name: string): Release {
  const version = parseVersion(name);
  if (version === undefined) {
    throw new Error(`invalid version ${JSON.stringify(name)}`);
  }
  return { name, version };
}

/** Reads the attributes of the anchor, of which "baseline=VERSION" is the only one. */
function parseAnchorBaseline(attributes: string): Release | undefined {
  const entries = attributes.split(/\s+/).filter((entry) => entry !== "");
  const unknown = entries.find((entry) => !entry.startsWith("baseline="));
  if (unknown !== undefined) {
    throw new Error(`unknown anchor attribute ${JSON.stringify(unknown)}`);
  }
  if (entries.length > 1) {
    throw new Error("the anchor holds more than one baseline");
  }

  const [entry] = entries;
  return entry === undefined
    ? undefined
    : parseReleaseName(entry.slice("baseline=".length));
}

/** A BEGIN marker whose END the scan has not reached yet. */
type OpenRelease = {
  readonly release: Release;
  readonly begin: number;
  readonly data: ReleaseData | undefined;
  /** The index of the first line of the data block, once the scan has seen it. */
  readonly dataBegin: number | undefined;
};

/** What the scan of a changelog has seen so far. */
type ChangelogScan = {
  anchor:
    | { readonly index: number; readonly baseline: Release | undefined }
    | undefined;
  open: OpenRelease | undefined;
  readonly releases: ReleaseSection[];
  /** The index of a BEGIN wlz:links marker whose END the scan has not reached yet. */
  linksBegin: number | undefined;
  links: LinksRegion | undefined;
};

function scanAnchor(
  scan: ChangelogScan,
  attributes: string,
  index: number,
): void {
  if (scan.anchor !== undefined) {
    throw new Error(
      `second release anchor, the first is on line ${scan.anchor.index + 1}`,
    );
  }
  if (scan.open !== undefined) {
    throw new Error(`release anchor inside release ${scan.open.release.name}`);
  }
  scan.anchor = { index, baseline: parseAnchorBaseline(attributes) };
}

function scanLinksBegin(scan: ChangelogScan, index: number): void {
  const first = scan.links?.begin ?? scan.linksBegin;
  if (first !== undefined) {
    throw new Error(
      `second BEGIN wlz:links marker, the first is on line ${first + 1}`,
    );
  }
  if (scan.open !== undefined) {
    throw new Error(
      `BEGIN wlz:links marker inside release ${scan.open.release.name}`,
    );
  }
  scan.linksBegin = index;
}

function scanLinksEnd(scan: ChangelogScan, index: number): void {
  if (scan.linksBegin === undefined) {
    throw new Error("END wlz:links marker without a BEGIN");
  }
  scan.links = { begin: scan.linksBegin, end: index };
  scan.linksBegin = undefined;
}

function scanBegin(scan: ChangelogScan, name: string, begin: number): void {
  if (scan.open !== undefined) {
    throw new Error(
      `BEGIN of ${name} inside release ${scan.open.release.name}, which lacks its END`,
    );
  }
  if (scan.linksBegin !== undefined) {
    throw new Error(`BEGIN of ${name} inside the link definitions`);
  }

  const release = parseReleaseName(name);
  const duplicate = scan.releases.find(
    (section) => compareVersions(section.version, release.version) === 0,
  );
  if (duplicate !== undefined) {
    throw new Error(
      `release ${name} appears twice, first on line ${duplicate.begin + 1}`,
    );
  }
  scan.open = { release, begin, data: undefined, dataBegin: undefined };
}

function scanEnd(scan: ChangelogScan, name: string, index: number): void {
  const open = scan.open;
  if (open === undefined) {
    throw new Error(`END of ${name} without a BEGIN`);
  }
  if (open.release.name !== name) {
    throw new Error(`END of ${name} closes release ${open.release.name}`);
  }
  scan.releases.push({
    ...open.release,
    begin: open.begin,
    notesEnd: open.dataBegin ?? index,
    end: index,
    data: open.data,
  });
  scan.open = undefined;
}

const OLD_LINKS_MIGRATION = `the links anchor of wandelzeug 0.1 is now a pair of markers: replace this line with ${LINKS_BEGIN}, and put ${LINKS_END} after the link definitions that wandelzeug added`;

/** Scans a marker that fits on its line, which every marker but a data block does. */
function scanMarker(
  scan: ChangelogScan,
  marker: Exclude<Marker, { type: "data" }>,
  index: number,
): void {
  switch (marker.type) {
    case "anchor":
      return scanAnchor(scan, marker.attributes, index);
    case "begin":
      return scanBegin(scan, marker.name, index);
    case "end":
      return scanEnd(scan, marker.name, index);
    case "linksBegin":
      return scanLinksBegin(scan, index);
    case "linksEnd":
      return scanLinksEnd(scan, index);
    case "oldLinks":
      throw new Error(OLD_LINKS_MIGRATION);
    case "unknown":
      throw new Error(
        "unknown wlz marker, expected an anchor, BEGIN or END wlz:release VERSION, BEGIN or END wlz:links, or a wlz:data block over several lines",
      );
  }
}

/** Gives the open release the data block that starts on the given line. */
function openData(
  scan: ChangelogScan,
  attributes: string,
  yaml: string,
  dataBegin: number,
): OpenRelease {
  const open = scan.open;
  if (open === undefined) {
    throw new Error("data block outside a release");
  }
  if (open.dataBegin !== undefined) {
    throw new Error(`second data block in release ${open.release.name}`);
  }
  const data = withContext(`release ${open.release.name}`, () =>
    parseReleaseData(attributes, yaml),
  );
  scan.open = { ...open, data, dataBegin };
  return scan.open;
}

/**
 * Scans a data block, up to the line that closes its comment, and returns
 * the index of the line after it. Without that line, the rest of the file
 * belongs to the comment. Only blank lines may follow the block before the
 * END marker, so the notes stay in one piece.
 */
function scanData(
  scan: ChangelogScan,
  problems: string[],
  lines: readonly string[],
  start: number,
  attributes: string,
): number {
  const close = lines.findIndex(
    (line, index) => index > start && line.trim() === DATA_END,
  );
  if (close === -1) {
    problems.push(
      `line ${start + 1}: the data block lacks its closing ${DATA_END} line`,
    );
    return lines.length;
  }

  const yaml = lines.slice(start + 1, close).join("\n");
  const opened = attempt(() => openData(scan, attributes, yaml, start));
  if (!opened.ok) {
    problems.push(`line ${start + 1}: ${opened.error}`);
    return close + 1;
  }
  const next = lines.findIndex(
    (line, index) => index > close && line.trim() !== "",
  );
  const isLast = classifyLine(lines[next] ?? "")?.type === "end";
  if (!isLast) {
    problems.push(
      `line ${start + 1}: the data block of release ${opened.value.release.name} must come right before its END marker`,
    );
  }
  return close + 1;
}

/** Scans the marker on a line, if any, and returns the index of the line to scan next. */
function scanLine(
  scan: ChangelogScan,
  problems: string[],
  lines: readonly string[],
  index: number,
): number {
  const marker = classifyLine(lines[index] ?? "");
  if (marker === undefined) return index + 1;
  if (marker.type === "data") {
    return scanData(scan, problems, lines, index, marker.attributes);
  }
  const result = attempt(() => scanMarker(scan, marker, index));
  if (!result.ok) problems.push(`line ${index + 1}: ${result.error}`);
  return index + 1;
}

/** Reports what the scan left unfinished at the end of the changelog. */
function closingProblems(scan: ChangelogScan): string[] {
  const unclosed =
    scan.open === undefined
      ? []
      : [
          `line ${scan.open.begin + 1}: release ${scan.open.release.name} lacks its END marker`,
        ];
  const unclosedLinks =
    scan.linksBegin === undefined
      ? []
      : [`line ${scan.linksBegin + 1}: BEGIN wlz:links lacks its END marker`];
  const missingAnchor =
    scan.anchor === undefined
      ? [`no ${anchorMarker(undefined)} anchor, run "wlz init" to add it`]
      : [];
  const linksAbove =
    scan.anchor !== undefined &&
    scan.links !== undefined &&
    scan.links.begin < scan.anchor.index;
  const misplacedLinks = linksAbove
    ? [
        `line ${(scan.links?.begin ?? 0) + 1}: the link definitions must come after the release anchor`,
      ]
    : [];
  return [...unclosed, ...unclosedLinks, ...missingAnchor, ...misplacedLinks];
}

/** The parsed changelog, or every problem with its markers. */
export type ChangelogParse =
  | { readonly ok: true; readonly document: ChangelogDocument }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * Parses the markers of a changelog and the data blocks of its releases.
 * The notes between the markers stay opaque to the parse.
 */
export function parseChangelog(text: string): ChangelogParse {
  const lines = text.split(/\r?\n/);
  const scan: ChangelogScan = {
    anchor: undefined,
    open: undefined,
    releases: [],
    linksBegin: undefined,
    links: undefined,
  };
  const problems: string[] = [];
  let index = 0;
  while (index < lines.length) {
    index = scanLine(scan, problems, lines, index);
  }
  problems.push(...closingProblems(scan));

  const anchor = scan.anchor;
  if (problems.length > 0 || anchor === undefined) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    document: {
      lines,
      newline: text.includes("\r\n") ? "\r\n" : "\n",
      anchor: anchor.index,
      baseline: anchor.baseline,
      releases: scan.releases,
      links: scan.links,
    },
  };
}

/** Lists the marked releases and the baseline, newest first. */
export function knownReleases(document: ChangelogDocument): Release[] {
  const baseline = document.baseline === undefined ? [] : [document.baseline];
  const releases: Release[] = [...document.releases, ...baseline];
  return releases.sort((a, b) => compareVersions(b.version, a.version));
}

/** Returns the text between the markers of a release, or undefined when no marked release has the version. */
export function releaseNotes(
  document: ChangelogDocument,
  version: Version,
): string | undefined {
  const section = document.releases.find(
    (release) => compareVersions(release.version, version) === 0,
  );
  if (section === undefined) return undefined;
  return currentNotes(document, section) + "\n";
}

/** Returns the notes of a release as the changelog holds them now, without surrounding blank lines. */
export const currentNotes = (
  document: ChangelogDocument,
  section: ReleaseSection,
): string =>
  document.lines
    .slice(section.begin + 1, section.notesEnd)
    .join("\n")
    .trim();

/**
 * Inserts link definitions right below the BEGIN wlz:links marker, so the
 * definitions of the newest release come first.
 */
function insertLinks(
  document: ChangelogDocument,
  links: readonly string[],
): readonly string[] {
  if (links.length === 0) return document.lines;
  if (document.links === undefined) {
    throw new Error(`no ${LINKS_BEGIN} marker for the link definitions`);
  }
  const { begin } = document.links;
  return [
    ...document.lines.slice(0, begin + 1),
    ...links,
    ...document.lines.slice(begin + 1),
  ];
}

/**
 * Inserts a release section right below the release anchor, so the newest
 * release comes first, and its link definitions below the BEGIN wlz:links
 * marker. Every other line of the changelog stays as it is. The link
 * markers sit below the release anchor, so the links leave that index
 * valid.
 */
export function insertRelease(
  document: ChangelogDocument,
  section: string,
  links: readonly string[],
): string {
  const withLinks = insertLinks(document, links);
  const before = withLinks.slice(0, document.anchor + 1);
  const after = withLinks.slice(document.anchor + 1);
  const needsGap = after[0]?.trim() !== "";
  const lines = [
    ...before,
    "",
    ...section.split("\n"),
    ...(needsGap ? [""] : []),
    ...after,
  ];
  return lines.join(document.newline);
}

const DEFINITION_LABEL = /^\s*\[([^\]]+)\]:/;

/** A link definition between the link markers, such as "[`1.0.0`]: https://...". */
export type LinkDefinition = {
  readonly label: string;
  readonly line: string;
};

/** Lists the link definitions between the link markers. */
export function linkDefinitions(document: ChangelogDocument): LinkDefinition[] {
  const links = document.links;
  if (links === undefined) return [];
  return document.lines.slice(links.begin + 1, links.end).flatMap((line) => {
    const label = DEFINITION_LABEL.exec(line)?.[1];
    return label === undefined ? [] : [{ label, line }];
  });
}

/** Lines of the changelog to replace, from start to end. An end right before the start inserts at the start. */
export type LineReplacement = {
  readonly start: number;
  readonly end: number;
  readonly lines: readonly string[];
};

/** Replaces parts of the changelog that do not overlap, and returns its text. */
export function replaceLines(
  document: ChangelogDocument,
  replacements: readonly LineReplacement[],
): string {
  const lastFirst = [...replacements].sort((a, b) => b.start - a.start);
  const lines = lastFirst.reduce<readonly string[]>(
    (current, replacement) => [
      ...current.slice(0, replacement.start),
      ...replacement.lines,
      ...current.slice(replacement.end + 1),
    ],
    document.lines,
  );
  return lines.join(document.newline);
}

/** What stripMarkers made of a changelog. */
export type StrippedChangelog = {
  readonly text: string;
  /** The number of marker lines that it removed. */
  readonly markers: number;
  /** The number of data blocks that it removed. */
  readonly dataBlocks: number;
};

/** The lines of a changelog that hold markers and data blocks. */
type MarkerLines = {
  readonly removed: ReadonlySet<number>;
  readonly markers: number;
  readonly dataBlocks: number;
};

/** Finds the line that closes the data block starting at the given line. */
function dataBlockEnd(lines: readonly string[], start: number): number {
  const close = lines.findIndex(
    (line, index) => index > start && line.trim() === DATA_END,
  );
  if (close === -1) {
    throw new Error(
      `line ${start + 1}: the data block lacks its closing ${DATA_END} line`,
    );
  }
  return close;
}

/**
 * Finds every marker line and data block, whether or not the markers pair
 * up. A data block without its closing line is an error, because the rest
 * of the file would go with it.
 */
function findMarkerLines(lines: readonly string[]): MarkerLines {
  const removed = new Set<number>();
  let markers = 0;
  let dataBlocks = 0;
  let index = 0;
  while (index < lines.length) {
    const marker = classifyLine(lines[index] ?? "");
    if (marker === undefined) {
      index += 1;
      continue;
    }
    if (marker.type !== "data") {
      removed.add(index);
      markers += 1;
      index += 1;
      continue;
    }
    const close = dataBlockEnd(lines, index);
    for (let line = index; line <= close; line += 1) removed.add(line);
    dataBlocks += 1;
    index = close + 1;
  }
  return { removed, markers, dataBlocks };
}

const isBlankLine = (line: string): boolean => line.trim() === "";

/**
 * Keeps the lines that are not removed. Where a removal leaves a blank
 * line right after another one, or at the top of the file, that blank
 * line goes too, so the notes keep the spacing that they had around the
 * markers.
 */
function keepLines(
  lines: readonly string[],
  removed: ReadonlySet<number>,
): string[] {
  const kept: string[] = [];
  let afterRemoval = false;
  for (const [index, line] of lines.entries()) {
    if (removed.has(index)) {
      afterRemoval = true;
      continue;
    }
    const previous = kept.at(-1);
    const followsBlank = previous === undefined || isBlankLine(previous);
    const doublesBlank = afterRemoval && isBlankLine(line) && followsBlank;
    afterRemoval = false;
    if (!doublesBlank) kept.push(line);
  }
  return kept;
}

/**
 * Removes every wandelzeug marker and data block from a changelog, for a
 * project that stops using wandelzeug. The notes and the link definitions
 * stay. Unlike parseChangelog, it does not need the markers to pair up, so
 * it also cleans a changelog with marker problems.
 */
export function stripMarkers(text: string): StrippedChangelog {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const { removed, markers, dataBlocks } = findMarkerLines(lines);
  return {
    text: keepLines(lines, removed).join(newline),
    markers,
    dataBlocks,
  };
}

export const MISSING_CHANGELOG = 'no such file, run "wlz init" to create it';

/** Reads and parses the changelog of a project. Any marker problem is an error. */
export async function readChangelog(
  project: Project,
): Promise<ChangelogDocument> {
  const path = changelogPath(project);
  const text = await readOptionalFile(path);
  if (text === undefined) {
    throw new Error(`read ${displayPath(path)}: ${MISSING_CHANGELOG}`);
  }

  const parsed = parseChangelog(text);
  if (!parsed.ok) {
    const lines = parsed.problems.map(
      (problem) => `${displayPath(path)}: ${problem}`,
    );
    throw new Error(lines.join("\n"));
  }
  return parsed.document;
}
