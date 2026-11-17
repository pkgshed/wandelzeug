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
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import { version as WANDELZEUG_VERSION } from "../package.json" with { type: "json" };
import {
  type ChangelogDocument,
  knownReleases,
  readChangelog,
  type Release,
  releaseNotes,
} from "./changelog/markers.ts";
import {
  autoBump,
  BUMP_ARGUMENTS,
  type BumpArgument,
  isBumpArgument,
  nextVersion,
  parseReleaseTarget,
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
import { type NewChangeInput, readChangeOptions } from "./changes/options.ts";
import { askChange } from "./changes/questions.ts";
import {
  changedFragments,
  checkProject,
  type GitRef,
  parseGitRef,
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
import {
  compareVersions,
  formatVersion,
  type IsoDate,
  parseIsoDate,
  parseVersion,
  today,
} from "./shared/versions.ts";

const USAGE = `Usage: wlz <command> [options]
       wlz --version

Records changes as Markdown fragments with YAML front matter and adds them
to the changelog as releases.

Commands:
  init                    Set up .changes and the changelog
  new                     Record a change in the unreleased directory
  check                   Validate the unreleased changes and the changelog
  batch <version|bump>    Add the unreleased changes to the changelog
  release <bump>          Add the unreleased changes, commit, and tag the commit
  latest                  Print the latest released version
  next <bump>             Print the version that a bump yields
  show <version>          Print the notes of a release from the changelog

A bump is major, minor, patch or auto. "auto" picks the largest bump among
the kinds of the unreleased changes. Bumps start from the latest stable
release in the changelog.

The changelog holds a <!-- wlz:releases --> anchor. batch inserts each
release right below it, between BEGIN and END wlz:release markers, and
leaves every other line alone.

Options for every command:
  -C, --directory <dir>   Run as if started in <dir>
  -h, --help              Show this help

Options for init:
      --baseline <version>
                          The newest release from before wandelzeug, for an
                          existing changelog (default: the newest stable
                          version among its headings)
      --repository <url>  The web address of the repository for compare
                          links (default: from the origin remote)

Options for new:
  -k, --kind <kind>       Kind of change, such as Added
  -b, --body <markdown>   Change body, or "-" to read it from stdin
  -m, --meta <key=value>  Front matter entry, such as pr=42 (repeatable)
  -e, --edit              Write the change in $VISUAL or $EDITOR
  -r, --resume            Continue the draft that an earlier --edit kept

  When stdin is a terminal, new asks for whatever the options leave out:
  the kind, the body and each extra field. To leave an optional field
  empty without a question, pass --meta with an empty value, such as pr=.

  With --edit, the draft stays in .changes/.draft.md until the change is
  recorded, so --resume can reopen it after a problem.

Options for check:
      --since <ref>       Also require a change file that the commits since
                          HEAD forked from <ref> add or modify

Options for batch:
      --date <date>       Release date as YYYY-MM-DD (default: today)
      --keep              Keep the fragments after the release
  -n, --dry-run           Print the release instead of adding it

  batch and release also update the version numbers that the replacements
  in the configuration name, such as the one in package.json.

Options for release:
      --date <date>       Release date as YYYY-MM-DD (default: today)
  -n, --dry-run           Check the tag and print the release, but change
                          nothing

  release runs the tagHelper from the configuration, semverkzeug by default.
  It first checks that the helper arrives at the same version, then commits
  the changelog, the removed change files and the files of the
  replacements, and tags that commit with the release notes as the tag
  message.`;

const GLOBAL_OPTIONS = {
  directory: { type: "string", short: "C" },
} as const satisfies ParseArgsOptionsConfig;

const INIT_OPTIONS = {
  baseline: { type: "string" },
  repository: { type: "string" },
} as const satisfies ParseArgsOptionsConfig;

const NEW_OPTIONS = {
  kind: { type: "string", short: "k" },
  body: { type: "string", short: "b" },
  meta: { type: "string", short: "m", multiple: true },
  edit: { type: "boolean", short: "e" },
  resume: { type: "boolean", short: "r" },
} as const satisfies ParseArgsOptionsConfig;

const CHECK_OPTIONS = {
  since: { type: "string" },
} as const satisfies ParseArgsOptionsConfig;

const BATCH_OPTIONS = {
  date: { type: "string" },
  keep: { type: "boolean" },
  "dry-run": { type: "boolean", short: "n" },
} as const satisfies ParseArgsOptionsConfig;

const RELEASE_OPTIONS = {
  date: { type: "string" },
  "dry-run": { type: "boolean", short: "n" },
} as const satisfies ParseArgsOptionsConfig;

function parseCommand<const Options extends ParseArgsOptionsConfig>(
  args: string[],
  options: Options,
) {
  return parseArgs({
    args,
    options: { ...GLOBAL_OPTIONS, ...options },
    allowPositionals: true,
    strict: true,
  });
}

function expectNoPositionals(
  command: string,
  positionals: readonly string[],
): void {
  const [extra] = positionals;
  if (extra !== undefined) {
    throw new UsageError(
      `${command}: unexpected argument ${JSON.stringify(extra)}`,
    );
  }
}

function expectOnePositional(
  command: string,
  positionals: readonly string[],
  name: string,
): string {
  const [value, ...rest] = positionals;
  if (value === undefined) {
    throw new UsageError(`${command}: missing <${name}>`);
  }
  expectNoPositionals(command, rest);
  return value;
}

/** Parses the --date option. Without it, a release is dated today. */
function releaseDate(option: string | undefined): IsoDate {
  if (option === undefined) return today();
  const date = parseIsoDate(option);
  if (date === undefined) {
    throw new UsageError(
      `invalid --date ${JSON.stringify(option)}, expected YYYY-MM-DD`,
    );
  }
  return date;
}

/** Parses a version argument or option, such as the --baseline of init. */
function parseVersionOption(name: string, option: string): Release {
  const version = parseVersion(option);
  if (version === undefined) {
    throw new UsageError(
      `invalid ${name} ${JSON.stringify(option)}, expected a semantic version`,
    );
  }
  return { name: option, version };
}

function parseSinceOption(option: string | undefined): GitRef | undefined {
  if (option === undefined) return undefined;
  const ref = parseGitRef(option);
  if (ref === undefined) {
    throw new UsageError(
      `invalid --since ${JSON.stringify(option)}, expected a git revision`,
    );
  }
  return ref;
}

const formatInitResult = (result: InitResult): string => {
  const detail = result.detail === undefined ? "" : ` (${result.detail})`;
  return `${result.action} ${displayPath(result.path)}${detail}`;
};

/** Parses the --repository option of init, an http or https address. */
function parseRepositoryOption(option: string): string {
  const isWebAddress =
    URL.canParse(option) &&
    ["https:", "http:"].includes(new URL(option).protocol);
  if (!isWebAddress) {
    throw new UsageError(
      `invalid --repository ${JSON.stringify(option)}, expected an http or https address`,
    );
  }
  return option.replace(/\/+$/, "");
}

async function runInit(args: string[]): Promise<void> {
  const { values, positionals } = parseCommand(args, INIT_OPTIONS);
  expectNoPositionals("init", positionals);
  const baseline =
    values.baseline === undefined
      ? undefined
      : parseVersionOption("--baseline", values.baseline);
  const repositoryUrl =
    values.repository === undefined
      ? undefined
      : parseRepositoryOption(values.repository);
  const directory = resolve(values.directory ?? ".");
  const results = await initProject(directory, { baseline, repositoryUrl });
  results.forEach((result) => console.log(formatInitResult(result)));
}

/** The options of "wlz new", including how to write the change. */
type NewCommandInput = NewChangeInput & {
  readonly edit?: boolean | undefined;
  readonly resume?: boolean | undefined;
};

/** Rejects option combinations that "new" cannot honour. */
function rejectConflictingNewOptions(input: NewCommandInput): void {
  const usesEditor = input.edit === true || input.resume === true;
  if (usesEditor && input.body === "-") {
    throw new UsageError(
      "new: the editor needs the terminal, so --body cannot read stdin",
    );
  }

  const givesContent =
    input.kind !== undefined ||
    input.body !== undefined ||
    (input.meta?.length ?? 0) > 0;
  if (input.resume === true && givesContent) {
    throw new UsageError(
      "new --resume: the draft holds the change, so it takes no --kind, --body or --meta",
    );
  }
}

async function recordWithEditor(
  project: Project,
  input: NewCommandInput,
): Promise<string> {
  const editor = editorCommand();
  const path =
    input.resume === true
      ? await findKeptDraft(project)
      : await startDraft(
          project,
          await readChangeOptions(project.config.kinds, input),
        );
  return recordFromDraft(project, editor, path);
}

async function recordWithQuestions(
  project: Project,
  input: NewCommandInput,
): Promise<string> {
  const options = await readChangeOptions(project.config.kinds, input);
  const change = await askChange(project.config, options);
  return recordChange(project, change);
}

async function runNew(args: string[]): Promise<void> {
  const { values, positionals } = parseCommand(args, NEW_OPTIONS);
  expectNoPositionals("new", positionals);
  rejectConflictingNewOptions(values);

  const project = await openProject(values.directory ?? ".");
  const usesEditor = values.edit === true || values.resume === true;
  const path = usesEditor
    ? await recordWithEditor(project, values)
    : await recordWithQuestions(project, values);
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

async function runCheck(args: string[]): Promise<void> {
  const { values, positionals } = parseCommand(args, CHECK_OPTIONS);
  expectNoPositionals("check", positionals);
  const since = parseSinceOption(values.since);
  const project = await openProject(values.directory ?? ".");

  const report = await checkProject(project);
  const failures = [
    ...report.problems.map(
      (problem) => `${displayPath(problem.path)}: ${problem.message}`,
    ),
    ...(await sinceFailures(project, since)),
  ];
  if (failures.length > 0) {
    failures.forEach((failure) => console.error(failure));
    throw new Error(`check: ${countOf(failures.length, "problem")}`);
  }
  console.log(`checked ${countOf(report.checked, "change")}`);
}

async function runBatch(args: string[]): Promise<void> {
  const { values, positionals } = parseCommand(args, BATCH_OPTIONS);
  const target = parseReleaseTarget(
    expectOnePositional("batch", positionals, "version"),
  );
  const date = releaseDate(values.date);
  const project = await openProject(values.directory ?? ".");
  const plan = await planRelease(project, target, date);
  if (values["dry-run"]) {
    const link = plan.link === undefined ? "" : `\n${plan.link}\n`;
    process.stdout.write(`${plan.section}\n${link}`);
    return;
  }

  await writeRelease(plan);
  if (!values.keep) {
    await removeFragments(plan.fragments);
  }
  const changes = countOf(plan.fragments.length, "change");
  console.log(`updated ${displayPath(plan.path)} from ${changes}`);
  plan.updates.forEach((update) =>
    console.log(`updated ${displayPath(update.path)}`),
  );
}

async function runLatest(args: string[]): Promise<void> {
  const { values, positionals } = parseCommand(args, {});
  expectNoPositionals("latest", positionals);
  const project = await openProject(values.directory ?? ".");
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

/** Parses the bump of release, which tags through the helper and so takes no explicit version. */
function parseReleaseBump(argument: string): BumpArgument {
  if (!isBumpArgument(argument)) {
    const bumps = BUMP_ARGUMENTS.join(", ");
    throw new UsageError(
      `release: invalid bump ${JSON.stringify(argument)}, expected one of: ${bumps}`,
    );
  }
  return argument;
}

async function runRelease(args: string[]): Promise<void> {
  const { values, positionals } = parseCommand(args, RELEASE_OPTIONS);
  const bump = parseReleaseBump(
    expectOnePositional("release", positionals, "bump"),
  );
  const date = releaseDate(values.date);
  const project = await openProject(values.directory ?? ".");
  const plan = await planRelease(project, { type: "bump", bump }, date);
  const part =
    bump === "auto" ? autoBump(plan.fragments, project.config.kinds) : bump;

  if (values["dry-run"]) {
    await checkTag(project, part, plan);
    const link = plan.link === undefined ? "" : `\n${plan.link}\n`;
    process.stdout.write(`${plan.section}\n${link}`);
    return;
  }

  const result = await releaseAndTag(project, part, plan);
  console.log(`released ${result.name} in commit ${result.commit}`);
}

async function runShow(args: string[]): Promise<void> {
  const { values, positionals } = parseCommand(args, {});
  const argument = expectOnePositional("show", positionals, "version");
  const release = parseVersionOption("version", argument);
  const project = await openProject(values.directory ?? ".");
  const document = await readChangelog(project);

  const notes = releaseNotes(document, release.version);
  if (notes === undefined) {
    throw new Error(missingNotesMessage(project, document, release));
  }
  process.stdout.write(notes);
}

async function runNext(args: string[]): Promise<void> {
  const { values, positionals } = parseCommand(args, {});
  const argument = expectOnePositional("next", positionals, "bump");
  if (!isBumpArgument(argument)) {
    const bumps = BUMP_ARGUMENTS.join(", ");
    throw new UsageError(
      `next: invalid bump ${JSON.stringify(argument)}, expected one of: ${bumps}`,
    );
  }

  const project = await openProject(values.directory ?? ".");
  const bump =
    argument === "auto"
      ? autoBump(await loadFragments(project), project.config.kinds)
      : argument;
  const releases = knownReleases(await readChangelog(project));
  const version = nextVersion(releases, bump);
  console.log(formatVersion(version, project.config.versionPrefix));
}

type CommandRunner = (args: string[]) => Promise<void>;

const COMMANDS = new Map<string, CommandRunner>([
  ["init", runInit],
  ["new", runNew],
  ["check", runCheck],
  ["batch", runBatch],
  ["latest", runLatest],
  ["next", runNext],
  ["show", runShow],
  ["release", runRelease],
]);

/** Reports whether the arguments ask for help before any "--" terminator. */
function wantsHelp(argv: readonly string[]): boolean {
  const terminator = argv.indexOf("--");
  const options = terminator === -1 ? argv : argv.slice(0, terminator);
  return options.some((arg) => arg === "-h" || arg === "--help");
}

const isParseArgsError = (error: unknown): boolean =>
  error instanceof Error &&
  String((error as NodeJS.ErrnoException).code).startsWith("ERR_PARSE_ARGS");

function reportError(error: unknown): number {
  console.error(`wlz: ${errorMessage(error)}`);
  const isUsageError = error instanceof UsageError || isParseArgsError(error);
  if (!isUsageError) return 1;

  console.error('Run "wlz --help" for usage.');
  return 2;
}

/** Runs the command line and returns the exit status. */
export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...args] = argv;
  if (command === undefined) {
    console.error(USAGE);
    return 2;
  }
  if (command === "help" || wantsHelp(argv)) {
    console.log(USAGE);
    return 0;
  }
  if (command === "--version") {
    console.log(WANDELZEUG_VERSION);
    return 0;
  }

  const run = COMMANDS.get(command);
  if (run === undefined) {
    return reportError(
      new UsageError(`unknown command ${JSON.stringify(command)}`),
    );
  }

  try {
    await run(args);
    return 0;
  } catch (error) {
    return reportError(error);
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
