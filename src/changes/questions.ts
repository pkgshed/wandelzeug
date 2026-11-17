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
  isBlankBody,
  type Metadata,
  type MetadataValue,
} from "./fragments.ts";
import {
  type ChangeOptions,
  isInteractive,
  requireTerminal,
} from "./options.ts";
import {
  askChoice,
  askChoices,
  askLines,
  askText,
  type Choice,
  type Validate,
} from "./prompts.ts";

async function askKind(kinds: readonly Kind[]): Promise<Kind> {
  requireTerminal("--kind");
  const choices = kinds.map((kind) => ({ value: kind, label: kind.label }));
  return askChoice("Kind", choices);
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
  kind: Kind,
  body: string,
  metadata: Metadata,
): Change {
  const fields = applyExtraFields(config.extraFields, metadata);
  if (fields.problems.length > 0) {
    throw new UsageError(fields.problems.join(", "));
  }
  return {
    kind: kind.label,
    metadata: fields.metadata,
    body,
  };
}

/** Builds a change from the options and asks for whatever they leave out. */
export async function askChange(
  config: Config,
  options: ChangeOptions,
): Promise<Change> {
  const kind = options.kind ?? (await askKind(config.kinds));
  const body = (options.body ?? (await askBody())).trim();
  if (isBlankBody(body)) {
    throw new UsageError("empty change body");
  }

  const asked = await askMissingFields(config.extraFields, options.givenKeys);
  return completeChange(config, kind, body, {
    ...options.metadata,
    ...asked,
  });
}
