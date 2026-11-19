/**
 * Questions on the terminal for whatever the options of "wlz new"
 * leave out.
 */

import type { Config, ExtraField, Kind } from "../project/config.ts";
import { UsageError } from "../shared/foundations.ts";
import { LIST_MARKER } from "../shared/slugs.ts";
import { applyExtraFields, checkField } from "./fields.ts";
import {
  type Change,
  type ChangeFile,
  type EmptyChange,
  isBlankBody,
  type Metadata,
  type MetadataValue,
} from "./fragments.ts";
import {
  type ChangeOptions,
  checkBreakingOption,
  isInteractive,
  requireTerminal,
} from "./options.ts";
import {
  askChoice,
  askChoices,
  askLines,
  askText,
  askYesNo,
  type Choice,
  type Validate,
} from "./prompts.ts";

/** The answer to the kind question: a kind, or no notable change. */
type KindAnswer =
  { readonly type: "kind"; readonly kind: Kind } | { readonly type: "empty" };

const kindChoices = (kinds: readonly Kind[]): Choice<KindAnswer>[] =>
  kinds.map((kind) => ({ value: { type: "kind", kind }, label: kind.label }));

/** Options that only a change with a kind can use, so they rule out an empty change. */
const givesContent = (options: ChangeOptions): boolean =>
  options.body !== undefined ||
  options.givenKeys.size > 0 ||
  options.breaking !== undefined;

/**
 * Asks for the kind. Unless the options give content for a change, the
 * list ends with a choice for no notable change, so the empty change is
 * easy to find.
 */
async function askKind(
  kinds: readonly Kind[],
  options: ChangeOptions,
): Promise<KindAnswer> {
  requireTerminal("--kind");
  const empty: Choice<KindAnswer>[] = givesContent(options)
    ? []
    : [{ value: { type: "empty" }, label: "No notable change" }];
  return askChoice("Kind", [...kindChoices(kinds), ...empty]);
}

/** Asks for the optional reason of an empty change. */
async function askReason(): Promise<EmptyChange> {
  const answer = await askText(
    "Reason (optional)",
    () => undefined,
    "Refactoring only",
  );
  const reason = answer.trim();
  return { type: "empty", reason: reason === "" ? undefined : reason };
}

/** Asks for a one-line change. A line without a list marker becomes a "* " item. */
async function askBody(): Promise<string> {
  requireTerminal("--body");
  const answer = await askText(
    "Change",
    (text) => (text.trim() === "" ? "a change needs a body" : undefined),
    "Support for TOML config",
  );
  const line = answer.trim();
  return LIST_MARKER.test(line) ? line : `* ${line}`;
}

/**
 * Decides whether a change breaks. A kind that always or never breaks
 * answers without a question. A kind that asks gets a question, which
 * defaults to no. Without a terminal, such a kind needs --breaking or
 * --no-breaking, so a script cannot skip the decision by accident.
 */
async function askBreaking(kind: Kind): Promise<boolean> {
  if (kind.breaking !== "ask") return kind.breaking === "yes";
  requireTerminal(
    `--breaking or --no-breaking for kind ${JSON.stringify(kind.label)}`,
  );
  return askYesNo("Breaking change?", false);
}

/** Accepts an answer that the field accepts, and shows its problem otherwise. */
const validateField =
  (field: ExtraField): Validate =>
  (answer) => {
    const result = checkField(field, answer);
    return result.ok ? undefined : result.problem;
  };

/** Reads an accepted answer in the type of its field. */
function fieldValue(
  field: ExtraField,
  answer: string,
): MetadataValue | undefined {
  const result = checkField(field, answer);
  return result.ok ? result.value : undefined;
}

const optionChoices = (
  field: ExtraField & { enumOptions: readonly string[] },
) => field.enumOptions.map((option) => ({ value: option, label: option }));

/** Asks for one field in the way that suits its type. */
async function askField(field: ExtraField): Promise<MetadataValue | undefined> {
  const message = field.required ? field.prompt : `${field.prompt} (optional)`;
  switch (field.type) {
    case "string":
    case "int":
      return fieldValue(field, await askText(message, validateField(field)));
    case "block":
      return fieldValue(field, await askLines(message, validateField(field)));
    case "enum": {
      const none: Choice<string>[] = field.required
        ? []
        : [{ value: "", label: "(none)" }];
      const choice = await askChoice(message, [
        ...none,
        ...optionChoices(field),
      ]);
      return fieldValue(field, choice);
    }
    case "enums": {
      const choices = await askChoices(
        message,
        optionChoices(field),
        field.required,
      );
      return fieldValue(field, choices.join(", "));
    }
  }
}

/** Asks for the fields that --meta left out, but only when stdin is a terminal. */
async function askMissingFields(
  fields: readonly ExtraField[],
  givenKeys: ReadonlySet<string>,
): Promise<Metadata> {
  if (!isInteractive()) return {};

  const answers: Record<string, MetadataValue> = {};
  for (const field of fields.filter((field) => !givenKeys.has(field.key))) {
    const value = await askField(field);
    if (value !== undefined) answers[field.key] = value;
  }
  return answers;
}

/** Checks the extra fields of a change that the options and answers made up. */
function completeChange(
  config: Config,
  change: Omit<Change, "kind"> & { readonly kind: Kind },
): Change {
  const fields = applyExtraFields(config.extraFields, change.metadata);
  if (fields.problems.length > 0) {
    throw new UsageError(fields.problems.join(", "));
  }
  return {
    kind: change.kind.label,
    breaking: change.breaking,
    metadata: fields.metadata,
    body: change.body,
  };
}

/**
 * Builds a change from the options and asks for whatever they leave out.
 * When the answer to the kind question is no notable change, it asks for
 * the reason of an empty change instead.
 */
export async function askChange(
  config: Config,
  options: ChangeOptions,
): Promise<ChangeFile> {
  const answer: KindAnswer =
    options.kind === undefined
      ? await askKind(config.kinds, options)
      : { type: "kind", kind: options.kind };
  if (answer.type === "empty") return askReason();
  const change = await askChangeOfKind(config, options, answer.kind);
  return { type: "change", change };
}

/** Asks for whatever the options leave out of a change of the given kind. */
async function askChangeOfKind(
  config: Config,
  options: ChangeOptions,
  kind: Kind,
): Promise<Change> {
  checkBreakingOption(kind, options.breaking);
  const body = (options.body ?? (await askBody())).trim();
  if (isBlankBody(body)) {
    throw new UsageError("empty change body");
  }

  const breaking = options.breaking ?? (await askBreaking(kind));
  const asked = await askMissingFields(config.extraFields, options.givenKeys);
  return completeChange(config, {
    kind,
    breaking,
    metadata: { ...options.metadata, ...asked },
    body,
  });
}
