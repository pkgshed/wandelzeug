/**
 * The .changes/config.yaml configuration: its settings, kinds and extra
 * fields.
 */

import { join } from "node:path";
import {
  findDuplicate,
  isRecord,
  type RawRecord,
} from "../shared/foundations.ts";
import { isFieldName } from "../shared/templates.ts";
import { type Bump, BUMPS, isBump } from "../shared/versions.ts";

/**
 * The directory that holds the configuration, the unreleased changes and
 * the editor draft, so a project gains only this directory and its
 * changelog. Its parent is the project root.
 */
export const CHANGES_DIR = ".changes";

/** The configuration file, relative to the project root. It marks a project root. */
export const CONFIG_FILE = join(CHANGES_DIR, "config.yaml");

/** A kind of change, such as Added. Its bump drives "auto" versions. */
export type Kind = {
  readonly label: string;
  readonly bump: Bump | undefined;
};

/** The value types of an extra field, named as in changie's custom choices. */
export const FIELD_TYPES = ["string", "block", "int", "enum", "enums"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

const isFieldType = (value: unknown): value is FieldType =>
  (FIELD_TYPES as readonly unknown[]).includes(value);

type LengthLimits = {
  readonly minLength: number | undefined;
  readonly maxLength: number | undefined;
};

type IntLimits = {
  readonly minInt: number | undefined;
  readonly maxInt: number | undefined;
};

type EnumOptions = {
  readonly enumOptions: readonly string[];
};

/** The type of an extra field together with the settings only it accepts. */
type ExtraFieldTypeSettings =
  | ({ readonly type: "string" } & LengthLimits)
  | ({ readonly type: "block" } & LengthLimits)
  | ({ readonly type: "int" } & IntLimits)
  | ({ readonly type: "enum" } & EnumOptions)
  | ({ readonly type: "enums" } & EnumOptions);

/**
 * A front matter entry besides kind that "new" asks for and "check"
 * validates, such as a pull request number. Its value sits at the top level
 * of the front matter, next to kind.
 */
export type ExtraField = {
  readonly key: string;
  /** The question that "new" asks for the value. */
  readonly prompt: string;
  readonly required: boolean;
} & ExtraFieldTypeSettings;

/** The extra fields of the given types. */
export type ExtraFieldOf<T extends FieldType> = Extract<
  ExtraField,
  { type: T }
>;

/** Keys that templates fill from the change itself, so metadata may not use them. */
export const RESERVED_KEYS = ["kind", "title", "body"];

/**
 * Project settings from .changes/config.yaml. Paths are relative to the
 * project root, the directory that holds .changes.
 */
export type Config = {
  /** Directory below .changes for unreleased fragments. */
  readonly unreleasedDir: string;
  /** Changelog that "wlz batch" adds releases to. */
  readonly changelogPath: string;
  /** Prefix of release names and the {{version}} value. Empty by default, as in "1.1.2". */
  readonly versionPrefix: string;
  /** Prefix of git tags and the {{tag}} value, such as "v" in "v1.1.2". */
  readonly tagPrefix: string;
  /** Web address of the repository for compare links. Empty turns the default links off. */
  readonly repositoryUrl: string;
  /** Mustache template for the fragment file name between "nnn-" and ".md". */
  readonly fragmentName: string;
  /** Maximum length of the {{title}} slug in fragment file names. */
  readonly titleMaxLength: number;
  /** Mustache template for the heading of a release. */
  readonly versionFormat: string;
  /** Mustache template for the heading of a kind section. */
  readonly kindFormat: string;
  /** Mustache template for one change entry. */
  readonly changeFormat: string;
  /** Mustache template for a whole release, which places the formats as partials. */
  readonly releaseTemplate: string;
  /** Mustache template for the link definition of a release. Empty turns links off. */
  readonly linkFormat: string;
  /** Kinds in changelog order. */
  readonly kinds: readonly Kind[];
  /** Front matter entries that "new" asks for and "check" validates. */
  readonly extraFields: readonly ExtraField[];
};

/**
 * The release layout that places the three formats: the version heading,
 * then each kind with a heading and its changes, separated by blank lines.
 */
export const DEFAULT_RELEASE_TEMPLATE = `{{> version}}
{{#kinds}}

{{> kind}}

{{#changes}}
{{> change}}
{{/changes}}
{{/kinds}}
`;

/**
 * The link definition of a release in the style of Keep a Changelog: a
 * comparison with the previous tag, or the tag itself for a first release.
 */
export const DEFAULT_LINK_FORMAT =
  "[`{{version}}`]: {{repositoryUrl}}/{{#previousTag}}compare/{{previousTag}}...{{tag}}{{/previousTag}}{{^previousTag}}releases/tag/{{tag}}{{/previousTag}}";

/** The settings that apply when .changes/config.yaml leaves them out. */
export const DEFAULT_CONFIG: Config = {
  unreleasedDir: "unreleased",
  changelogPath: "CHANGELOG.md",
  versionPrefix: "",
  tagPrefix: "v",
  repositoryUrl: "",
  fragmentName: "{{kind}}-{{title}}",
  titleMaxLength: 48,
  versionFormat: "## [`{{version}}`] ({{date}})",
  kindFormat: "### {{kind}}",
  changeFormat: "{{body}}",
  releaseTemplate: DEFAULT_RELEASE_TEMPLATE,
  linkFormat: DEFAULT_LINK_FORMAT,
  kinds: [
    {
      label: "Added",
      bump: "minor",
    },
    {
      label: "Changed",
      bump: "major",
    },
    {
      label: "Deprecated",
      bump: "minor",
    },
    {
      label: "Removed",
      bump: "major",
    },
    {
      label: "Fixed",
      bump: "patch",
    },
    {
      label: "Security",
      bump: "patch",
    },
  ],
  extraFields: [],
};

const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG);

