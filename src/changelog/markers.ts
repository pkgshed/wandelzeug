/**
 * The markers in the changelog: the release anchor, the BEGIN and END pair
 * around each release with its data block, and the BEGIN and END pair
 * around the link definitions of the releases.
 */

import { changelogPath, type Project } from "../project/root.ts";
import {
  attempt,
  displayPath,
  readOptionalFile,
} from "../shared/foundations.ts";
import {
  compareVersions,
  parseVersion,
  type Version,
} from "../shared/versions.ts";
import {
  formatReleaseData,
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
  /** The index of the BEGIN line. */
  readonly begin: number;
  /** The index of the first line of the notes, after the BEGIN marker and its data block. */
  readonly notes: number;
  /** The index of the END line. */
  readonly end: number;
  /** The data block, which releases from before data blocks lack. */
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

/** The BEGIN marker of a release without a data block. */
export const beginMarker = (name: string): string =>
  `<!-- BEGIN wlz:release ${name} -->`;

export const endMarker = (name: string): string =>
  `<!-- END wlz:release ${name} -->`;

/** The line that closes the comment of a data block. */
const DATA_END = "-->";

/**
 * Formats a release as batch inserts it: the BEGIN marker that holds the
 * data block, the notes, and the END marker.
 */
export const releaseSection = (
  name: string,
  data: ReleaseData,
  notes: string,
): string =>
  [
    `<!-- BEGIN wlz:release ${name}`,
    ...formatReleaseData(data),
    DATA_END,
    notes,
    endMarker(name),
  ].join("\n");

const ANCHOR_MARKER = /^<!--\s*wlz:releases\b(.*?)-->$/;
const BEGIN_MARKER = /^<!--\s*BEGIN\s+wlz:release\s+(\S+)\s*-->$/;
/** A BEGIN marker whose comment goes on with a data block. */
const BEGIN_WITH_DATA = /^<!--\s*BEGIN\s+wlz:release\s+(\S+)\s*$/;
const END_MARKER = /^<!--\s*END\s+wlz:release\s+(\S+)\s*-->$/;
const LINKS_BEGIN_MARKER = /^<!--\s*BEGIN\s+wlz:links\s*-->$/;
const LINKS_END_MARKER = /^<!--\s*END\s+wlz:links\s*-->$/;
/** The single links anchor of wandelzeug 0.1, which the BEGIN and END pair replaced. */
const OLD_LINKS_MARKER = /^<!--\s*wlz:links\s*-->$/;

/** Any comment with the wlz: prefix, so a mistyped marker fails instead of passing as text. */
const ANY_MARKER = /^<!--\s*(?:BEGIN\s+|END\s+)?wlz:/;

type Marker =
  | { readonly type: "anchor"; readonly attributes: string }
  | { readonly type: "begin"; readonly name: string; readonly hasData: boolean }
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
  if (begin !== undefined)
    return { type: "begin", name: begin, hasData: false };
  const withData = BEGIN_WITH_DATA.exec(text)?.[1];
  if (withData !== undefined) {
    return { type: "begin", name: withData, hasData: true };
  }
  const end = END_MARKER.exec(text)?.[1];
  if (end !== undefined) return { type: "end", name: end };
  if (LINKS_BEGIN_MARKER.test(text)) return { type: "linksBegin" };
  if (LINKS_END_MARKER.test(text)) return { type: "linksEnd" };
  if (OLD_LINKS_MARKER.test(text)) return { type: "oldLinks" };
  return ANY_MARKER.test(text) ? { type: "unknown" } : undefined;
}

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
  readonly notes: number;
  readonly data: ReleaseData | undefined;
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

function scanBegin(
  scan: ChangelogScan,
  name: string,
  begin: number,
  notes: number,
  data: ReleaseData | undefined,
): void {
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
  scan.open = { release, begin, notes, data };
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
    notes: open.notes,
    end: index,
    data: open.data,
  });
  scan.open = undefined;
}

const OLD_LINKS_MIGRATION = `the links anchor of wandelzeug 0.1 is now a pair of markers: replace this line with ${LINKS_BEGIN}, and put ${LINKS_END} after the link definitions that wandelzeug added`;

/** Scans a marker that fits on its line, which every marker but a BEGIN with a data block does. */
function scanMarker(scan: ChangelogScan, marker: Marker, index: number): void {
  switch (marker.type) {
    case "anchor":
      return scanAnchor(scan, marker.attributes, index);
    case "begin":
      return scanBegin(scan, marker.name, index, index + 1, undefined);
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
        "unknown wlz marker, expected an anchor, BEGIN or END wlz:release VERSION, or BEGIN or END wlz:links",
      );
  }
}

/**
 * Scans a BEGIN marker whose comment holds a data block, up to the line
 * that closes the comment, and returns the index of the line after it.
 * Without that line, the rest of the file belongs to the comment.
 */
function scanBeginWithData(
  scan: ChangelogScan,
  problems: string[],
  name: string,
  lines: readonly string[],
  begin: number,
): number {
  const close = lines.findIndex(
    (line, index) => index > begin && line.trim() === DATA_END,
  );
  if (close === -1) {
    problems.push(
      `line ${begin + 1}: the data block of release ${name} lacks its closing ${DATA_END} line`,
    );
    return lines.length;
  }

  const yaml = lines.slice(begin + 1, close).join("\n");
  const data = attempt(() => parseReleaseData(yaml));
  if (!data.ok) {
    problems.push(`line ${begin + 1}: release ${name}: ${data.error}`);
  }
  const opened = attempt(() =>
    scanBegin(scan, name, begin, close + 1, data.ok ? data.value : undefined),
  );
  if (!opened.ok) problems.push(`line ${begin + 1}: ${opened.error}`);
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
  if (marker.type === "begin" && marker.hasData) {
    return scanBeginWithData(scan, problems, marker.name, lines, index);
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
): string => document.lines.slice(section.notes, section.end).join("\n").trim();

/** Inserts a link definition right below the BEGIN wlz:links marker, so the newest link comes first. */
function insertLink(
  document: ChangelogDocument,
  link: string | undefined,
): readonly string[] {
  if (link === undefined) return document.lines;
  if (document.links === undefined) {
    throw new Error(`no ${LINKS_BEGIN} marker for the link definition`);
  }
  const { begin } = document.links;
  return [
    ...document.lines.slice(0, begin + 1),
    link,
    ...document.lines.slice(begin + 1),
  ];
}

/**
 * Inserts a release section right below the release anchor, so the newest
 * release comes first, and its link definition below the BEGIN wlz:links
 * marker. Every other line of the changelog stays as it is. The link
 * markers sit below the release anchor, so the link leaves that index
 * valid.
 */
export function insertRelease(
  document: ChangelogDocument,
  section: string,
  link: string | undefined,
): string {
  const withLink = insertLink(document, link);
  const before = withLink.slice(0, document.anchor + 1);
  const after = withLink.slice(document.anchor + 1);
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
