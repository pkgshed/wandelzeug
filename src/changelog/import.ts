/**
 * Importing releases that lack a data block: "wlz import" and
 * "wlz init --import". Releases from before wandelzeug, and marked releases
 * without a data block, get a data block when their Markdown has the
 * shape that wandelzeug renders: a heading with the version and a date, a
 * heading for each kind, and lists below those. Their notes stay as they
 * are, and the hash covers the original text. The import stops at the
 * first release that does not fit.
 */

import type { Change } from "../changes/fragments.ts";
import { findKind, type Kind } from "../project/config.ts";
import { type MarkdownBlock, markdownBlocks } from "../shared/markdown.ts";
import {
  compareVersions,
  type IsoDate,
  parseIsoDate,
  parseVersion,
} from "../shared/versions.ts";
import { notesHash } from "./data.ts";
import {
  anchorMarker,
  beginMarker,
  type ChangelogDocument,
  currentNotes,
  dataComment,
  endMarker,
  type LineReplacement,
  type Release,
  type ReleaseSection,
  replaceLines,
} from "./markers.ts";

type HeadingBlock = Extract<MarkdownBlock, { type: "heading" }>;
type DefinitionBlock = Extract<MarkdownBlock, { type: "definition" }>;

/** Whether a release fits into a data block, and what it yields if so. */
type Fit<T> =
  | { readonly fits: true; readonly value: T }
  | { readonly fits: false; readonly reason: string };

const fit = <T>(value: T): Fit<T> => ({ fits: true, value });

const misfit = <T>(reason: string): Fit<T> => ({ fits: false, reason });

// --- Reading a release ------------------------------------------------------

const VERSION_HEADING =
  /^\[?`?(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)`?\]?(?=\s|$)/;
const HEADING_DATE = /\b(\d{4}-\d{2}-\d{2})\b/;
const YANKED = /\[YANKED\]/i;

/** Reads the release that a heading names, such as "[1.4.2] - 2025-03-02". */
function headingRelease(heading: HeadingBlock): Release | undefined {
  const name = VERSION_HEADING.exec(heading.text)?.[1];
  if (name === undefined) return undefined;
  const version = parseVersion(name);
  return version === undefined ? undefined : { name, version };
}

const BLOCK_NAMES: Readonly<Record<string, string>> = {
  paragraph: "a paragraph",
  code: "a code block",
  blockquote: "a quote",
  table: "a table",
  html: "HTML",
  hr: "a horizontal rule",
};

const describeBlock = (block: MarkdownBlock): string => {
  if (block.type === "definition") return "a link definition";
  if (block.type === "other")
    return BLOCK_NAMES[block.kind] ?? `a ${block.kind}`;
  return `a ${block.type}`;
};

/** Reads the changes from the blocks below a release heading: kind headings with lists below them. */
function readChanges(
  blocks: readonly MarkdownBlock[],
  kinds: readonly Kind[],
): Fit<Change[]> {
  let section: Kind | undefined;
  const changes: Change[] = [];
  for (const block of blocks) {
    if (block.type === "heading") {
      section = findKind(kinds, block.text);
      if (section === undefined) {
        return misfit(`its section "${block.text}" matches no configured kind`);
      }
      continue;
    }
    if (block.type !== "list") {
      const place =
        section === undefined
          ? "before its first kind heading"
          : `under "${section.label}"`;
      return misfit(
        `it holds ${describeBlock(block)} ${place}, which a data block cannot record`,
      );
    }
    if (section === undefined) {
      return misfit("it has a list before its first kind heading");
    }
    const kind = section.label;
    changes.push(...block.items.map((body) => ({ kind, metadata: {}, body })));
  }
  return changes.length === 0 ? misfit("it lists no changes") : fit(changes);
}

/** The date and the changes of a release. */
type ReleaseContent = {
  readonly date: IsoDate;
  readonly changes: readonly Change[];
};

