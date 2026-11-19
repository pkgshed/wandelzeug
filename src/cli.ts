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
 * Unreleased changes live in .changes/unreleased/nnn-<id>-<name>.md. The
 * number nnn orders the changes, the random <id> keeps the files of
 * parallel branches apart, and <name> comes from the fragmentName template.
 *
 * The changelog itself is the record of released versions. "wlz batch"
 * inserts each release below a <!-- wlz:releases --> anchor and wraps
 * it in <!-- BEGIN wlz:release VERSION --> and END markers. Everything
 * outside the markers belongs to the project and stays untouched.
 *
 * Run "wlz --help" for the command reference.
 */

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type ChangelogDocument,
  knownReleases,
  readChangelog,
  type Release,
  releaseNotes,
} from "./changelog/markers.ts";
import {
  autoReleaseBump,
  nextVersion,
  planRelease,
  removeChangeFiles,
  writeRelease,
} from "./changelog/releases.ts";
import {
  type ImportPlan,
  type ImportStop,
  planImport,
} from "./changelog/import.ts";
import { usedDefinitions, withDefinitions } from "./changelog/notes.ts";
import { planRender, type RenderPlan } from "./changelog/render.ts";
import {
  editorCommand,
  findKeptDraft,
  recordFromDraft,
  startDraft,
} from "./changes/drafts.ts";
import { loadUnreleased, recordChangeFile } from "./changes/fragments.ts";
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
import {
  applyOffboarding,
  type ChangelogOutcome,
  describePendingWork,
  type OffboardPlan,
  planOffboarding,
  refusePendingWork,
} from "./project/offboard.ts";
import { checkRelease, releaseAndTag } from "./project/release.ts";
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
import { supportsColor } from "./shared/terminal.ts";
import { compareVersions, formatVersion, today } from "./shared/versions.ts";

/** Opens the project at or above the directory that -C names, or the working directory. */
const openInvocationProject = (invocation: Invocation): Promise<Project> =>
  openProject(invocation.directory ?? ".");

const formatInitResult = (result: InitResult): string => {
  const detail = result.detail === undefined ? "" : ` (${result.detail})`;
  return `${result.action} ${displayPath(result.path)}${detail}`;
};

/** Describes why the import stopped, what that means, and what to do. */
function describeStop(plan: ImportPlan, stop: ImportStop): string[] {
  const { name } = stop.release;
  const outcome = stop.legacy
    ? `${name} ${plan.baseline.before?.name === name ? "remains" : "is now"} the baseline, and it and the releases below it stay as they are`
    : `${name} keeps its notes without a data block, and the releases below it stay as they are`;
  return [
    `stopped at release ${name} on line ${stop.line + 1}: ${stop.reason}`,
    outcome,
    'to import them too, change what stopped the import and run "wlz import" again',
  ];
}

/** Describes what an import did, line by line. */
function describeImport(plan: ImportPlan): string[] {
  const names = plan.converted.map((release) => release.name).join(", ");
  const converted =
    plan.converted.length === 0
      ? []
      : [`imported ${countOf(plan.converted.length, "release")}: ${names}`];
  const moved =
    plan.movedLinks === 0
      ? []
      : [
          `moved ${countOf(plan.movedLinks, "link definition")} inside the wlz:links markers`,
        ];
  const unmoved =
    plan.unmovedLinks === 0
      ? []
      : [
          `left ${countOf(plan.unmovedLinks, "link definition")} in place, because the changelog lacks the wlz:links markers`,
        ];
  const removedBaseline =
    plan.baseline.before !== undefined && plan.baseline.after === undefined
      ? ["removed the baseline, because every release has a data block now"]
      : [];
  const stop = plan.stop === undefined ? [] : describeStop(plan, plan.stop);
  const lines = [
    ...converted,
    ...moved,
    ...unmoved,
    ...removedBaseline,
    ...stop,
  ];
  return lines.length === 0
    ? ["found no releases without a data block"]
    : lines;
}

