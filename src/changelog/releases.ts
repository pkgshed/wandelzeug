/**
 * Releases: version bumps, rendering, and adding a release to the
 * changelog.
 */

import { rm, writeFile } from "node:fs/promises";
import {
  type Change,
  type Fragment,
  loadFragments,
} from "../changes/fragments.ts";
import { type Config, findKind, type Kind } from "../project/config.ts";
import { type FileUpdate, planReplacements } from "../project/replacements.ts";
import {
  changelogPath,
  type Project,
  type Templates,
  unreleasedPath,
} from "../project/root.ts";
import { displayPath } from "../shared/foundations.ts";
import { listItems } from "../shared/markdown.ts";
import {
  definitionLine,
  findReferences,
  normalizeLabel,
  type Reference,
} from "../changes/references.ts";
import {
  renderTemplate,
  type Template,
  type TemplatePartials,
  type TemplateView,
} from "../shared/templates.ts";
import {
  type Bump,
  BUMPS,
  bumpVersion,
  compareVersions,
  formatVersion,
  type IsoDate,
  parseVersion,
  type Version,
  ZERO_VERSION,
} from "../shared/versions.ts";
import { notesHash, type ReleaseData } from "./data.ts";
import {
  type ChangelogDocument,
  definedLabels,
  insertRelease,
  knownReleases,
  LINKS_BEGIN,
  readChangelog,
  type Release,
  releaseSection,
} from "./markers.ts";

/** Arguments that name a bump instead of a version. */
export const BUMP_ARGUMENTS = [...BUMPS, "auto"] as const;
export type BumpArgument = (typeof BUMP_ARGUMENTS)[number];

export const isBumpArgument = (text: string): text is BumpArgument =>
  (BUMP_ARGUMENTS as readonly string[]).includes(text);

/** Picks the most significant bump among the kinds of the given changes. */
export function autoBump(
  changes: readonly Change[],
  kinds: readonly Kind[],
): Bump {
  const bumps = new Set(
    changes.map((change) => findKind(kinds, change.kind)?.bump),
  );
  const bump = BUMPS.find((candidate) => bumps.has(candidate));
  if (bump === undefined) {
    throw new Error("auto bump: no unreleased change has a kind with a bump");
  }
  return bump;
}

/**
 * Bumps the latest stable release, or 0.0.0 when nothing is released yet.
 * The releases must come newest first. Prereleases are skipped because a
 * patch bump of 2.0.0-rc.1 would otherwise yield 2.0.1 instead of a
 * successor to the stable line.
 */
export function nextVersion(releases: readonly Release[], bump: Bump): Version {
  const latestStable = releases.find(
    (release) => release.version.prerelease === undefined,
  );
  return bumpVersion(latestStable?.version ?? ZERO_VERSION, bump);
}

/** Ends a format with exactly one line break, so its partial fills whole lines. */
const asLines = (template: Template): string =>
  `${template.source.replace(/\n+$/, "")}\n`;

/** The formats, as the partials that releaseTemplate places. */
const releasePartials = (templates: Templates): TemplatePartials => ({
  version: asLines(templates.version),
  kind: asLines(templates.kind),
  change: asLines(templates.change),
});

/**
 * The entries of one change, each with the front matter and the kind of
 * the change. A body that holds only list items yields one entry per item,
 * with the item as body, its marker, and its text. Any other body yields
 * one entry, whose text is the whole body and whose marker is empty.
 */
function changeEntries(change: Change): TemplateView[] {
  const values = { ...change.metadata, kind: change.kind };
  const items = listItems(change.body);
  if (items === undefined) {
    return [{ ...values, body: change.body, marker: "", text: change.body }];
  }
  return items.map((item) => ({ ...values, ...item }));
}

/** Groups the changes by kind in the configured order and leaves out kinds without changes. */
function kindViews(
  kinds: readonly Kind[],
  changes: readonly Change[],
): TemplateView[] {
  return kinds.flatMap((kind) => {
    const members = changes.filter((change) => change.kind === kind.label);
    if (members.length === 0) return [];
    return [{ kind: kind.label, changes: members.flatMap(changeEntries) }];
  });
}

