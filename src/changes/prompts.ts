/**
 * Questions on the terminal through @clack/prompts. This is the only module
 * that imports it. A cancelled question, such as one ended with Ctrl+C,
 * throws, so nothing gets recorded.
 */

import * as clack from "@clack/prompts";

/** Checks an answer and returns a problem to show, or undefined to accept it. */
export type Validate = (answer: string) => string | undefined;

/** A choice in a list, with the value it stands for. */
export type Choice<Value> = {
  readonly value: Value;
  readonly label: string;
};

/**
 * Returns the answer to a question, or throws when the user cancelled it.
 * clack signals a cancellation with a symbol in place of the answer.
 */
function answered<Answer>(answer: Answer): Exclude<Answer, symbol> {
  if (clack.isCancel(answer)) {
    throw new Error("new: cancelled, nothing recorded");
  }
  return answer as Exclude<Answer, symbol>;
}

/** Asks for one line of text. */
export const askText = async (
  message: string,
  validate: Validate,
  placeholder?: string,
): Promise<string> =>
  answered(
    await clack.text({
      message,
      placeholder,
      validate: (answer) => validate(answer ?? ""),
    }),
  );

/** Asks for several lines of text. Pressing Enter twice ends the answer. */
export const askLines = async (
  message: string,
  validate: Validate,
): Promise<string> =>
  answered(
    await clack.multiline({
      message,
      validate: (answer) => validate(answer ?? ""),
    }),
  );

/** Asks for one choice from a list. */
export const askChoice = async <Value>(
  message: string,
  choices: readonly Choice<Value>[],
): Promise<Value> =>
  answered(
    await clack.select<Value>({
      message,
      options: choices.map((choice) => ({
        ...choice,
      })) as clack.Option<Value>[],
    }),
  );

/** Asks for any number of choices from a list. A required question needs one at least. */
export const askChoices = async <Value>(
  message: string,
  choices: readonly Choice<Value>[],
  required: boolean,
): Promise<Value[]> =>
  answered(
    await clack.multiselect<Value>({
      message,
      options: choices.map((choice) => ({
        ...choice,
      })) as clack.Option<Value>[],
      required,
    }),
  );

/** Asks a yes or no question, with the given answer preselected. */
export const askYesNo = async (
  message: string,
  initialValue = true,
): Promise<boolean> => answered(await clack.confirm({ message, initialValue }));
