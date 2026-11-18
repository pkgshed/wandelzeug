#!/usr/bin/env bun
/**
 * wandelzeug records changelog fragments and adds them to a changelog as
 * releases, in the spirit of changie (https://changie.dev).
 *
 * Every change lives in its own Markdown file with YAML front matter:
 *
 *     ---
 *     kind: Added
 *     pr: 42
 *     ---
 *     * Support for TOML config
 *
 * Each project keeps its configuration in .changes/config.yaml.
 * Unreleased changes live in .changes/unreleased/nnn-<name>.md. The number
 * nnn orders the changes, and <name> comes from the fragmentName template.
 *
 * The changelog itself is the record of released versions. "wlz batch"
 * inserts each release below a <!-- wlz:releases --> anchor and wraps
 * it in <!-- BEGIN wlz:release VERSION --> and END markers. Everything
 * outside the markers belongs to the project and stays untouched.
 *
 * Run "wlz --help" for the command reference.
 */

import { resolve } from "node:path";
import {
  type ChangelogDocument,
  knownReleases,
  readChangelog,
  type Release,
  releaseNotes,
} from "./changelog/markers.ts";
import {
  autoBump,
  nextVersion,
  planRelease,
  removeFragments,
  writeRelease,
} from "./changelog/releases.ts";
import {
  editorCommand,
  findKeptDraft,
  recordFromDraft,
  startDraft,
} from "./changes/drafts.ts";
import { loadFragments, recordChange } from "./changes/fragments.ts";
import { readChangeOptions } from "./changes/options.ts";
import { askChange } from "./changes/questions.ts";
import {
  type Invocation,
  type InvocationOf,
  readCommandLine,
} from "./cli/arguments.ts";
import {
  changedFragments,
  checkProject,
  type GitRef,
} from "./project/checks.ts";
import { checkTag, releaseAndTag } from "./project/release.ts";
import {
  changelogPath,
  openProject,
  type Project,
  unreleasedPath,
} from "./project/root.ts";
import { initProject, type InitResult } from "./project/setup.ts";
import {
  countOf,
  displayPath,
  errorMessage,
  UsageError,
} from "./shared/foundations.ts";
import { compareVersions, formatVersion, today } from "./shared/versions.ts";

/** Opens the project at or above the directory that -C names, or the working directory. */
const openInvocationProject = (invocation: Invocation): Promise<Project> =>
  openProject(invocation.directory ?? ".");

const formatInitResult = (result: InitResult): string => {
  const detail = result.detail === undefined ? "" : ` (${result.detail})`;
  return `${result.action} ${displayPath(result.path)}${detail}`;
};

async function runInit(invocation: InvocationOf<"init">): Promise<void> {
  const directory = resolve(invocation.directory ?? ".");
  const results = await initProject(directory, {
    baseline: invocation.baseline,
    repositoryUrl: invocation.repository,
  });
  results.forEach((result) => console.log(formatInitResult(result)));
}

/** The invocation of "new" that writes a new change instead of resuming a draft. */
type WriteInvocation = Extract<InvocationOf<"new">, { mode: "write" }>;

async function resumeDraft(project: Project): Promise<string> {
  const editor = editorCommand();
  return recordFromDraft(project, editor, await findKeptDraft(project));
}

async function recordWithEditor(
  project: Project,
  invocation: WriteInvocation,
): Promise<string> {
  const editor = editorCommand();
  const options = await readChangeOptions(project.config.kinds, invocation);
  return recordFromDraft(project, editor, await startDraft(project, options));
}

async function recordWithQuestions(
  project: Project,
  invocation: WriteInvocation,
): Promise<string> {
  const options = await readChangeOptions(project.config.kinds, invocation);
  const change = await askChange(project.config, options);
  return recordChange(project, change);
}

/** Records the change that the invocation describes and returns the path of its file. */
function recordNewChange(
  project: Project,
  invocation: InvocationOf<"new">,
): Promise<string> {
  if (invocation.mode === "resume") return resumeDraft(project);
  if (invocation.edit) return recordWithEditor(project, invocation);
  return recordWithQuestions(project, invocation);
}

/**
 * Rejects --edit together with a body from stdin. This check runs after
 * parsing because Optique's or() commits to a branch at the first option
 * it reads. A separate branch for --edit would make the outcome depend on
 * the order of the options.
 */
function rejectEditorWithStdin(invocation: InvocationOf<"new">): void {
  const readsStdin = invocation.mode === "write" && invocation.body === "-";
  if (readsStdin && invocation.edit) {
    throw new UsageError(
      "new: the editor needs the terminal, so --body cannot read stdin",
    );
  }
}

async function runNew(invocation: InvocationOf<"new">): Promise<void> {
  rejectEditorWithStdin(invocation);
  const project = await openInvocationProject(invocation);
  const path = await recordNewChange(project, invocation);
  console.log(`created ${displayPath(path)}`);
}