/** Reads a release from its heading and the blocks below it. */
function readRelease(
  heading: HeadingBlock,
  blocks: readonly MarkdownBlock[],
  kinds: readonly Kind[],
): Fit<ReleaseContent> {
  if (YANKED.test(heading.text)) {
    return misfit(
      "its heading marks it as yanked, which a data block cannot record",
    );
  }
  const dateText = HEADING_DATE.exec(heading.text)?.[1];
  const date = dateText === undefined ? undefined : parseIsoDate(dateText);
  if (date === undefined) {
    return misfit("its heading names no date as YYYY-MM-DD");
  }
  const changes = readChanges(blocks, kinds);
  return changes.fits ? fit({ date, changes: changes.value }) : changes;
}

// --- Releases that might get a data block -------------------------------------

/** A release that might get a data block, and the way to give it one. */
type Candidate = {
  readonly release: Release;
  /** The index of the first line of the release. */
  readonly line: number;
  /** Whether the release comes from before wandelzeug, as plain text below the marked releases. */
  readonly legacy: boolean;
  readonly convert: () => Fit<LineReplacement>;
};

/** Gives a marked release without a data block one, right before its END marker and after a blank line. */
function convertMarked(
  document: ChangelogDocument,
  section: ReleaseSection,
  kinds: readonly Kind[],
): Fit<LineReplacement> {
  const notes = document.lines
    .slice(section.begin + 1, section.notesEnd)
    .join("\n");
  const [heading, ...blocks] = markdownBlocks(notes);
  const named =
    heading?.type === "heading" ? headingRelease(heading) : undefined;
  const namesVersion =
    named !== undefined &&
    compareVersions(named.version, section.version) === 0;
  if (heading?.type !== "heading" || !namesVersion) {
    return misfit(
      "its notes do not start with a heading that names its version",
    );
  }

  const content = readRelease(heading, blocks, kinds);
  if (!content.fits) return misfit(content.reason);
  const hash = notesHash(currentNotes(document, section));
  const endsBlank = document.lines[section.end - 1]?.trim() === "";
  return fit({
    start: section.end,
    end: section.end - 1,
    lines: [
      ...(endsBlank ? [] : [""]),
      ...dataComment({ ...content.value, hash }),
    ],
  });
}

const markedCandidate = (
  document: ChangelogDocument,
  section: ReleaseSection,
  kinds: readonly Kind[],
): Candidate => ({
  release: section,
  line: section.begin,
  legacy: false,
  convert: () => convertMarked(document, section, kinds),
});

/** A release from before wandelzeug: its heading and the blocks up to the next release. */
type LegacyRelease = {
  readonly release: Release;
  readonly heading: HeadingBlock;
  readonly blocks: readonly MarkdownBlock[];
  readonly first: number;
  readonly last: number;
};

/**
 * Finds the lines that hold the releases from before wandelzeug: after the
 * anchor and the marked releases, up to the link markers.
 */
function legacyLines(document: ChangelogDocument): {
  start: number;
  end: number;
} {
  const lastEnd = Math.max(
    document.anchor,
    ...document.releases.map((section) => section.end),
  );
  const start = lastEnd + 1;
  const linksBegin = document.links?.begin;
  const end =
    linksBegin !== undefined && linksBegin > start
      ? linksBegin
      : document.lines.length;
  return { start, end };
}

/** Reads the blocks of some lines of the changelog, with line indices of the whole changelog. */
function blocksOf(
  document: ChangelogDocument,
  start: number,
  end: number,
): MarkdownBlock[] {
  const text = document.lines.slice(start, end).join("\n");
  return markdownBlocks(text).map((block) => ({
    ...block,
    first: block.first + start,
    last: block.last + start,
  }));
}

/**
 * Splits blocks into releases. A release starts at a heading that names a
 * version, at the depth of the first such heading, and ends before the
 * next heading as deep or shallower, or before a link definition.
 */