/** Gives data blocks to the releases of a project that lack one, and reports what happened. */
async function importReleases(project: Project): Promise<void> {
  if (!project.config.releaseData) {
    throw new Error(
      "import: releaseData is off in .changes/config.yaml, turn it on to give releases data blocks",
    );
  }
  const document = await readChangelog(project);
  const plan = planImport(document, project.config.kinds);
  if (plan.content !== document.lines.join(document.newline)) {
    await writeFile(changelogPath(project), plan.content);
  }
  describeImport(plan).forEach((line) => console.log(line));
}

/** Rejects --baseline next to --import, which picks the baseline itself. */
function rejectBaselineWithImport(invocation: InvocationOf<"init">): void {
  if (invocation.import && invocation.baseline !== undefined) {
    throw new UsageError(
      "init: --import picks the baseline itself, so it takes no --baseline",
    );
  }
}

async function runInit(invocation: InvocationOf<"init">): Promise<void> {
  rejectBaselineWithImport(invocation);
  const directory = resolve(invocation.directory ?? ".");
  const results = await initProject(directory, {
    baseline: invocation.baseline,
    repositoryUrl: invocation.repository,
  });
  results.forEach((result) => console.log(formatInitResult(result)));
  if (invocation.import) {
    await importReleases(await openProject(directory));
  }
}

async function runImport(invocation: InvocationOf<"import">): Promise<void> {
  await importReleases(await openInvocationProject(invocation));
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
  return recordChangeFile(project, await askChange(project.config, options));
}

/** The invocation of "new" that records an empty change. */
type EmptyInvocation = Extract<InvocationOf<"new">, { mode: "empty" }>;

function recordEmptyChange(
  project: Project,
  invocation: EmptyInvocation,
): Promise<string> {
  const reason = invocation.reason?.trim() ?? "";
  return recordChangeFile(project, {
    type: "empty",
    reason: reason === "" ? undefined : reason,
  });
}

/** Records the change that the invocation describes and returns the path of its file. */
function recordNewChange(
  project: Project,
  invocation: InvocationOf<"new">,
): Promise<string> {
  if (invocation.mode === "resume") return resumeDraft(project);
  if (invocation.mode === "empty")
    return recordEmptyChange(project, invocation);
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
  const empty =
    report.emptyChanges === 0
      ? ""
      : ` and ${countOf(report.emptyChanges, "empty change")}`;
  console.log(`checked ${countOf(report.changes, "change")}${empty}`);
}

async function runBatch(invocation: InvocationOf<"batch">): Promise<void> {
  const project = await openInvocationProject(invocation);
  const date = invocation.date ?? today();
  const plan = await planRelease(project, invocation.target, date);
  if (invocation.dryRun) {
    const links = plan.links.length === 0 ? "" : `\n${plan.links.join("\n")}\n`;
    process.stdout.write(`${plan.section}\n${links}`);
    return;
  }

  await writeRelease(plan);
  if (!invocation.keep) {
    await removeChangeFiles(plan);
  }
  const changes = countOf(plan.fragments.length, "change");
  console.log(`updated ${displayPath(plan.path)} from ${changes}`);
  if (!invocation.keep && plan.emptyChanges.length > 0) {
    console.log(`removed ${countOf(plan.emptyChanges.length, "empty change")}`);
  }
  plan.updates.forEach((update) =>
    console.log(`updated ${displayPath(update.path)}`),
  );
}

/** Describes what render left as it was, if anything. */
function keptDescription(plan: RenderPlan): string | undefined {
  switch (plan.keptLinks) {
    case undefined:
      return undefined;
    case "release without data": {
      const releases = countOf(plan.withoutData, "release");
      return `kept ${releases} without a data block and the link definitions as they are`;
    }
    case "empty repositoryUrl":
      return "kept the link definitions as they are, because repositoryUrl is empty";
  }
}

async function runRender(invocation: InvocationOf<"render">): Promise<void> {
  const project = await openInvocationProject(invocation);
  const plan = await planRender(project, { force: invocation.force });
  if (invocation.dryRun) {
    process.stdout.write(plan.content);
    return;
  }

  await writeFile(plan.path, plan.content);
  const releases = countOf(plan.rendered, "release");
  console.log(`rendered ${releases} in ${displayPath(plan.path)}`);
  const kept = keptDescription(plan);
  if (kept !== undefined) console.log(kept);
}

