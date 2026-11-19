/**
 * The command line grammar of wlz: its commands, their options and
 * arguments, and the help text. Optique parses the arguments into a typed
 * invocation and prints help and version output. Together with values.ts,
 * this directory is the only place that imports Optique.
 */

import { merge, object, or } from "@optique/core/constructs";
import { runParserSync } from "@optique/core/facade";
import {
  commandLine,
  formatMessage,
  type Message,
  message,
  optionName,
} from "@optique/core/message";
import { map, multiple, optional, withDefault } from "@optique/core/modifiers";
import type { InferValue } from "@optique/core/parser";
import {
  argument,
  command,
  constant,
  flag,
  option,
} from "@optique/core/primitives";
import type { OptionName } from "@optique/core/usage";
import { string } from "@optique/core/valueparser";
import { version as WANDELZEUG_VERSION } from "../../package.json" with { type: "json" };
import { UsageError } from "../shared/foundations.ts";
import { HELP_THEME } from "./theme.ts";
import {
  bumpValue,
  directoryValue,
  gitRefValue,
  isoDateValue,
  metaEntryValue,
  releaseTargetValue,
  releaseValue,
  repositoryUrlValue,
} from "./values.ts";

// --- Options that several commands share ------------------------------------

/** The options that every command takes. */
const COMMON_OPTIONS = {
  directory: optional(
    option("-C", "--directory", directoryValue, {
      description: message`Run as if started in DIR`,
    }),
  ),
};

const dateOption = optional(
  option("--date", isoDateValue, {
    description: message`Release date as YYYY-MM-DD (default: today)`,
  }),
);

/** A flag that is false unless given. */
const switchFlag = (
  names: readonly [OptionName, ...OptionName[]],
  description: Message,
) => withDefault(flag(...names, { description }), false);

const dryRunFlag = (description: Message) =>
  switchFlag(["-n", "--dry-run"], description);

/** How bumps work, for the commands that take one. */
const BUMP_EXPLANATION = message`A bump starts from the latest stable release in the changelog, or from the baseline, and skips prereleases. While that release is 0.y.z, the bumpStrategy setting adjusts the bump of auto.`;

const bumpArgument = argument(bumpValue, {
  description: message`major, minor, patch, or auto for the largest bump among the kinds of the unreleased changes`,
});

// --- Commands ---------------------------------------------------------------

const initCommand = command(
  "init",
  object({
    command: constant("init"),
    baseline: optional(
      option("--baseline", releaseValue, {
        description: message`The newest release from before wandelzeug, for an existing changelog (default: the newest stable version among its headings)`,
      }),
    ),
    repository: optional(
      option("--repository", repositoryUrlValue, {
        description: message`The web address of the repository for compare links (default: from the origin remote)`,
      }),
    ),
    import: switchFlag(
      ["--import"],
      message`Also give the releases of an existing changelog data blocks, as ${commandLine("wlz import")} does`,
    ),
    ...COMMON_OPTIONS,
  }),
  {
    brief: message`Set up .changes and the changelog`,
    description: message`Creates .changes/config.yaml, the unreleased directory, and a changelog with the release anchor. For an existing changelog, it adds the anchor below the header instead. With ${optionName("--import")}, the import picks the baseline, so ${optionName("--baseline")} does not go with it.`,
  },
);

const importCommand = command(
  "import",
  object({
    command: constant("import"),
    ...COMMON_OPTIONS,
  }),
  {
    brief: message`Give data blocks to releases without one`,
    description: message`Gives a data block to each marked release without one, and to the releases from before wandelzeug, so that ${commandLine("wlz render")} can render them. A release fits when its heading names the version and a date, and the headings below it name configured kinds with lists of changes. The notes stay as they are. The import stops at the first release that does not fit and explains why. Such a release from before wandelzeug becomes the baseline. Link definitions of imported releases move inside the wlz:links markers.`,
  },
);

/** The options of "new" that give the content of the change. */
const changeOptions = {
  kind: optional(
    option("-k", "--kind", string({ metavar: "KIND" }), {
      description: message`Kind of change, such as Added`,
    }),
  ),
  body: optional(
    option("-b", "--body", string({ metavar: "MARKDOWN" }), {
      description: message`Change body, or "-" to read it from stdin`,
    }),
  ),
  meta: multiple(
    option("-m", "--meta", metaEntryValue, {
      description: message`Front matter entry, such as pr=42 (repeatable)`,
    }),
  ),
  breaking: optional(
    or(
      map(
        flag("--breaking", {
          description: message`Mark the change as breaking`,
        }),
        () => true,
      ),
      map(
        flag("--no-breaking", {
          description: message`Mark the change as not breaking, without a question`,
        }),
        () => false,
      ),
    ),
  ),
};

