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
import { findKind, type Kind } from "../project/config.ts";
import {
  changelogPath,
  type Project,
  type Templates,
  unreleasedPath,
} from "../project/root.ts";
import { displayPath, UsageError } from "../shared/foundations.ts";
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
import {
  beginMarker,
  endMarker,
  insertRelease,
  knownReleases,
  readChangelog,
  type Release,
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

/** The values of one change: its front matter, its kind and its body. */
const changeView = (change: Change): TemplateView => ({
  ...change.metadata,
  kind: change.kind,
  body: change.body,
});

/** Groups the changes by kind in the configured order and leaves out kinds without changes. */
function kindViews(
  kinds: readonly Kind[],
  changes: readonly Change[],
): TemplateView[] {
  return kinds.flatMap((kind) => {
    const members = changes.filter((change) => change.kind === kind.label);
    if (members.length === 0) return [];
    return [{ kind: kind.label, changes: members.map(changeView) }];
  });
}

/**
 * Renders a release through releaseTemplate. The template sees version,
 * date, and kinds, where each kind has a kind and its changes.
 */
export function renderRelease(
  project: Project,
  versionName: string,
  date: IsoDate,
  changes: readonly Change[],
): string {
  const view = {
    version: versionName,
    date,
    kinds: kindViews(project.config.kinds, changes),
  };
  const partials = releasePartials(project.templates);
  return renderTemplate(project.templates.release, view, partials).trim();
}

/** Renders a release wrapped in its BEGIN and END markers. */
export function renderReleaseSection(
  project: Project,
  versionName: string,
  date: IsoDate,
  changes: readonly Change[],
): string {
  return [
    beginMarker(versionName),
    renderRelease(project, versionName, date, changes),
    endMarker(versionName),
  ].join("\n");
}

/** What a release gets as its version: an explicit version or a bump of the latest release. */
export type ReleaseTarget =
  | { readonly type: "version"; readonly version: Version }
  | { readonly type: "bump"; readonly bump: BumpArgument };

/** Parses the version argument of "wlz batch". */
export function parseReleaseTarget(argument: string): ReleaseTarget {
  if (isBumpArgument(argument)) {
    return { type: "bump", bump: argument };
  }

  const version = parseVersion(argument);
  if (version === undefined) {
    const bumps = BUMP_ARGUMENTS.join(", ");
    throw new UsageError(
      `invalid version ${JSON.stringify(argument)}, expected a semantic version or one of: ${bumps}`,
    );
  }
  return { type: "version", version };
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

/** The changelog with a new release, and the fragments the release consumes. */
export type ReleasePlan = {
  readonly path: string;
  /** The release with its markers, as batch inserts it. */
  readonly section: string;
  /** The whole changelog after the insertion. */
  readonly content: string;
  readonly fragments: readonly Fragment[];
};

/**
 * Plans the release of all unreleased changes without writing anything. The
 * release name always carries the configured version prefix.
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

  const name = formatVersion(version, project.config.versionPrefix);
  const section = renderReleaseSection(project, name, date, fragments);
  return {
    path: changelogPath(project),
    section,
    content: insertRelease(document, section),
    fragments,
  };
}

/** Writes the changelog of a plan. */
export async function writeRelease(plan: ReleasePlan): Promise<void> {
  await writeFile(plan.path, plan.content);
}

/** Deletes the fragment files that a release consumed. */
export async function removeFragments(
  fragments: readonly Fragment[],
): Promise<void> {
  await Promise.all(fragments.map((fragment) => rm(fragment.path)));
}