/** What templates know about a release besides its changes. */
export type ReleaseValues = {
  /** The release name with the version prefix, such as "1.1.2". */
  readonly version: string;
  readonly date: IsoDate;
  /** The git tag with the tag prefix, such as "v1.1.2". */
  readonly tag: string;
  readonly previousVersion: string | undefined;
  readonly previousTag: string | undefined;
};

/**
 * Picks the release that a new version follows: the highest known release
 * below it. A hotfix such as 1.4.3 thus follows 1.4.2, even after 1.5.0.
 */
export function previousRelease(
  releases: readonly Release[],
  version: Version,
): Release | undefined {
  const [previous] = releases
    .filter((release) => compareVersions(release.version, version) < 0)
    .sort((a, b) => compareVersions(b.version, a.version));
  return previous;
}

/** Describes a new release for the templates, with names in the configured prefixes. */
export function releaseValues(
  config: Config,
  version: Version,
  date: IsoDate,
  releases: readonly Release[],
): ReleaseValues {
  const previous = previousRelease(releases, version)?.version;
  return {
    version: formatVersion(version, config.versionPrefix),
    date,
    tag: formatVersion(version, config.tagPrefix),
    previousVersion:
      previous === undefined
        ? undefined
        : formatVersion(previous, config.versionPrefix),
    previousTag:
      previous === undefined
        ? undefined
        : formatVersion(previous, config.tagPrefix),
  };
}

/**
 * Renders a release through releaseTemplate. The template sees the release
 * values and kinds, where each kind has a kind and its changes.
 */
export function renderRelease(
  project: Project,
  values: ReleaseValues,
  changes: readonly Change[],
): string {
  const view = {
    ...values,
    kinds: kindViews(project.config.kinds, changes),
  };
  const partials = releasePartials(project.templates);
  return renderTemplate(project.templates.release, view, partials).trim();
}

const repositoryUrlOf = (project: Project): string =>
  project.config.repositoryUrl.replace(/\/+$/, "");

/** Reports whether links are off because linkFormat needs repositoryUrl, which is empty. */
export const linksLackRepository = (project: Project): boolean =>
  project.templates.link.names.includes("repositoryUrl") &&
  repositoryUrlOf(project) === "";

/**
 * Renders the link definition of a release, or returns undefined when links
 * are off. Links are off with an empty linkFormat, and with a linkFormat
 * that needs repositoryUrl while repositoryUrl is empty.
 */
export function renderLink(
  project: Project,
  values: ReleaseValues,
): string | undefined {
  const { link } = project.templates;
  if (link.source.trim() === "" || linksLackRepository(project)) {
    return undefined;
  }
  return renderTemplate(link, {
    ...values,
    repositoryUrl: repositoryUrlOf(project),
  }).trim();
}

/** What a release gets as its version: an explicit version or a bump of the latest release. */
export type ReleaseTarget =
  | { readonly type: "version"; readonly version: Version }
  | { readonly type: "bump"; readonly bump: BumpArgument };

/** Parses a release target, such as "1.4.0" or "auto". It returns undefined for other text. */
export function parseReleaseTarget(text: string): ReleaseTarget | undefined {
  if (isBumpArgument(text)) {
    return { type: "bump", bump: text };
  }
  const version = parseVersion(text);
  return version === undefined ? undefined : { type: "version", version };
}

function resolveReleaseVersion(
  target: ReleaseTarget,
  releases: readonly Release[],
  fragments: readonly Fragment[],
  kinds: readonly Kind[],
): Version {
  if (target.type === "version") return target.version;
  const bump =
    target.bump === "auto" ? autoBump(fragments, kinds) : target.bump;
  return nextVersion(releases, bump);
}

function rejectExistingRelease(
  releases: readonly Release[],
  version: Version,
): void {
  const existing = releases.find(
    (release) => compareVersions(release.version, version) === 0,
  );
  if (existing !== undefined) {
    throw new Error(`release ${existing.name} exists already in the changelog`);
  }
}

/**
 * Orders changes by the configured order of their kinds, and keeps the
 * order within each kind, as the notes have them. Kinds that the
 * configuration lacks come last.
 */
