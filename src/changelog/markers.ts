/**
 * The markers in the changelog: the release anchor and the BEGIN and END
 * pair around each release.
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

/** A released version, named as the changelog writes it. */
export type Release = {
  readonly name: string;
  readonly version: Version;
};

/** A release that the changelog wraps in BEGIN and END markers. */
export type ReleaseSection = Release & {
  /** The index of the BEGIN line. */
  readonly begin: number;
  /** The index of the END line. */
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
};

/** Formats the anchor below which "batch" inserts new releases. */
export const anchorMarker = (baseline: string | undefined): string =>
  baseline === undefined
    ? "<!-- wlz:releases -->"
    : `<!-- wlz:releases baseline=${baseline} -->`;

export const beginMarker = (name: string): string =>
  `<!-- BEGIN wlz:release ${name} -->`;

export const endMarker = (name: string): string =>
  `<!-- END wlz:release ${name} -->`;

const ANCHOR_MARKER = /^<!--\s*wlz:releases\b(.*?)-->$/;
const BEGIN_MARKER = /^<!--\s*BEGIN\s+wlz:release\s+(\S+)\s*-->$/;
const END_MARKER = /^<!--\s*END\s+wlz:release\s+(\S+)\s*-->$/;

/** Any comment with the wlz: prefix, so a mistyped marker fails instead of passing as text. */
const ANY_MARKER = /^<!--\s*(?:BEGIN\s+|END\s+)?wlz:/;

type Marker =
  | { readonly type: "anchor"; readonly attributes: string }
  | { readonly type: "begin"; readonly name: string }
  | { readonly type: "end"; readonly name: string }
  | { readonly type: "unknown" };

function classifyLine(line: string): Marker | undefined {
  const text = line.trim();
  const anchor = ANCHOR_MARKER.exec(text);
  if (anchor !== null) {
    return { type: "anchor", attributes: anchor[1] ?? "" };
  }

  const begin = BEGIN_MARKER.exec(text)?.[1];
  if (begin !== undefined) return { type: "begin", name: begin };
  const end = END_MARKER.exec(text)?.[1];
  if (end !== undefined) return { type: "end", name: end };
  return ANY_MARKER.test(text) ? { type: "unknown" } : undefined;
}

export const hasAnchor = (text: string): boolean =>
  text.split(/\r?\n/).some((line) => classifyLine(line)?.type === "anchor");

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

/** What the scan of a changelog has seen so far. */
type ChangelogScan = {
  anchor:
    | { readonly index: number; readonly baseline: Release | undefined }
    | undefined;
  open: { readonly release: Release; readonly begin: number } | undefined;
  readonly releases: ReleaseSection[];
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

function scanBegin(scan: ChangelogScan, name: string, index: number): void {
  if (scan.open !== undefined) {
    throw new Error(
      `BEGIN of ${name} inside release ${scan.open.release.name}, which lacks its END`,
    );
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
  scan.open = { release, begin: index };
}

function scanEnd(scan: ChangelogScan, name: string, index: number): void {
  const open = scan.open;
  if (open === undefined) {
    throw new Error(`END of ${name} without a BEGIN`);
  }
  if (open.release.name !== name) {
    throw new Error(`END of ${name} closes release ${open.release.name}`);
  }
  scan.releases.push({ ...open.release, begin: open.begin, end: index });
  scan.open = undefined;
}

function scanMarker(scan: ChangelogScan, marker: Marker, index: number): void {
  switch (marker.type) {
    case "anchor":
      return scanAnchor(scan, marker.attributes, index);
    case "begin":
      return scanBegin(scan, marker.name, index);
    case "end":
      return scanEnd(scan, marker.name, index);
    case "unknown":
      throw new Error(
        "unknown wlz marker, expected the release anchor or BEGIN or END wlz:release VERSION",
      );
  }
}

/** Reports what the scan left unfinished at the end of the changelog. */
function closingProblems(scan: ChangelogScan): string[] {
  const unclosed =
    scan.open === undefined
      ? []
      : [
          `line ${scan.open.begin + 1}: release ${scan.open.release.name} lacks its END marker`,
        ];
  const missingAnchor =
    scan.anchor === undefined
      ? [`no ${anchorMarker(undefined)} anchor, run "wlz init" to add it`]
      : [];
  return [...unclosed, ...missingAnchor];
}

/** The parsed changelog, or every problem with its markers. */
export type ChangelogParse =
  | { readonly ok: true; readonly document: ChangelogDocument }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * Parses the markers of a changelog. Text between the markers stays opaque,
 * so hand edits inside a release never confuse wandelzeug.
 */
export function parseChangelog(text: string): ChangelogParse {
  const lines = text.split(/\r?\n/);
  const scan: ChangelogScan = {
    anchor: undefined,
    open: undefined,
    releases: [],
  };
  const problems: string[] = [];
  lines.forEach((line, index) => {
    const marker = classifyLine(line);
    if (marker === undefined) return;
    const result = attempt(() => scanMarker(scan, marker, index));
    if (!result.ok) problems.push(`line ${index + 1}: ${result.error}`);
  });
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
  const lines = document.lines.slice(section.begin + 1, section.end);
  return lines.join("\n").trim() + "\n";
}

/**
 * Inserts a release section right below the anchor, so the newest release
 * comes first. Every other line of the changelog stays as it is.
 */
export function insertRelease(
  document: ChangelogDocument,
  section: string,
): string {
  const before = document.lines.slice(0, document.anchor + 1);
  const after = document.lines.slice(document.anchor + 1);
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