function splitReleases(blocks: readonly MarkdownBlock[]): LegacyRelease[] {
  const firstHeading = blocks.find(
    (block): block is HeadingBlock =>
      block.type === "heading" && headingRelease(block) !== undefined,
  );
  if (firstHeading === undefined) return [];
  const depth = firstHeading.depth;
  const endsRelease = (block: MarkdownBlock): boolean =>
    block.type === "definition" ||
    (block.type === "heading" && block.depth <= depth);

  return blocks.flatMap((block, index) => {
    if (block.type !== "heading" || block.depth !== depth) return [];
    const release = headingRelease(block);
    if (release === undefined) return [];
    const rest = blocks.slice(index + 1);
    const boundary = rest.findIndex(endsRelease);
    const content = boundary === -1 ? rest : rest.slice(0, boundary);
    const last = content.at(-1)?.last ?? block.last;
    return [
      { release, heading: block, blocks: content, first: block.first, last },
    ];
  });
}

/** Wraps a release from before wandelzeug in markers, with a data block and its notes as they are. */
function convertLegacy(
  document: ChangelogDocument,
  legacy: LegacyRelease,
  kinds: readonly Kind[],
): Fit<LineReplacement> {
  const { release } = legacy;
  const isMarked = document.releases.some(
    (section) => compareVersions(section.version, release.version) === 0,
  );
  if (isMarked) {
    return misfit(`a marked release has the version ${release.name} already`);
  }

  const content = readRelease(legacy.heading, legacy.blocks, kinds);
  if (!content.fits) return misfit(content.reason);
  const notes = document.lines.slice(legacy.first, legacy.last + 1);
  const hash = notesHash(notes.join("\n"));
  return fit({
    start: legacy.first,
    end: legacy.last,
    lines: [
      beginMarker(release.name),
      ...notes,
      "",
      ...dataComment({ ...content.value, hash }),
      endMarker(release.name),
    ],
  });
}

const legacyCandidate = (
  document: ChangelogDocument,
  legacy: LegacyRelease,
  kinds: readonly Kind[],
): Candidate => ({
  release: legacy.release,
  line: legacy.first,
  legacy: true,
  convert: () => convertLegacy(document, legacy, kinds),
});

/** A candidate that got its data block. */
type Conversion = {
  readonly candidate: Candidate;
  readonly replacement: LineReplacement;
};

/** Converts candidates in order until the first that does not fit. */
function convertUntilMisfit(candidates: readonly Candidate[]): {
  converted: Conversion[];
  stop: { candidate: Candidate; reason: string } | undefined;
} {
  const converted: Conversion[] = [];
  for (const candidate of candidates) {
    const result = candidate.convert();
    if (!result.fits) {
      return { converted, stop: { candidate, reason: result.reason } };
    }
    converted.push({ candidate, replacement: result.value });
  }
  return { converted, stop: undefined };
}

// --- Link definitions and the baseline ------------------------------------------

/** Reads the version that a link definition names, such as "1.4.2" in "[`1.4.2`]: ...". */
const definitionVersion = (definition: DefinitionBlock) =>
  parseVersion(definition.label.replaceAll("`", "").trim());

/** What moving the link definitions of converted releases does. */
type LinkMoves = {
  readonly replacements: readonly LineReplacement[];
  readonly moved: number;
  /** Definitions that stay where they are because the changelog lacks the link markers. */
  readonly unmoved: number;
};

/**
 * Moves the link definitions of converted releases to the end of the link
 * markers, newest first, so render manages them. Other definitions stay.
 */
function moveLinks(
  document: ChangelogDocument,
  definitions: readonly DefinitionBlock[],
  converted: readonly Release[],
): LinkMoves {
  const matching = converted.flatMap((release) =>
    definitions.filter((definition) => {
      const version = definitionVersion(definition);
      return (
        version !== undefined && compareVersions(version, release.version) === 0
      );
    }),
  );
  const links = document.links;
  if (links === undefined) {
    return { replacements: [], moved: 0, unmoved: matching.length };
  }

  const removals = matching.map((definition) => ({
    start: definition.first,
    end: definition.last,
    lines: [],
  }));
  const insertion = {
    start: links.end,
    end: links.end - 1,
    lines: matching.flatMap((definition) =>
      document.lines.slice(definition.first, definition.last + 1),
    ),
  };
  return {
    replacements: matching.length === 0 ? [] : [...removals, insertion],
    moved: matching.length,
    unmoved: 0,
  };
}

