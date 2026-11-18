/**
 * Releasing with "wlz release": the release goes into the changelog, gets a
 * commit of its own, and the tag helper tags that commit. wandelzeug checks
 * the files of the release and the tag first, and so may the tag helper,
 * so nothing changes when a check fails.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import {
  type ReleasePlan,
  removeFragments,
  writeRelease,
} from "../changelog/releases.ts";
import { errorMessage } from "../shared/foundations.ts";
import { gitSucceeds, runGit } from "../shared/git.ts";
import {
  renderTemplate,
  type Template,
  type TemplateView,
} from "../shared/templates.ts";
import type { Bump } from "../shared/versions.ts";
import { changelogPath, type Project, unreleasedPath } from "./root.ts";

/** The paths that the release commit holds, relative to the project root. */
const releasePaths = (project: Project, plan: ReleasePlan): string[] =>
  [
    changelogPath(project),
    unreleasedPath(project),
    ...plan.updates.map((update) => update.path),
  ].map((path) => relative(project.root, path));

/**
 * Checks that the files of the release hold no uncommitted changes, so the
 * release commit holds only what the release writes. Untracked files and
 * the rest of the repository do not count.
 */
async function checkReleaseFiles(
  project: Project,
  plan: ReleasePlan,
): Promise<void> {
  const status = await runGit(project.root, [
    "status",
    "--porcelain",
    "--untracked-files=no",
    "--",
    ...releasePaths(project, plan),
  ]);
  const changed = status
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => line.slice(3));
  if (changed.length > 0) {
    throw new Error(
      `release: commit or undo the changes to ${changed.join(", ")} first`,
    );
  }
}

/** Checks that the tag of the release does not exist yet. */
async function checkTagIsNew(
  project: Project,
  plan: ReleasePlan,
): Promise<void> {
  const { tag } = plan.values;
  const exists = await gitSucceeds(project.root, [
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/tags/${tag}`,
  ]);
  if (exists) {
    throw new Error(`release: the tag ${tag} exists already`);
  }
}

/** The values of the tag helper. The release commit only exists for the create step. */
const tagValues = (
  project: Project,
  part: Bump,
  plan: ReleasePlan,
  messageFile: string,
  commit?: string,
): TemplateView => ({
  ...plan.values,
  bump: part,
  root: project.root,
  message: plan.tagMessage,
  messageFile,
  ...(commit === undefined ? {} : { commit }),
});

const renderArguments = (
  args: readonly Template[],
  values: TemplateView,
): string[] => args.map((arg) => renderTemplate(arg, values));

/** Starts a command, and names the program when it cannot start. */
function spawnStep(
  step: string,
  command: readonly string[],
  env: Record<string, string | undefined>,
  cwd: string,
): Bun.Subprocess {
  try {
    return Bun.spawn([...command], {
      cwd,
      env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
  } catch (error) {
    throw new Error(
      `tag helper ${step}: run ${JSON.stringify(command[0])}: ${errorMessage(error)}`,
    );
  }
}

/**
 * Runs a step of the tag helper in the project root, without a shell, with
 * its environment variables on top of those of wandelzeug.
 */
async function runStep(
  project: Project,
  step: "check" | "create",
  args: readonly Template[],
  values: TemplateView,
): Promise<void> {
  const command = renderArguments(args, values);
  const variables = Object.entries(project.templates.tagHelper.env).map(
    ([name, value]) => [name, renderTemplate(value, values)],
  );
  const env = { ...process.env, ...Object.fromEntries(variables) };
  const status = await spawnStep(step, command, env, project.root).exited;
  if (status !== 0) {
    throw new Error(
      `tag helper ${step}: ${JSON.stringify(command[0])} exited with status ${status}`,
    );
  }
}

/** Runs the checks of wandelzeug, then the check step of the tag helper if there is one. */
async function runChecks(
  project: Project,
  part: Bump,
  plan: ReleasePlan,
  messageFile: string,
): Promise<void> {
  await checkReleaseFiles(project, plan);
  await checkTagIsNew(project, plan);
  const { check } = project.templates.tagHelper;
  if (check === undefined) return;
  const values = tagValues(project, part, plan, messageFile);
  await runStep(project, "check", check, values);
}

/** Writes the tag message to a file of its own, for the {{messageFile}} value. */
async function writeMessageFile(plan: ReleasePlan): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "wlz-release-"));
  const path = join(directory, "message.txt");
  await writeFile(path, `${plan.tagMessage}\n`);
  return path;
}

const removeMessageFile = (path: string): Promise<void> =>
  rm(dirname(path), { recursive: true, force: true });

/** Checks a release as "wlz release" would, without changing anything. */
export async function checkRelease(
  project: Project,
  part: Bump,
  plan: ReleasePlan,
): Promise<void> {
  const messageFile = await writeMessageFile(plan);
  try {
    await runChecks(project, part, plan, messageFile);
  } finally {
    await removeMessageFile(messageFile);
  }
}

/** The release commit, in full for the tag helper and abbreviated for messages. */
type ReleaseCommit = {
  readonly hash: string;
  readonly short: string;
};

/** Commits the changelog, the removed fragments and the replaced files of a release. */
async function commitRelease(
  project: Project,
  plan: ReleasePlan,
): Promise<ReleaseCommit> {
  await runGit(project.root, [
    "commit",
    "--quiet",
    "--message",
    `release ${plan.values.version}`,
    "--",
    ...releasePaths(project, plan),
  ]);
  const hash = (await runGit(project.root, ["rev-parse", "HEAD"])).trim();
  const short = await runGit(project.root, ["rev-parse", "--short", hash]);
  return { hash, short: short.trim() };
}

/** Quotes an argument for a POSIX shell when it holds more than safe characters. */
const shellQuote = (arg: string): string =>
  /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;

/** What "wlz release" did. */
export type ReleaseResult = {
  readonly name: string;
  /** The abbreviated hash of the release commit. */
  readonly commit: string;
};

/**
 * Writes a planned release, commits it, and tags the commit. The checks run
 * before anything changes. When the create step fails after the commit, the
 * error names the commit, keeps the tag message, and shows the command to
 * try again.
 */
export async function releaseAndTag(
  project: Project,
  part: Bump,
  plan: ReleasePlan,
): Promise<ReleaseResult> {
  const messageFile = await writeMessageFile(plan);
  try {
    await runChecks(project, part, plan, messageFile);
  } catch (error) {
    await removeMessageFile(messageFile);
    throw error;
  }

  await writeRelease(plan);
  await removeFragments(plan.fragments);
  const commit = await commitRelease(project, plan);
  const values = tagValues(project, part, plan, messageFile, commit.hash);
  const { create } = project.templates.tagHelper;
  try {
    await runStep(project, "create", create, values);
  } catch (error) {
    const retry = renderArguments(create, values).map(shellQuote).join(" ");
    throw new Error(
      `${errorMessage(error)}\nThe release commit ${commit.short} stays untagged, and the tag message stays in ${messageFile}. Fix the problem, then tag the commit, for example with: ${retry}`,
      { cause: error },
    );
  }
  await removeMessageFile(messageFile);
  return { name: plan.values.version, commit: commit.short };
}