/** The words for what offboard does: done, or planned with --dry-run. */
type OffboardWording = {
  readonly remove: string;
  readonly update: string;
  readonly keep: string;
  /** The verb inside the details of an update. */
  readonly removeDetail: string;
};

const OFFBOARD_DONE: OffboardWording = {
  remove: "removed",
  update: "updated",
  keep: "kept",
  removeDetail: "removed",
};

const OFFBOARD_PLANNED: OffboardWording = {
  remove: "would remove",
  update: "would update",
  keep: "would keep",
  removeDetail: "remove",
};

function describeChangelogOutcome(
  outcome: ChangelogOutcome,
  words: OffboardWording,
): string[] {
  switch (outcome.action) {
    case "none":
      return [];
    case "keep markers":
      return [
        `${words.keep} the markers in ${displayPath(outcome.path)}, which --strip-markers removes`,
      ];
    case "strip": {
      const markers = countOf(outcome.stripped.markers, "marker");
      const dataBlocks = countOf(outcome.stripped.dataBlocks, "data block");
      return [
        `${words.update} ${displayPath(outcome.path)} (${words.removeDetail} ${markers} and ${dataBlocks})`,
      ];
    }
  }
}

/** Describes an off-boarding, one line for each file or directory. */
function describeOffboarding(
  plan: OffboardPlan,
  words: OffboardWording,
): string[] {
  const pending = describePendingWork(plan.pending);
  const withPending = pending === undefined ? "" : ` with ${pending}`;
  const changes = displayPath(plan.changesPath);
  const outside =
    plan.outsideUnreleased === undefined
      ? []
      : [
          `${words.keep} ${displayPath(plan.outsideUnreleased)}, the unreleased directory outside ${changes}`,
        ];
  return [
    ...describeChangelogOutcome(plan.changelog, words),
    `${words.remove} ${changes}${withPending}`,
    ...outside,
  ];
}

async function runOffboard(
  invocation: InvocationOf<"offboard">,
): Promise<void> {
  const project = await openInvocationProject(invocation);
  const plan = await planOffboarding(project, {
    stripMarkers: invocation.stripMarkers,
  });
  if (!invocation.force) refusePendingWork(plan);
  if (invocation.dryRun) {
    describeOffboarding(plan, OFFBOARD_PLANNED).forEach((line) =>
      console.log(line),
    );
    return;
  }

  await applyOffboarding(plan);
  describeOffboarding(plan, OFFBOARD_DONE).forEach((line) => console.log(line));
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
  const target = { type: "bump", bump: invocation.bump } as const;
  const plan = await planRelease(project, target, date);

  if (invocation.dryRun) {
    await checkRelease(project, plan);
    const links = plan.links.length === 0 ? "" : `\n${plan.links.join("\n")}\n`;
    process.stdout.write(`${plan.section}\n${links}`);
    return;
  }

  const result = await releaseAndTag(project, plan);
  console.log(`released ${result.name} in commit ${result.commit}`);
}

async function runShow(invocation: InvocationOf<"show">): Promise<void> {
  const project = await openInvocationProject(invocation);
  const document = await readChangelog(project);
  const notes = releaseNotes(document, invocation.release.version);
  if (notes === undefined) {
    throw new Error(missingNotesMessage(project, document, invocation.release));
  }
  const definitions = usedDefinitions(project, document, notes);
  process.stdout.write(`${withDefinitions(notes, definitions).trimEnd()}\n`);
}

async function runNext(invocation: InvocationOf<"next">): Promise<void> {
  const project = await openInvocationProject(invocation);
  const releases = knownReleases(await readChangelog(project));
  const bump =
    invocation.bump === "auto"
      ? autoReleaseBump(
          releases,
          (await loadUnreleased(project)).fragments,
          project.config,
        )
      : invocation.bump;
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
    case "render":
      return runRender(invocation);
    case "offboard":
      return runOffboard(invocation);
    case "import":
      return runImport(invocation);
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
    const commandLine = readCommandLine(argv, {
      colors: supportsColor(process.stdout.isTTY === true, process.env),
    });
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