/** Finds the link definitions outside the link markers that may belong to releases from before wandelzeug. */
function outsideDefinitions(
  document: ChangelogDocument,
  legacyBlocks: readonly MarkdownBlock[],
): DefinitionBlock[] {
  const links = document.links;
  const after =
    links === undefined
      ? []
      : blocksOf(document, links.end + 1, document.lines.length);
  return [...legacyBlocks, ...after].filter(
    (block): block is DefinitionBlock => block.type === "definition",
  );
}

/**
 * Picks the baseline after the import. A release from before wandelzeug
 * that stops the import becomes the baseline. When every such release
 * converts, the changelog needs no baseline anymore.
 */
function baselineAfter(
  document: ChangelogDocument,
  legacyCount: number,
  stop: Candidate | undefined,
): Release | undefined {
  if (stop?.legacy === true) return stop.release;
  if (stop === undefined && legacyCount > 0) return undefined;
  return document.baseline;
}

/** Finds where a line that no replacement touches ends up after the replacements. */
const lineAfter = (
  line: number,
  replacements: readonly LineReplacement[],
): number =>
  replacements
    .filter((replacement) => replacement.end < line)
    .reduce(
      (shifted, replacement) =>
        shifted +
        replacement.lines.length -
        (replacement.end - replacement.start + 1),
      line,
    );

// --- The import -----------------------------------------------------------------

/** Why the import stopped at a release. */
export type ImportStop = {
  readonly release: Release;
  /** The index of the first line of the release in the imported changelog. */
  readonly line: number;
  readonly reason: string;
  /** Whether the release comes from before wandelzeug, which makes it the baseline. */
  readonly legacy: boolean;
};

/** What the import plans to write. */
export type ImportPlan = {
  readonly content: string;
  /** The releases that got a data block, newest first. */
  readonly converted: readonly Release[];
  readonly stop: ImportStop | undefined;
  readonly baseline: {
    readonly before: Release | undefined;
    readonly after: Release | undefined;
  };
  readonly movedLinks: number;
  /** Link definitions of converted releases that stay where they are, because the changelog lacks the link markers. */
  readonly unmovedLinks: number;
};

/**
 * Plans to give data blocks to the marked releases without one, newest
 * first, and then to the releases from before wandelzeug, in the order of
 * the file. It stops at the first release that does not fit.
 */
export function planImport(
  document: ChangelogDocument,
  kinds: readonly Kind[],
): ImportPlan {
  const { start, end } = legacyLines(document);
  const legacyBlocks = blocksOf(document, start, end);
  const legacy = splitReleases(legacyBlocks);
  const marked = document.releases
    .filter((section) => section.data === undefined)
    .sort((a, b) => compareVersions(b.version, a.version));
  const candidates = [
    ...marked.map((section) => markedCandidate(document, section, kinds)),
    ...legacy.map((release) => legacyCandidate(document, release, kinds)),
  ];

  const { converted, stop } = convertUntilMisfit(candidates);
  const convertedLegacy = converted
    .filter((conversion) => conversion.candidate.legacy)
    .map((conversion) => conversion.candidate.release);
  const links = moveLinks(
    document,
    outsideDefinitions(document, legacyBlocks),
    convertedLegacy,
  );
  const baseline = baselineAfter(document, legacy.length, stop?.candidate);
  const anchor =
    baseline?.name === document.baseline?.name
      ? []
      : [
          {
            start: document.anchor,
            end: document.anchor,
            lines: [anchorMarker(baseline?.name)],
          },
        ];
  const replacements = [
    ...converted.map((conversion) => conversion.replacement),
    ...anchor,
    ...links.replacements,
  ];

  return {
    content: replaceLines(document, replacements),
    converted: converted.map((conversion) => conversion.candidate.release),
    stop:
      stop === undefined
        ? undefined
        : {
            release: stop.candidate.release,
            line: lineAfter(stop.candidate.line, replacements),
            reason: stop.reason,
            legacy: stop.candidate.legacy,
          },
    baseline: { before: document.baseline, after: baseline },
    movedLinks: links.moved,
    unmovedLinks: links.unmoved,
  };
}