type KeysWithValue<T, V> = Exclude<
  { [K in keyof T]: T[K] extends V ? K : never }[keyof T],
  undefined
>;
type StringSetting = KeysWithValue<Config, string>;

const findUnknownKey = (
  record: RawRecord,
  known: readonly string[],
): string | undefined =>
  Object.keys(record).find((key) => !known.includes(key));

function readString(settings: RawRecord, key: StringSetting): string {
  const value = settings[key] ?? DEFAULT_CONFIG[key];
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string`);
  }
  return value;
}

function readTitleMaxLength(settings: RawRecord): number {
  const value = settings.titleMaxLength ?? DEFAULT_CONFIG.titleMaxLength;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error("titleMaxLength must be a positive integer");
  }
  return value;
}

function parseLabel(value: unknown, where: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${where} needs a non-empty label`);
  }
  return value;
}

function parseBump(value: unknown, where: string): Bump | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isBump(value)) {
    throw new Error(`${where}.bump must be one of: ${BUMPS.join(", ")}`);
  }
  return value;
}

/** Parses one kinds entry, which is either a bare label or a mapping. */
function parseKind(entry: unknown, index: number): Kind {
  const where = `kinds[${index}]`;
  if (!isRecord(entry)) {
    return {
      label: parseLabel(entry, where),
      bump: undefined,
    };
  }

  const unknownKey = findUnknownKey(entry, ["label", "bump"]);
  if (unknownKey !== undefined) {
    throw new Error(`${where}: unknown setting ${JSON.stringify(unknownKey)}`);
  }
  return {
    label: parseLabel(entry.label, where),
    bump: parseBump(entry.bump, where),
  };
}

function readKinds(settings: RawRecord): readonly Kind[] {
  if (settings.kinds === undefined) return DEFAULT_CONFIG.kinds;
  if (!Array.isArray(settings.kinds) || settings.kinds.length === 0) {
    throw new Error("kinds must be a non-empty list");
  }

  const kinds = settings.kinds.map(parseKind);
  const duplicate = findDuplicate(
    kinds.map((kind) => kind.label.toLowerCase()),
  );
  if (duplicate !== undefined) {
    throw new Error(`kinds: duplicate label ${JSON.stringify(duplicate)}`);
  }
  return kinds;
}

