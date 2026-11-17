/**
 * Values of extra fields: reading them in their types and enforcing the
 * field settings.
 */

import type { ExtraField, ExtraFieldOf } from "../project/config.ts";
import type { Metadata, MetadataValue } from "./fragments.ts";

/** The value of an extra field in its type, absent, or what is wrong with it. */
type FieldResult =
  | { readonly ok: true; readonly value: MetadataValue | undefined }
  | { readonly ok: false; readonly problem: string };

const fieldValue = (value: MetadataValue | undefined): FieldResult => ({
  ok: true,
  value,
});

const fieldProblem = (field: ExtraField, problem: string): FieldResult => ({
  ok: false,
  problem: `field ${JSON.stringify(field.key)} ${problem}`,
});

function readTextValue(
  field: ExtraFieldOf<"string" | "block">,
  value: MetadataValue,
): FieldResult {
  const text = String(value).trim();
  if (field.type === "string" && /[\r\n]/.test(text)) {
    return fieldProblem(field, "must be a single line, type block allows more");
  }

  const length = Array.from(text).length;
  if (field.minLength !== undefined && length < field.minLength) {
    return fieldProblem(
      field,
      `needs at least ${field.minLength} characters, got ${length}`,
    );
  }
  if (field.maxLength !== undefined && length > field.maxLength) {
    return fieldProblem(
      field,
      `allows at most ${field.maxLength} characters, got ${length}`,
    );
  }
  return fieldValue(text);
}

const INTEGER_TEXT = /^([#!-]?)(0|[1-9]\d{0,14})$/;

/**
 * Reads a whole number. "#42" and "!42" count as 42, the way GitHub and
 * GitLab write pull and merge request numbers.
 */
function parseIntegerValue(value: MetadataValue): number | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? value : undefined;
  }

  const match = INTEGER_TEXT.exec(String(value).trim());
  if (match === null) return undefined;
  const [, sign, digits] = match;
  const magnitude = Number(digits);
  return sign === "-" ? 0 - magnitude : magnitude;
}

function readIntValue(
  field: ExtraFieldOf<"int">,
  value: MetadataValue,
): FieldResult {
  const number = parseIntegerValue(value);
  if (number === undefined) {
    return fieldProblem(
      field,
      `expects an integer, got ${JSON.stringify(value)}`,
    );
  }
  if (field.minInt !== undefined && number < field.minInt) {
    return fieldProblem(
      field,
      `must be at least ${field.minInt}, got ${number}`,
    );
  }
  if (field.maxInt !== undefined && number > field.maxInt) {
    return fieldProblem(
      field,
      `must be at most ${field.maxInt}, got ${number}`,
    );
  }
  return fieldValue(number);
}

const findOption = (
  field: ExtraFieldOf<"enum" | "enums">,
  text: string,
): string | undefined =>
  field.enumOptions.find(
    (option) => option.toLowerCase() === text.trim().toLowerCase(),
  );

function readEnumValue(
  field: ExtraFieldOf<"enum">,
  value: MetadataValue,
): FieldResult {
  const option = findOption(field, String(value));
  if (option === undefined) {
    const options = field.enumOptions.join(", ");
    return fieldProblem(
      field,
      `must be one of ${options}, got ${JSON.stringify(value)}`,
    );
  }
  return fieldValue(option);
}

/**
 * Reads comma-separated choices. Like changie, it stores them as one string
 * joined with ", ", here in the order of the options.
 */
function readEnumsValue(
  field: ExtraFieldOf<"enums">,
  value: MetadataValue,
): FieldResult {
  const choices = String(value)
    .split(",")
    .map((choice) => choice.trim())
    .filter((choice) => choice !== "");
  const unknown = choices.find(
    (choice) => findOption(field, choice) === undefined,
  );
  if (unknown !== undefined) {
    const options = field.enumOptions.join(", ");
    return fieldProblem(
      field,
      `accepts only ${options}, got ${JSON.stringify(unknown)}`,
    );
  }

  const chosen = new Set(choices.map((choice) => findOption(field, choice)));
  const selected = field.enumOptions.filter((option) => chosen.has(option));
  return fieldValue(selected.length === 0 ? undefined : selected.join(", "));
}

function readFieldValue(field: ExtraField, value: MetadataValue): FieldResult {
  switch (field.type) {
    case "string":
    case "block":
      return readTextValue(field, value);
    case "int":
      return readIntValue(field, value);
    case "enum":
      return readEnumValue(field, value);
    case "enums":
      return readEnumsValue(field, value);
  }
}

/** An absent key and blank text both leave a field without a value. */
const isAbsent = (value: MetadataValue | undefined): value is undefined | "" =>
  value === undefined || (typeof value === "string" && value.trim() === "");

/** Reads the value of a field and enforces that a required field has one. */
export function checkField(
  field: ExtraField,
  value: MetadataValue | undefined,
): FieldResult {
  const result = isAbsent(value)
    ? fieldValue(undefined)
    : readFieldValue(field, value);
  const isMissing = result.ok && result.value === undefined;
  if (isMissing && field.required) {
    return {
      ok: false,
      problem: `missing required field ${JSON.stringify(field.key)}`,
    };
  }
  return result;
}

/** Metadata with its values in their field types, and what is wrong with it. */
export type FieldCheck = {
  readonly metadata: Metadata;
  readonly problems: readonly string[];
};

/**
 * Checks metadata against the extra fields and converts each value to the
 * type of its field. A field without a value leaves the metadata, and keys
 * without a configured field pass unchanged.
 */
export function applyExtraFields(
  fields: readonly ExtraField[],
  metadata: Metadata,
): FieldCheck {
  const typed: Record<string, MetadataValue> = { ...metadata };
  const problems: string[] = [];
  for (const field of fields) {
    const result = checkField(field, metadata[field.key]);
    if (!result.ok) {
      problems.push(result.problem);
    } else if (result.value === undefined) {
      delete typed[field.key];
    } else {
      typed[field.key] = result.value;
    }
  }
  return { metadata: typed, problems };
}