/** Reports a missing change file when --since asks for one. */
async function sinceFailures(
  project: Project,
  since: GitRef | undefined,
): Promise<string[]> {
  if (since === undefined) return [];
  const changed = await changedFragments(project, since);
  if (changed.length > 0) return [];
  const directory = displayPath(unreleasedPath(project));
  return [`${directory}: no change file added or modified since ${since}`];
}

async function runCheck(invocation: InvocationOf<"check">): Promise<void> {
  const project = await openInvocationProject(invocation);
  const report = await checkProject(project);
  const failures = [
    ...report.problems.map(
      (problem) => `${displayPath(problem.path)}: ${problem.message}`,
    ),
    ...(await sinceFailures(project, invocation.since)),
  ];
  if (failures.length > 0) {
    failures.forEach((failure) => console.error(failure));
    throw new Error(`check: ${countOf(failures.length, "problem")}`);
  }
  console.log(`checked ${countOf(report.checked, "change")}`);
}

async function runBatch(invocation: InvocationOf<"batch">): Promise<void> {
  const project = await openInvocationProject(invocation);
  const date = invocation.date ?? today();
  const plan = await planRelease(project, invocation.target, date);
  if (invocation.dryRun) {
    const link = plan.link === undefined ? "" : `\n${plan.link}\n`;
    process.stdout.write(`${plan.section}\n${link}`);
    return;
  }

  await writeRelease(plan);
  if (!invocation.keep) {
    await removeFragments(plan.fragments);
  }
  const changes = countOf(plan.fragments.length, "change");
  console.log(`updated ${displayPath(plan.path)} from ${changes}`);
  plan.updates.forEach((update) =>
    console.log(`updated ${displayPath(update.path)}`),
  );
}

async function runLatest(invocation: InvocationOf<"latest">): Promise<void> {
  const project = await openInvocationProject(invocation);
  const [latest] = knownReleases(await readChangelog(project));
  if (latest === undefined) {
    const changelog = displayPath(changelogPath(project));
    throw new Error(`latest: no release and no baseline in ${changelog}`);
  }
  console.log(latest.name);
}

/** Explains why the changelog holds no notes for a version. */
function missingNotesMessage(
  project: Project,
  document: ChangelogDocument,
  release: Release,
): string {
  const isBaseline =
    document.baseline !== undefined &&
    compareVersions(document.baseline.version, release.version) === 0;
  if (isBaseline) {
    return `show: release ${release.name} predates wandelzeug and has no markers`;
  }
  const changelog = displayPath(changelogPath(project));
  return `show: no marked release ${release.name} in ${changelog}`;
}

async function runRelease(invocation: InvocationOf<"release">): Promise<void> {
  const project = await openInvocationProject(invocation);
  const date = invocation.date ?? today();
  const { bump } = invocation;
  const plan = await planRelease(project, { type: "bump", bump }, date);
  const part =
    bump === "auto" ? autoBump(plan.fragments, project.config.kinds) : bump;

  if (invocation.dryRun) {
    await checkTag(project, part, plan);
    const link = plan.link === undefined ? "" : `\n${plan.link}\n`;
    process.stdout.write(`${plan.section}\n${link}`);
    return;
  }

  const result = await releaseAndTag(project, part, plan);
  console.log(`released ${result.name} in commit ${result.commit}`);
}

async function runShow(invocation: InvocationOf<"show">): Promise<void> {
  const project = await openInvocationProject(invocation);
  const document = await readChangelog(project);
  const notes = releaseNotes(document, invocation.release.version);
  if (notes === undefined) {
    throw new Error(missingNotesMessage(project, document, invocation.release));
  }
  process.stdout.write(notes);
}

async function runNext(invocation: InvocationOf<"next">): Promise<void> {
  const project = await openInvocationProject(invocation);
  const bump =
    invocation.bump === "auto"
      ? autoBump(await loadFragments(project), project.config.kinds)
      : invocation.bump;
  const releases = knownReleases(await readChangelog(project));
  const version = nextVersion(releases, bump);
  console.log(formatVersion(version, project.config.versionPrefix));
}

/** Runs the command of an invocation. */
function runInvocation(invocation: Invocation): Promise<void> {
  switch (invocation.command) {
    case "init":
      return runInit(invocation);
    case "new":
      return runNew(invocation);
    case "check":
      return runCheck(invocation);
    case "batch":
      return runBatch(invocation);
    case "release":
      return runRelease(invocation);
    case "latest":
      return runLatest(invocation);
    case "next":
      return runNext(invocation);
    case "show":
      return runShow(invocation);
  }
}

function reportError(error: unknown): number {
  console.error(`wlz: ${errorMessage(error)}`);
  if (!(error instanceof UsageError)) return 1;

  console.error('Run "wlz --help" for usage.');
  return 2;
}

/** Runs the command line and returns the exit status. */
export async function main(argv: readonly string[]): Promise<number> {
  try {
    const commandLine = readCommandLine(argv);
    if (commandLine.action === "exit") return commandLine.status;
    await runInvocation(commandLine.invocation);
    return 0;
  } catch (error) {
    return reportError(error);
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