function parseFieldKey(value: unknown, where: string): string {
  if (typeof value !== "string" || !isFieldName(value)) {
    throw new Error(
      `${where}.key must be letters, digits and underscores, not starting with a digit`,
    );
  }
  if (RESERVED_KEYS.includes(value)) {
    throw new Error(`${where}.key ${JSON.stringify(value)} is reserved`);
  }
  return value;
}

/** Parses a prompt. Without one, "new" asks with the key itself. */
function parseFieldPrompt(value: unknown, key: string, where: string): string {
  if (value === undefined || value === null) return key;
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    /[\r\n]/.test(value)
  ) {
    throw new Error(`${where}.prompt must be a single line of text`);
  }
  return value;
}

/** Parses a type. Without one, a field holds a string. */
function parseFieldType(value: unknown, where: string): FieldType {
  if (value === undefined || value === null) return "string";
  if (!isFieldType(value)) {
    throw new Error(`${where}.type must be one of: ${FIELD_TYPES.join(", ")}`);
  }
  return value;
}

function parseFieldRequired(value: unknown, where: string): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== "boolean") {
    throw new Error(`${where}.required must be true or false`);
  }
  return value;
}

/** Parses an optional limit, which must be a whole number of at least lowest. */
function parseLimit(
  value: unknown,
  name: string,
  lowest: number,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a whole number`);
  }
  if (value < lowest) {
    throw new Error(`${name} must be at least ${lowest}`);
  }
  return value;
}

function rejectInvertedLimits(
  where: string,
  [minName, min]: readonly [string, number | undefined],
  [maxName, max]: readonly [string, number | undefined],
): void {
  if (min === undefined || max === undefined || min <= max) return;
  throw new Error(`${where}: ${minName} ${min} exceeds ${maxName} ${max}`);
}

function parseLengthLimits(entry: RawRecord, where: string): LengthLimits {
  const minLength = parseLimit(entry.minLength, `${where}.minLength`, 0);
  const maxLength = parseLimit(entry.maxLength, `${where}.maxLength`, 0);
  rejectInvertedLimits(
    where,
    ["minLength", minLength],
    ["maxLength", maxLength],
  );
  return { minLength, maxLength };
}

function parseIntLimits(entry: RawRecord, where: string): IntLimits {
  const lowest = Number.MIN_SAFE_INTEGER;
  const minInt = parseLimit(entry.minInt, `${where}.minInt`, lowest);
  const maxInt = parseLimit(entry.maxInt, `${where}.maxInt`, lowest);
  rejectInvertedLimits(where, ["minInt", minInt], ["maxInt", maxInt]);
  return { minInt, maxInt };
}

/**
 * Parses the options of an enum or enums field. Options match without regard
 * to case, so they must differ by more than case. An enums value joins its
 * choices with commas, so its options may not contain one.
 */
function parseEnumOptions(
  type: "enum" | "enums",
  value: unknown,
  where: string,
): readonly string[] {
  const name = `${where}.enumOptions`;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${name} must be a non-empty list`);
  }

  const options = value.map((option: unknown) => {
    const isScalar = ["string", "number", "boolean"].includes(typeof option);
    if (!isScalar || String(option).trim() === "") {
      throw new Error(`${name} must hold non-empty text`);
    }
    return String(option).trim();
  });
  const duplicate = findDuplicate(
    options.map((option) => option.toLowerCase()),
  );
  if (duplicate !== undefined) {
    throw new Error(`${name}: duplicate option ${JSON.stringify(duplicate)}`);
  }
  if (type === "enums" && options.some((option) => option.includes(","))) {
    throw new Error(
      `${name}: options of an enums field may not contain commas`,
    );
  }
  return options;
}