/** "new --resume" reopens a kept draft, which holds the whole change already, so it takes no content options. */
const resumeMode = object({
  command: constant("new"),
  mode: constant("resume"),
  resume: flag("-r", "--resume", {
    description: message`Continue the draft that an earlier ${optionName("--edit")} kept`,
  }),
});

/** "new --empty" records an empty change, which takes no content options either. */
const emptyMode = object({
  command: constant("new"),
  mode: constant("empty"),
  empty: flag("--empty", {
    description: message`Record that the branch has no notable change, so ${commandLine("wlz check --since")} passes`,
  }),
  reason: optional(
    option("--reason", string({ metavar: "TEXT" }), {
      description: message`Why the change is not notable, which the changelog never shows`,
    }),
  ),
});

const writeMode = object({
  command: constant("new"),
  mode: constant("write"),
  edit: switchFlag(
    ["-e", "--edit"],
    message`Write the change in $VISUAL or $EDITOR`,
  ),
  ...changeOptions,
});

/**
 * A bare "wlz new", which writes a change and asks for all of it. or()
 * only picks a branch after it reads an option of that branch, so without
 * one it needs this default. The common options sit outside or() for the
 * same reason, so "wlz new -C DIR" alone also writes a change.
 */
const BARE_NEW: InferValue<typeof writeMode> = {
  command: "new",
  mode: "write",
  edit: false,
  kind: undefined,
  body: undefined,
  meta: [],
  breaking: undefined,
};

/** "new" resumes a kept draft, records an empty change, or writes a new change. */
const newCommand = command(
  "new",
  merge(
    withDefault(or(resumeMode, emptyMode, writeMode), BARE_NEW),
    object(COMMON_OPTIONS),
  ),
  {
    brief: message`Record a change in the unreleased directory`,
    description: message`When stdin is a terminal, new asks for whatever the options leave out: the kind, or no notable change for an empty change, the body, whether the change breaks when its kind has breaking: ask, and each extra field. Without a terminal, such a kind needs ${optionName("--breaking")} or ${optionName("--no-breaking")}. To leave an optional field empty without a question, pass ${optionName("--meta")} with an empty value, such as pr=. With ${optionName("--edit")}, the draft stays in .changes/.draft.md until the change is recorded, so ${optionName("--resume")} can reopen it after a problem.`,
  },
);

const checkCommand = command(
  "check",
  object({
    command: constant("check"),
    since: optional(
      option("--since", gitRefValue, {
        description: message`Also require a change file that the commits since HEAD forked from REF add or modify`,
      }),
    ),
    ...COMMON_OPTIONS,
  }),
  {
    brief: message`Validate the unreleased changes and the changelog`,
    description: message`Checks every unreleased change against the configured kinds and extra fields, and the markers in the changelog.`,
  },
);

const batchCommand = command(
  "batch",
  object({
    command: constant("batch"),
    target: argument(releaseTargetValue, {
      description: message`A semantic version, or a bump: major, minor, patch, or auto`,
    }),
    date: dateOption,
    keep: switchFlag(
      ["--keep"],
      message`Keep the change files after the release`,
    ),
    dryRun: dryRunFlag(message`Print the release instead of adding it`),
    ...COMMON_OPTIONS,
  }),
  {
    brief: message`Add the unreleased changes to the changelog`,
    description: message`Inserts the release right below the <!-- wlz:releases --> anchor, between BEGIN and END wlz:release markers, and leaves every other line alone. It also updates the version numbers that the replacements in the configuration name, such as the one in package.json. ${BUMP_EXPLANATION}`,
  },
);

const releaseCommand = command(
  "release",
  object({
    command: constant("release"),
    bump: bumpArgument,
    date: dateOption,
    dryRun: dryRunFlag(
      message`Check the tag and print the release, but change nothing`,
    ),
    ...COMMON_OPTIONS,
  }),
  {
    brief: message`Add the unreleased changes, commit, and tag the commit`,
    description: message`Tags through the tagHelper commands from the configuration, git tag by default. It first checks that the files of the release hold no uncommitted changes, that the tag is new, and whatever the check command of the tagHelper checks. Then it commits the changelog, the removed change files, and the files of the replacements, and tags that commit with the plain text message that the tagTemplate setting renders. ${BUMP_EXPLANATION}`,
  },
);

const renderCommand = command(
  "render",
  object({
    command: constant("render"),
    force: switchFlag(
      ["--force"],
      message`Also render releases whose notes were edited by hand, which drops those edits`,
    ),
    dryRun: dryRunFlag(message`Print the changelog instead of writing it`),
    ...COMMON_OPTIONS,
  }),
  {
    brief: message`Render the releases in the changelog again`,
    description: message`Renders every release from its data block with the current templates and configuration, and the link definitions when every release has a data block. A release whose notes were edited by hand stops the command, unless you pass ${optionName("--force")}. Releases without a data block stay as they are.`,
  },
);

