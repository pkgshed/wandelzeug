/**
 * Questions on the terminal for whatever the options of "wlz new"
 * leave out.
 */

import {
  type Config,
  type ExtraField,
  findKind,
  type Kind,
} from "../project/config.ts";
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

/**
 * Asks questions on the terminal and reads the answers line by line. One
 * reader serves every question, so lines typed ahead are not lost. Bun's
 * prompt() does not fit, because it returns null for an empty answer as well
 * as for the end of input.
 */
class Terminal {
  #lines: AsyncIterator<string> | undefined;

  /** Asks a question and returns the answer, or undefined when the input ends. */
  async ask(question: string): Promise<string | undefined> {
    process.stdout.write(`${question} `);
    this.#lines ??= console[Symbol.asyncIterator]();
    const line = await this.#lines.next();
    return line.done ? undefined : line.value;
  }

  /** Stops reading stdin. */
  async close(): Promise<void> {
    await this.#lines?.return?.();
  }
}

/** Accepts a kind's number from the printed list, or its label. */
function pickKind(kinds: readonly Kind[], answer: string): Kind | undefined {
  const isNumber = /^\d+$/.test(answer.trim());
  return isNumber ? kinds[Number(answer) - 1] : findKind(kinds, answer);
}

async function askKind(
  terminal: Terminal,
  kinds: readonly Kind[],
): Promise<Kind> {
  requireTerminal("--kind");
  kinds.forEach((kind, index) => console.log(`  ${index + 1}) ${kind.label}`));
  for (;;) {
    const answer = await terminal.ask("Kind:");
    if (answer === undefined) {
      throw new Error("read kind: input ended");
    }
    if (answer.trim() === "") continue;

    const kind = pickKind(kinds, answer);
    if (kind !== undefined) return kind;
    console.error(`unknown kind ${JSON.stringify(answer.trim())}`);
  }
}

/** Asks for a one-line change. A line without a list marker becomes a "* " item. */
async function askBody(terminal: Terminal): Promise<string> {
  requireTerminal("--body");
  const answer = (await terminal.ask("Change:"))?.trim() ?? "";
  if (answer === "") return "";
  return LIST_MARKER.test(answer) ? answer : `* ${answer}`;
}

/** Words the question for a field, with hints on how to answer it. */
function fieldQuestion(field: ExtraField): string {
  const hints = [
    field.required ? undefined : "optional",
    field.type === "enums" ? "separate choices with commas" : undefined,
    field.type === "block" ? "end with an empty line" : undefined,
  ].filter((hint) => hint !== undefined);
  return hints.length === 0
    ? `${field.prompt}:`
    : `${field.prompt} (${hints.join(", ")}):`;
}

/** Reads lines up to the first empty one. */
async function askBlock(
  terminal: Terminal,
  question: string,
): Promise<string | undefined> {
  console.log(question);
  const lines: string[] = [];
  for (;;) {
    const line = await terminal.ask(">");
    if (line === undefined) {
      return lines.length === 0 ? undefined : lines.join("\n");
    }
    if (line.trim() === "") return lines.join("\n");
    lines.push(line);
  }
}

/** Replaces the numbers of listed options in an answer with the options. */
function resolveOptionNumbers(field: ExtraField, answer: string): string {
  if (field.type !== "enum" && field.type !== "enums") return answer;

  const optionOf = (choice: string): string => {
    const isNumber = /^\d+$/.test(choice);
    return (
      (isNumber ? field.enumOptions[Number(choice) - 1] : undefined) ?? choice
    );
  };
  return answer
    .split(",")
    .map((choice) => optionOf(choice.trim()))
    .join(", ");
}

/** Asks for one field until the answer fits. An empty answer skips an optional field. */
async function askField(
  terminal: Terminal,
  field: ExtraField,
): Promise<MetadataValue | undefined> {
  if (field.type === "enum" || field.type === "enums") {
    field.enumOptions.forEach((option, index) =>
      console.log(`  ${index + 1}) ${option}`),
    );
  }

  const question = fieldQuestion(field);
  for (;;) {
    const answer =
      field.type === "block"
        ? await askBlock(terminal, question)
        : await terminal.ask(question);
    if (answer === undefined) {
      throw new Error(`read ${field.key}: input ended`);
    }

    const result = checkField(field, resolveOptionNumbers(field, answer));
    if (result.ok) return result.value;
    console.error(result.problem);
  }
}

/** Asks for the fields that --meta left out, but only when stdin is a terminal. */
async function askMissingFields(
  terminal: Terminal,
  fields: readonly ExtraField[],
  givenKeys: ReadonlySet<string>,
): Promise<Metadata> {
  if (!isInteractive()) return {};

  const answers: Record<string, MetadataValue> = {};
  for (const field of fields.filter((field) => !givenKeys.has(field.key))) {
    const value = await askField(terminal, field);
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
  const terminal = new Terminal();
  try {
    const kind = options.kind ?? (await askKind(terminal, config.kinds));
    const body = (options.body ?? (await askBody(terminal))).trim();
    if (isBlankBody(body)) {
      throw new UsageError("empty change body");
    }

    const asked = await askMissingFields(
      terminal,
      config.extraFields,
      options.givenKeys,
    );
    return completeChange(config, kind, body, {
      ...options.metadata,
      ...asked,
    });
  } finally {
    await terminal.close();
  }
}
