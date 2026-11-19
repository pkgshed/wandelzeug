/**
 * Off-boarding with "wlz offboard", for a project that stops using
 * wandelzeug: the .changes directory goes, and with --strip-markers the
 * changelog loses its markers and data blocks. The notes and the link
 * definitions stay, so the changelog reads as before.
 */

import { rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import {
  hasAnyMarker,
  type StrippedChangelog,
  stripMarkers,
} from "../changelog/markers.ts";
import { isFragmentFile } from "../changes/fragments.ts";
import {
  countOf,
  displayPath,
  listDirectory,
  readOptionalFile,
} from "../shared/foundations.ts";
import {
  changelogPath,
  changesPath,
  draftPath,
  type Project,
  unreleasedPath,
} from "./root.ts";

/** Recorded work that the .changes directory holds and that off-boarding deletes. */
export type PendingWork = {
  /** The unreleased change files. */
  readonly changes: readonly string[];
  /** The draft that "new --edit" kept, if any. */
  readonly draft: string | undefined;
};

/** What off-boarding does to the changelog. */
export type ChangelogOutcome =
  | {
      readonly action: "strip";
      readonly path: string;
      readonly stripped: StrippedChangelog;
    }
  | { readonly action: "keep markers"; readonly path: string }
  | { readonly action: "none" };

/** What "wlz offboard" removes and changes. */
export type OffboardPlan = {
  /** The .changes directory, which goes with everything in it. */
  readonly changesPath: string;
  readonly pending: PendingWork;
  /**
   * The unreleased directory when the configuration places it outside
   * .changes. Off-boarding leaves it alone, so it deletes nothing that
   * belongs to the rest of the project.
   */
  readonly outsideUnreleased: string | undefined;
  readonly changelog: ChangelogOutcome;
};

/** Reports whether a path lies inside a directory or is the directory itself. */
function isInside(directory: string, path: string): boolean {
  const rest = relative(directory, path);
  return rest === "" || (!rest.startsWith("..") && !isAbsolute(rest));
}

/** Lists the unreleased change files, which off-boarding deletes only inside .changes. */
async function findUnreleasedChanges(
  unreleased: string | undefined,
): Promise<string[]> {
  if (unreleased === undefined) return [];
  const fileNames = await listDirectory(unreleased);
  return fileNames
    .filter(isFragmentFile)
    .map((fileName) => join(unreleased, fileName));
}

async function findPendingWork(
  project: Project,
  unreleased: string | undefined,
): Promise<PendingWork> {
  const draft = draftPath(project);
  const hasDraft = await Bun.file(draft).exists();
  return {
    changes: await findUnreleasedChanges(unreleased),
    draft: hasDraft ? draft : undefined,
  };
}

/**
 * Plans the changelog. Without --strip-markers, it only notes that markers
 * stay, so a changelog with broken markers does not stop the off-boarding.
 */
async function planChangelog(
  project: Project,
  strip: boolean,
): Promise<ChangelogOutcome> {
  const path = changelogPath(project);
  const text = await readOptionalFile(path);
  if (text === undefined || !hasAnyMarker(text)) {
    return { action: "none" };
  }
  if (!strip) return { action: "keep markers", path };
  return { action: "strip", path, stripped: stripMarkers(text) };
}

/** The choices of "wlz offboard" that change what it plans. */
export type OffboardOptions = {
  /** Whether to remove the markers and data blocks from the changelog. */
  readonly stripMarkers: boolean;
};

/** Plans the off-boarding of a project without changing anything. */
export async function planOffboarding(
  project: Project,
  options: OffboardOptions,
): Promise<OffboardPlan> {
  const changes = changesPath(project);
  const unreleased = unreleasedPath(project);
  const unreleasedInside = isInside(changes, unreleased);
  return {
    changesPath: changes,
    pending: await findPendingWork(
      project,
      unreleasedInside ? unreleased : undefined,
    ),
    outsideUnreleased: unreleasedInside ? undefined : unreleased,
    changelog: await planChangelog(project, options.stripMarkers),
  };
}

/** Describes pending work, such as "2 unreleased changes and a draft". */
export function describePendingWork(pending: PendingWork): string | undefined {
  const parts = [
    ...(pending.changes.length > 0
      ? [countOf(pending.changes.length, "unreleased change")]
      : []),
    ...(pending.draft === undefined ? [] : ["a draft"]),
  ];
  return parts.length === 0 ? undefined : parts.join(" and ");
}

/**
 * Refuses to delete recorded work, so that nothing gets lost by accident.
 * The message says how to keep the work, and how to delete it anyway.
 */
export function refusePendingWork(plan: OffboardPlan): void {
  const pending = describePendingWork(plan.pending);
  if (pending === undefined) return;
  const ways = [
    ...(plan.pending.changes.length > 0
      ? ['release the changes with "wlz batch" or "wlz release"']
      : []),
    ...(plan.pending.draft === undefined
      ? []
      : ['record the draft with "wlz new --resume"']),
  ];
  throw new Error(
    `offboard: ${displayPath(plan.changesPath)} holds ${pending}. To keep that work, ${ways.join(" and ")} first. To delete it, pass --force`,
  );
}

/**
 * Carries out a plan. The changelog comes first, so a failure to write it
 * leaves the .changes directory in place.
 */
export async function applyOffboarding(plan: OffboardPlan): Promise<void> {
  if (plan.changelog.action === "strip") {
    await writeFile(plan.changelog.path, plan.changelog.stripped.text);
  }
  await rm(plan.changesPath, { recursive: true, force: true });
}
