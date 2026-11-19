/**
 * Drafts that "wlz new --edit" opens in the editor and keeps until
 * the change is recorded.
 */

import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { Config, ExtraField } from "../project/config.ts";
import { draftPath, type Project } from "../project/root.ts";
import {
  attempt,
  displayPath,
  errorMessage,
  UsageError,
  writeNewFile,
} from "../shared/foundations.ts";
import { applyExtraFields } from "./fields.ts";
import {
  type Change,
  isBlankBody,
  parseChange,
  recordChange,
  splitFrontMatter,
  yamlEntry,
} from "./fragments.ts";
import { type ChangeOptions, isInteractive } from "./options.ts";
import { askYesNo } from "./prompts.ts";

/** Describes what a field accepts, for the comment in a draft. */
function describeField(field: ExtraField): string {
  const necessity = field.required ? "required" : "optional";
  switch (field.type) {
    case "string":
    case "int":
      return `${field.type}, ${necessity}`;
    case "block":
      return `block, ${necessity}, write "|" and indent the lines`;
    case "enum":
      return `one of ${field.enumOptions.join(", ")}, ${necessity}`;
    case "enums":
      return `any of ${field.enumOptions.join(", ")}, comma-separated, ${necessity}`;
  }
}

/** Renders an empty field whose YAML comment says what to fill in. */
const fieldPlaceholder = (field: ExtraField): string =>
  `${field.key}: # ${field.prompt} (${describeField(field)})`;

/**
 * The "breaking" line of a draft: the answer of --breaking or
 * --no-breaking, or else an empty entry with a hint when the kind of the
 * change, or any kind while the kind is open, asks for one.
 */
function breakingLines(config: Config, options: ChangeOptions): string[] {
  if (options.breaking !== undefined) {
    return [yamlEntry("breaking", options.breaking)];
  }
  const hint = "breaking: # true if the change breaks compatibility";
  if (options.kind !== undefined) {
    return options.kind.breaking === "ask" ? [hint] : [];
  }
  const asking = config.kinds.filter((kind) => kind.breaking === "ask");
  if (asking.length === 0) return [];
  return [`${hint} (${asking.map((kind) => kind.label).join(", ")})`];
}

/** Renders the draft that "new --edit" opens, filled in from the options. */
export function renderDraft(config: Config, options: ChangeOptions): string {
  const kinds = config.kinds.map((kind) => kind.label).join(", ");
  const kindLine =
    options.kind === undefined
      ? "kind:"
      : yamlEntry("kind", options.kind.label);
  const missingFields = config.extraFields.filter(
    (field) => options.metadata[field.key] === undefined,
  );
  const lines = [
    "---",
    `# Kinds: ${kinds}`,
    "# Leave the body empty to cancel the change.",
    kindLine,
    ...breakingLines(config, options),
    ...Object.entries(options.metadata).map(([key, value]) =>
      yamlEntry(key, value),
    ),
    ...missingFields.map(fieldPlaceholder),
    "---",
    options.body?.trim() ?? "* ",
  ];
  return lines.join("\n") + "\n";
}

/** What an edited draft holds. */
export type DraftOutcome =
  | { readonly status: "valid"; readonly change: Change }
  | { readonly status: "empty" }
  | { readonly status: "invalid"; readonly problems: readonly string[] };

function isEmptyDraft(text: string): boolean {
  if (text.trim() === "") return true;
  const document = attempt(() => splitFrontMatter(text));
  return document.ok && isBlankBody(document.value.body);
}

/** Reads an edited draft. A draft without body text cancels the change. */
export function interpretDraft(config: Config, text: string): DraftOutcome {
  if (isEmptyDraft(text)) {
    return { status: "empty" };
  }

  const parsed = attempt(() => parseChange(text, config.kinds));
  if (!parsed.ok) {
    return { status: "invalid", problems: [parsed.error] };
  }

  const fields = applyExtraFields(config.extraFields, parsed.value.metadata);
  if (fields.problems.length > 0) {
    return { status: "invalid", problems: fields.problems };
  }
  return {
    status: "valid",
    change: { ...parsed.value, metadata: fields.metadata },
  };
}