function parseTypeSettings(
  type: FieldType,
  entry: RawRecord,
  where: string,
): ExtraFieldTypeSettings {
  switch (type) {
    case "string":
    case "block":
      return { type, ...parseLengthLimits(entry, where) };
    case "int":
      return { type, ...parseIntLimits(entry, where) };
    case "enum":
    case "enums":
      return {
        type,
        enumOptions: parseEnumOptions(type, entry.enumOptions, where),
      };
  }
}

const COMMON_FIELD_SETTINGS = ["key", "prompt", "type", "required"];

const TYPE_SETTINGS: Readonly<Record<FieldType, readonly string[]>> = {
  string: ["minLength", "maxLength"],
  block: ["minLength", "maxLength"],
  int: ["minInt", "maxInt"],
  enum: ["enumOptions"],
  enums: ["enumOptions"],
};

function parseExtraField(entry: unknown, index: number): ExtraField {
  const where = `extraFields[${index}]`;
  if (!isRecord(entry)) {
    throw new Error(`${where} must be a mapping`);
  }

  const type = parseFieldType(entry.type, where);
  const known = [...COMMON_FIELD_SETTINGS, ...TYPE_SETTINGS[type]];
  const unknownKey = findUnknownKey(entry, known);
  if (unknownKey !== undefined) {
    throw new Error(
      `${where}: unknown setting ${JSON.stringify(unknownKey)} for type ${type}`,
    );
  }

  const key = parseFieldKey(entry.key, where);
  return {
    key,
    prompt: parseFieldPrompt(entry.prompt, key, where),
    required: parseFieldRequired(entry.required, where),
    ...parseTypeSettings(type, entry, where),
  };
}

/** Reads the extra fields. An empty "extraFields:" entry means none. */
function readExtraFields(settings: RawRecord): readonly ExtraField[] {
  const value = settings.extraFields ?? undefined;
  if (value === undefined) return DEFAULT_CONFIG.extraFields;
  if (!Array.isArray(value)) {
    throw new Error("extraFields must be a list");
  }

  const fields = value.map(parseExtraField);
  const duplicate = findDuplicate(fields.map((field) => field.key));
  if (duplicate !== undefined) {
    throw new Error(`extraFields: duplicate key ${JSON.stringify(duplicate)}`);
  }
  return fields;
}

/** Parses the YAML value of a configuration file. Absent settings take their defaults. */
export function parseConfig(raw: unknown): Config {
  const settings = raw ?? {};
  if (!isRecord(settings)) {
    throw new Error("configuration must be a mapping");
  }

  const unknownKey = findUnknownKey(settings, CONFIG_KEYS);
  if (unknownKey !== undefined) {
    throw new Error(`unknown setting ${JSON.stringify(unknownKey)}`);
  }

  return {
    unreleasedDir: readString(settings, "unreleasedDir"),
    changelogPath: readString(settings, "changelogPath"),
    versionPrefix: readString(settings, "versionPrefix"),
    tagPrefix: readString(settings, "tagPrefix"),
    repositoryUrl: readString(settings, "repositoryUrl"),
    fragmentName: readString(settings, "fragmentName"),
    titleMaxLength: readTitleMaxLength(settings),
    versionFormat: readString(settings, "versionFormat"),
    kindFormat: readString(settings, "kindFormat"),
    changeFormat: readString(settings, "changeFormat"),
    releaseTemplate: readString(settings, "releaseTemplate"),
    linkFormat: readString(settings, "linkFormat"),
    kinds: readKinds(settings),
    extraFields: readExtraFields(settings),
  };
}

export const findKind = (
  kinds: readonly Kind[],
  label: string,
): Kind | undefined =>
  kinds.find((kind) => kind.label.toLowerCase() === label.trim().toLowerCase());

/** Finds a configured kind by its label, ignoring case. */
export function resolveKind(kinds: readonly Kind[], label: string): Kind {
  const kind = findKind(kinds, label);
  if (kind === undefined) {
    const known = kinds.map((candidate) => candidate.label).join(", ");
    throw new Error(
      `unknown kind ${JSON.stringify(label)}, expected one of: ${known}`,
    );
  }
  return kind;
}
