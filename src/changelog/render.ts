/**
 * Rendering the releases of the changelog again from their data blocks,
 * after a template or the configuration changed: "wlz render". A hash of
 * the notes guards releases that someone edited by hand.
 */

import type { Change } from "../changes/fragments.ts";
import { findKind } from "../project/config.ts";
import { changelogPath, type Project } from "../project/root.ts";
import { displayPath } from "../shared/foundations.ts";
import { compareVersions } from "../shared/versions.ts";
import { notesHash, type ReleaseData } from "./data.ts";
import {
  type ChangelogDocument,
  currentNotes,
  knownReleases,
  type LineReplacement,
  LINKS_BEGIN,
  readChangelog,
  type Release,
  type ReleaseSection,
  releaseSection,
  replaceLines,
} from "./markers.ts";
import {
  inKindOrder,
  linksLackRepository,
  type ReleaseValues,
  releaseValues,
  renderLink,
  renderRelease,
} from "./releases.ts";
import {
  definitionLine,
  findReferences,
  normalizeLabel,
  type Reference,
} from "../changes/references.ts";

/** A release with its data block. */
type DataSection = ReleaseSection & { readonly data: ReleaseData };

const hasData = (section: ReleaseSection): section is DataSection =>
  section.data !== undefined;

/** Names the kinds of a release that the configuration no longer has. */
function missingKindProblems(project: Project, section: DataSection): string[] {
  const labels = section.data.changes.map((change) => change.kind);
  const missing = [...new Set(labels)].filter(
    (label) => findKind(project.config.kinds, label) === undefined,
  );
  return missing.map(
    (label) =>
      `line ${section.begin + 1}: release ${section.name} has changes of kind ${JSON.stringify(label)}, which the configuration lacks`,
  );
}

/** Reports a release whose notes differ from what wandelzeug rendered last. */
function editProblems(
  document: ChangelogDocument,
  section: DataSection,
): string[] {
  const isUnchanged =
    notesHash(currentNotes(document, section)) === section.data.hash;
  if (isUnchanged) return [];
  return [
    `line ${section.begin + 1}: release ${section.name} was edited by hand since wandelzeug rendered it`,
  ];
}

/**
 * Lists the problems of the data blocks in a changelog: kinds that the
 * configuration lacks, and notes that were edited by hand.
 */
export const releaseDataProblems = (
  project: Project,
  document: ChangelogDocument,
): string[] =>
  document.releases
    .filter(hasData)
    .flatMap((section) => [
      ...missingKindProblems(project, section),
      ...editProblems(document, section),
    ]);

/** Uses the configured label for the kind of each change, as batch does. */
const withConfiguredKinds = (
  project: Project,
  changes: readonly Change[],
): Change[] =>
  changes.map((change) => ({
    ...change,
    kind: findKind(project.config.kinds, change.kind)?.label ?? change.kind,
  }));

/** A release that rendered again from its data block. */
type RenderedRelease = {
  readonly section: DataSection;
  readonly values: ReleaseValues;
  readonly notes: string;
  readonly replacement: LineReplacement;
};

/** Renders a release with data again, with a new hash for its new notes. */
function renderSection(
  project: Project,
  section: DataSection,
  releases: readonly Release[],
): RenderedRelease {
  const { data } = section;
  const values = releaseValues(
    project.config,
    section.version,
    data.date,
    releases,
  );
  const changes = inKindOrder(
    withConfiguredKinds(project, data.changes),
    project.config.kinds,
  );
  const notes = renderRelease(project, values, changes);
  const rendered = releaseSection(
    values.version,
    { date: data.date, hash: notesHash(notes), changes },
    notes,
  );
  return {
    section,
    values,
    notes,
    replacement: {
      start: section.begin,
      end: section.end,
      lines: rendered.split("\n"),
    },
  };
}

/**
 * Assigns each reference to the oldest release whose notes use it, as
 * batch does when it adds only the definitions that the changelog lacks.
 */
function newReferences(
  project: Project,
  oldestFirst: readonly RenderedRelease[],
): Reference[][] {
  const used = oldestFirst.map((release) =>
    findReferences(project, release.notes),
  );
  return used.map((references, index) => {
    const earlier = new Set(
      used
        .slice(0, index)
        .flat()
        .map((reference) => normalizeLabel(reference.label)),
    );
    return references.filter(
      (reference) => !earlier.has(normalizeLabel(reference.label)),
    );
  });
}