export function inKindOrder(
  changes: readonly Change[],
  kinds: readonly Kind[],
): Change[] {
  const rank = (change: Change): number => {
    const kind = findKind(kinds, change.kind);
    return kind === undefined ? kinds.length : kinds.indexOf(kind);
  };
  return [...changes].sort((a, b) => rank(a) - rank(b));
}

/** The data block of a new release: its date, its changes without their files, and the hash of its notes. */
const releaseData = (
  date: IsoDate,
  changes: readonly Change[],
  kinds: readonly Kind[],
  notes: string,
): ReleaseData => ({
  date,
  hash: notesHash(notes),
  changes: inKindOrder(changes, kinds).map(({ kind, metadata, body }) => ({
    kind,
    metadata,
    body,
  })),
});

/**
 * Lists the link definitions that a new release adds: its own link, and
 * the definitions of its references that the changelog lacks so far.
 */
function newLinks(
  project: Project,
  document: ChangelogDocument,
  values: ReleaseValues,
  references: readonly Reference[],
): string[] {
  const link = renderLink(project, values);
  const defined = new Set(definedLabels(document).map(normalizeLabel));
  const definitions = references
    .filter((reference) => !defined.has(normalizeLabel(reference.label)))
    .map(definitionLine);
  return [...(link === undefined ? [] : [link]), ...definitions];
}

/** The changelog with a new release, and the fragments the release consumes. */
export type ReleasePlan = {
  readonly path: string;
  /** The version of the release. */
  readonly version: Version;
  /** The release as the template renders it, without markers, such as for a tag message. */
  readonly notes: string;
  /** The release with its markers, and its data block when releaseData is on, as batch inserts it. */
  readonly section: string;
  /**
   * The link definitions that batch inserts below the BEGIN wlz:links
   * marker: the link of the release when links are on, and the definitions
   * of the references that no earlier release defined.
   */
  readonly links: readonly string[];
  /** The references in the notes, which a tag message needs to define. */
  readonly references: readonly Reference[];
  /** The whole changelog after the insertion. */
  readonly content: string;
  /** The files besides the changelog that the replacements rewrite. */
  readonly updates: readonly FileUpdate[];
  readonly fragments: readonly Fragment[];
};

/**
 * Plans the release of all unreleased changes without writing anything. The
 * release name always carries the configured version prefix, and its tag
 * the configured tag prefix.
 */
export async function planRelease(
  project: Project,
  target: ReleaseTarget,
  date: IsoDate,
): Promise<ReleasePlan> {
  const fragments = await loadFragments(project);
  if (fragments.length === 0) {
    throw new Error(
      `batch: no unreleased changes in ${displayPath(unreleasedPath(project))}`,
    );
  }

  const document = await readChangelog(project);
  const releases = knownReleases(document);
  const version = resolveReleaseVersion(
    target,
    releases,
    fragments,
    project.config.kinds,
  );
  rejectExistingRelease(releases, version);

  const values = releaseValues(project.config, version, date, releases);
  const notes = renderRelease(project, values, fragments);
  const data = project.config.releaseData
    ? releaseData(date, fragments, project.config.kinds, notes)
    : undefined;
  const section = releaseSection(values.version, data, notes);
  const references = findReferences(project, notes);
  const links = newLinks(project, document, values, references);
  if (links.length > 0 && document.links === undefined) {
    throw new Error(
      `${displayPath(changelogPath(project))}: no ${LINKS_BEGIN} marker for the link definitions of ${values.version}, add the BEGIN and END wlz:links markers where the link definitions go`,
    );
  }
  return {
    path: changelogPath(project),
    version,
    notes,
    section,
    links,
    references,
    content: insertRelease(document, section, links),
    updates: await planReplacements(project.replacements, values),
    fragments,
  };
}

/** Writes the changelog of a plan and the files that its replacements rewrite. */
export async function writeRelease(plan: ReleasePlan): Promise<void> {
  await writeFile(plan.path, plan.content);
  await Promise.all(
    plan.updates.map((update) => writeFile(update.path, update.content)),
  );
}

/** Deletes the fragment files that a release consumed. */
export async function removeFragments(
  fragments: readonly Fragment[],
): Promise<void> {
  await Promise.all(fragments.map((fragment) => rm(fragment.path)));
}