const latestCommand = command(
  "latest",
  object({
    command: constant("latest"),
    ...COMMON_OPTIONS,
  }),
  { brief: message`Print the latest released version` },
);

const nextCommand = command(
  "next",
  object({
    command: constant("next"),
    bump: bumpArgument,
    ...COMMON_OPTIONS,
  }),
  {
    brief: message`Print the version that a bump yields`,
    description: BUMP_EXPLANATION,
  },
);

const showCommand = command(
  "show",
  object({
    command: constant("show"),
    release: argument(releaseValue, {
      description: message`The version of a release in the changelog`,
    }),
    ...COMMON_OPTIONS,
  }),
  { brief: message`Print the notes of a release from the changelog` },
);

const offboardCommand = command(
  "offboard",
  object({
    command: constant("offboard"),
    stripMarkers: switchFlag(
      ["--strip-markers"],
      message`Also remove the wlz markers and data blocks from the changelog`,
    ),
    force: switchFlag(
      ["--force"],
      message`Also delete unreleased changes and a kept draft`,
    ),
    dryRun: dryRunFlag(
      message`List what offboard would do, and change nothing`,
    ),
    ...COMMON_OPTIONS,
  }),
  {
    brief: message`Remove wandelzeug from the project`,
    description: message`Deletes the .changes directory with the configuration and the unreleased directory, and commits nothing. The changelog keeps its notes and link definitions. Its markers and data blocks stay too, unless you pass ${optionName("--strip-markers")}. Unreleased changes or a kept draft stop the command, unless you pass ${optionName("--force")}, so release them first to keep them.`,
  },
);

const WLZ = or(
  initCommand,
  newCommand,
  checkCommand,
  batchCommand,
  releaseCommand,
  renderCommand,
  importCommand,
  latestCommand,
  nextCommand,
  showCommand,
  offboardCommand,
  { errors: { noMatch: message`missing command` } },
);

// --- Reading the command line -----------------------------------------------

/** A command with its options and arguments, as the grammar parsed them. */
export type Invocation = InferValue<typeof WLZ>;

/** The invocation of one command, such as "new". */
export type InvocationOf<Name extends Invocation["command"]> = Extract<
  Invocation,
  { command: Name }
>;

/** What the command line asks for: a command to run, or an exit after help or version output. */
export type CommandLine =
  | { readonly action: "run"; readonly invocation: Invocation }
  | { readonly action: "exit"; readonly status: number };

/**
 * Unwinds the parser after it printed help or version output. Optique
 * hands over the exit status in a callback, and only a throw keeps it from
 * returning a value of the wrong type.
 */
class ShownOutput {
  constructor(readonly status: number) {}
}

const showOutput = (status: number): never => {
  throw new ShownOutput(status);
};

/**
 * Turns a parse failure into a usage error, which the entry point reports.
 * The message stays plain text: Bun prints console.error output in red on
 * a terminal, and the resets of Optique's colours would cut that red short.
 */
const rejectUsage = (_status: number, error: Message): never => {
  throw new UsageError(formatMessage(error));
};

const HELP_BRIEF = message`Records changes as Markdown files with YAML front matter and adds them to the changelog as releases.`;

/** Shown on the top-level help page only. Commands have descriptions of their own. */
const HELP_DESCRIPTION = message`Run ${commandLine("wlz COMMAND --help")} for the options and arguments of a command.`;

/** How readCommandLine prints help output. */
export type HelpOutput = {
  /** Whether the help on stdout may carry the colours of the help theme. */
  readonly colors: boolean;
};

/**
 * Parses the arguments of wlz. Help and version requests print their
 * output and yield an exit. Invalid arguments throw a UsageError.
 */
export function readCommandLine(
  argv: readonly string[],
  output: HelpOutput,
): CommandLine {
  try {
    const invocation = runParserSync(WLZ, "wlz", argv, {
      colors: output.colors,
      theme: HELP_THEME,
      brief: HELP_BRIEF,
      description: HELP_DESCRIPTION,
      usageLine: [
        { type: "argument", metavar: "COMMAND" },
        { type: "optional", terms: [{ type: "argument", metavar: "OPTIONS" }] },
      ],
      maxWidth: 80,
      help: {
        command: true,
        option: { names: ["-h", "--help"] },
        onShow: showOutput,
      },
      version: {
        option: true,
        value: WANDELZEUG_VERSION,
        onShow: showOutput,
      },
      completion: {
        command: true,
        onShow: showOutput,
      },
      aboveError: "none",
      // The UsageError from onError carries the message instead.
      stderr: () => {},
      onError: rejectUsage,
    });
    return { action: "run", invocation };
  } catch (error) {
    if (error instanceof ShownOutput) {
      return { action: "exit", status: error.status };
    }
    throw error;
  }
}