/**
 * Renders the link definitions of every marked release, newest first:
 * the link of each release, followed by the definitions of the references
 * that it was the first to use. That is the order in which batch inserts
 * them. Without links and references, it empties the markers.
 */
function renderLinks(
  project: Project,
  rendered: readonly RenderedRelease[],
): string[] {
  const oldestFirst = [...rendered].sort((a, b) =>
    compareVersions(a.section.version, b.section.version),
  );
  const references = newReferences(project, oldestFirst);
  const blocks = oldestFirst.map((release, index) => {
    const link = renderLink(project, release.values);
    return [
      ...(link === undefined ? [] : [link]),
      ...(references[index] ?? []).map(definitionLine),
    ];
  });
  return blocks.reverse().flat();
}

/** What "wlz render" plans to write. */
export type RenderPlan = {
  readonly path: string;
  readonly content: string;
  /** The number of releases that render from their data blocks. */
  readonly rendered: number;
  /** The number of marked releases without a data block, which stay as they are. */
  readonly withoutData: number;
  /** Why the link definitions stay as they are, if they do. */
  readonly keptLinks: KeptLinks | undefined;
};

/**
 * Why render keeps the link definitions as they are: a link needs the date
 * of its release, which a release without a data block lacks, and an empty
 * repositoryUrl turns links off, which must not wipe definitions out.
 */
export type KeptLinks = "release without data" | "empty repositoryUrl";

export type RenderOptions = {
  /** Render releases that were edited by hand, and drop those edits. */
  readonly force: boolean;
};

/** Replaces the link definitions between the link markers. */
function linksReplacement(
  project: Project,
  document: ChangelogDocument,
  links: readonly string[],
): LineReplacement[] {
  const region = document.links;
  if (region !== undefined) {
    return [{ start: region.begin + 1, end: region.end - 1, lines: links }];
  }
  if (links.length === 0) return [];
  throw new Error(
    `${displayPath(changelogPath(project))}: no ${LINKS_BEGIN} marker for the link definitions, add the BEGIN and END wlz:links markers or set linkFormat to ""`,
  );
}

function linksKeptBecause(
  project: Project,
  withoutData: number,
): KeptLinks | undefined {
  if (withoutData > 0) return "release without data";
  if (linksLackRepository(project)) return "empty repositoryUrl";
  return undefined;
}

/** Explains why releases cannot render, with a way out for hand edits. */
function renderFailure(
  project: Project,
  kindProblems: readonly string[],
  edits: readonly string[],
): Error {
  const path = displayPath(changelogPath(project));
  const problems = [...kindProblems, ...edits].map(
    (problem) => `${path}: ${problem}`,
  );
  const hint =
    edits.length === 0
      ? []
      : [
          "render: to keep a hand edit, put it into the data block of the release, then pass --force to render over the edited notes",
        ];
  return new Error([...problems, ...hint].join("\n"));
}

/**
 * Plans to render every release with a data block again with the current
 * templates and configuration, and the link definitions unless KeptLinks
 * names a reason to keep them. Releases without data stay as they are. A release whose
 * notes were edited by hand stops the plan unless the options force it,
 * and so does a kind that the configuration lacks.
 */
export async function planRender(
  project: Project,
  options: RenderOptions,
): Promise<RenderPlan> {
  const document = await readChangelog(project);
  const releases = knownReleases(document);
  const sections = document.releases.filter(hasData);

  const kindProblems = sections.flatMap((section) =>
    missingKindProblems(project, section),
  );
  const edits = options.force
    ? []
    : sections.flatMap((section) => editProblems(document, section));
  if (kindProblems.length > 0 || edits.length > 0) {
    throw renderFailure(project, kindProblems, edits);
  }

  const withoutData = document.releases.length - sections.length;
  const keptLinks = linksKeptBecause(project, withoutData);
  const rendered = sections.map((section) =>
    renderSection(project, section, releases),
  );
  const links =
    keptLinks === undefined
      ? linksReplacement(project, document, renderLinks(project, rendered))
      : [];
  const replacements = [
    ...rendered.map((release) => release.replacement),
    ...links,
  ];
  return {
    path: changelogPath(project),
    content: replaceLines(document, replacements),
    rendered: sections.length,
    withoutData,
    keptLinks,
  };
}