/** Picks the editor from VISUAL, then EDITOR. Like git, it treats an empty variable as unset. */
export function editorCommand(): string {
  const editor = [process.env.VISUAL, process.env.EDITOR].find(
    (value) => value !== undefined && value.trim() !== "",
  );
  if (editor === undefined) {
    throw new Error("new: set VISUAL or EDITOR to choose an editor");
  }
  return editor;
}

/**
 * Opens a file in the editor and waits for it to close. Like git, it runs the
 * editor through the shell, so the variable may carry arguments, such as
 * "code --wait".
 */
async function runEditor(editor: string, path: string): Promise<void> {
  const child = Bun.spawn(["sh", "-c", `${editor} "$@"`, editor, path], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await child.exited;
  if (status !== 0) {
    throw new Error(
      `run editor ${JSON.stringify(editor)}: exit status ${status}`,
    );
  }
}

/** Asks whether to reopen a draft with problems. Without a terminal, the answer is no. */
const askToEditAgain = async (): Promise<boolean> =>
  isInteractive() && (await askYesNo("Edit the change again?"));

/** Opens the draft until it holds a valid change, the user cancels, or gives up. */
async function editDraft(
  config: Config,
  editor: string,
  path: string,
): Promise<DraftOutcome> {
  for (;;) {
    await runEditor(editor, path);
    const outcome = interpretDraft(config, await readFile(path, "utf8"));
    if (outcome.status !== "invalid") return outcome;

    outcome.problems.forEach((problem) => console.error(problem));
    if (!(await askToEditAgain())) return outcome;
  }
}

const resumeHint = (path: string): string =>
  `The draft stays in ${displayPath(path)}. Run "wlz new --resume" to continue it.`;

/** Starts a draft from the options. It never replaces a draft that an earlier run kept. */
export async function startDraft(
  project: Project,
  options: ChangeOptions,
): Promise<string> {
  const path = draftPath(project);
  await mkdir(dirname(path), { recursive: true });
  const created = await writeNewFile(
    path,
    renderDraft(project.config, options),
  );
  if (!created) {
    throw new UsageError(
      `new: an earlier draft waits in ${displayPath(path)}, continue it with --resume or delete it`,
    );
  }
  return path;
}

/** Finds the draft that an earlier run kept. */
export async function findKeptDraft(project: Project): Promise<string> {
  const path = draftPath(project);
  const exists = await Bun.file(path).exists();
  if (!exists) {
    throw new UsageError(`new --resume: no draft in ${displayPath(path)}`);
  }
  return path;
}

/** Runs a step on a draft and points to the kept draft when the step fails. */
async function keepingDraft<T>(
  path: string,
  step: () => Promise<T>,
): Promise<T> {
  try {
    return await step();
  } catch (error) {
    throw new Error(`${errorMessage(error)}\n${resumeHint(path)}`, {
      cause: error,
    });
  }
}

/**
 * Edits a draft until it holds a valid change, records the change, and only
 * then removes the draft. Whenever a step fails, the draft stays for
 * "new --resume", so nothing written in the editor gets lost.
 */
export async function recordFromDraft(
  project: Project,
  editor: string,
  path: string,
): Promise<string> {
  const outcome = await keepingDraft(path, () =>
    editDraft(project.config, editor, path),
  );
  if (outcome.status === "invalid") {
    throw new Error(`new: the change has problems\n${resumeHint(path)}`);
  }
  if (outcome.status === "empty") {
    await rm(path);
    throw new Error("new: empty change, nothing recorded");
  }

  const recorded = await keepingDraft(path, () =>
    recordChange(project, outcome.change),
  );
  await rm(path);
  return recorded;
}
