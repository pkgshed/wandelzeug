/**
 * Releasing with "wlz release": the release goes into the changelog, gets a
 * commit of its own, and the tag helper tags that commit. The helper checks
 * the version and the working tree first, so nothing changes when the tag
 * history disagrees with the changelog.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  type ReleasePlan,
  removeFragments,
  writeRelease,
} from "../changelog/releases.ts";
import { errorMessage } from "../shared/foundations.ts";
import { runGit } from "../shared/git.ts";
import { type Bump, formatVersion } from "../shared/versions.ts";
import { changelogPath, type Project, unreleasedPath } from "./root.ts";

/**
 * Runs the tag helper of a project in its root directory. Like an editor,
 * it runs through the shell, so the setting may carry arguments.
 */
export async function runTagHelper(
  project: Project,
  args: readonly string[],
): Promise<void> {
  const helper = project.config.tagHelper;
  const child = Bun.spawn(["sh", "-c", `${helper} "$@"`, helper, ...args], {
    cwd: project.root,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await child.exited;
  if (status !== 0) {
    throw new Error(
      `run tag helper ${JSON.stringify(helper)}: exit status ${status}`,
    );
  }
}

/** The version that the helper must arrive at, without any prefix. */
const expectedVersion = (plan: ReleasePlan): string =>
  formatVersion(plan.version, "");

/**
 * The arguments that ask the helper to bump part to the version of the
 * plan. The project root sets the tag scope, such as "mod" for tags like
 * "mod/v1.2.3" in a monorepo.
 */
const bumpArguments = (
  project: Project,
  part: Bump,
  plan: ReleasePlan,
): string[] => [
  "-C",
  project.root,
  "bump",
  part,
  "--expect",
  expectedVersion(plan),
];

/** Asks the tag helper whether it would tag the version of the plan, without creating anything. */
export const checkTag = (
  project: Project,
  part: Bump,
  plan: ReleasePlan,
): Promise<void> =>
  runTagHelper(project, [...bumpArguments(project, part, plan), "--dry-run"]);

/** Names a release in the configured prefix, such as "1.2.3". */
const releaseName = (project: Project, plan: ReleasePlan): string =>
  formatVersion(plan.version, project.config.versionPrefix);

/** Commits the changelog and the removed fragments of a release, and returns the abbreviated commit hash. */
async function commitRelease(
  project: Project,
  plan: ReleasePlan,
): Promise<string> {
  const paths = [changelogPath(project), unreleasedPath(project)].map((path) =>
    relative(project.root, path),
  );
  const message = `release ${releaseName(project, plan)}`;
  await runGit(project.root, [
    "commit",
    "--quiet",
    "--message",
    message,
    "--",
    ...paths,
  ]);
  const commit = await runGit(project.root, ["rev-parse", "--short", "HEAD"]);
  return commit.trim();
}

/** Tags the release commit through the helper, with the release notes as the tag message. */
async function tagRelease(
  project: Project,
  part: Bump,
  plan: ReleasePlan,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "wlz-release-"));
  const messageFile = join(directory, "notes.md");
  try {
    await writeFile(messageFile, `${plan.notes}\n`);
    await runTagHelper(project, [
      ...bumpArguments(project, part, plan),
      "--message-file",
      messageFile,
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** What "wlz release" did. */
export type ReleaseResult = {
  readonly name: string;
  /** The abbreviated hash of the release commit. */
  readonly commit: string;
};

/**
 * Writes a planned release, commits it, and tags the commit. The helper
 * checks the version and the working tree before anything changes. When
 * tagging fails after the commit, the error names the commit to tag.
 */
export async function releaseAndTag(
  project: Project,
  part: Bump,
  plan: ReleasePlan,
): Promise<ReleaseResult> {
  await checkTag(project, part, plan);
  await writeRelease(plan);
  await removeFragments(plan.fragments);
  const commit = await commitRelease(project, plan);

  try {
    await tagRelease(project, part, plan);
  } catch (error) {
    const retry = `${project.config.tagHelper} bump ${part} --expect ${expectedVersion(plan)}`;
    throw new Error(
      `${errorMessage(error)}\nThe release commit ${commit} stays untagged. Fix the problem, then tag it, for example with "${retry}".`,
      { cause: error },
    );
  }
  return { name: releaseName(project, plan), commit };
}
