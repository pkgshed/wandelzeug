/**
 * The .changes/config.yaml configuration: its settings, kinds and extra
 * fields. A valibot schema validates the settings, fills in the defaults,
 * and defines the types. This is the only module that imports valibot.
 */

import { join } from "node:path";
import * as v from "valibot";
import { attempt, findDuplicate } from "../shared/foundations.ts";
import { isFieldName } from "../shared/templates.ts";
import { BUMP_STRATEGIES, BUMPS } from "../shared/versions.ts";

/**
 * The directory that holds the configuration, the unreleased changes and
 * the editor draft, so a project gains only this directory and its
 * changelog. Its parent is the project root.
 */
export const CHANGES_DIR = ".changes";

/** The configuration file, relative to the project root. It marks a project root. */
export const CONFIG_FILE = join(CHANGES_DIR, "config.yaml");

/** Keys that templates fill from the change itself, so metadata may not use them. */
export const RESERVED_KEYS = ["kind", "title", "body", "marker", "text"];

/** The value types of an extra field, named as in changie's custom choices. */
export const FIELD_TYPES = ["string", "block", "int", "enum", "enums"] as const;

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
 * The tag message of a release as plain text, because git hosts show tag
 * messages without rendering Markdown: a subject line, the changes below a
 * line for each kind, and the definitions of the references with their
 * web addresses in angle brackets.
 */
export const DEFAULT_TAG_TEMPLATE = `release {{tag}}
{{#kinds}}

{{kind}}:
{{#changes}}
{{> change}}
{{/changes}}
{{/kinds}}

{{#references}}
[{{label}}]: <{{url}}>
{{/references}}
`;

/**
 * The link definition of a release in the style of Keep a Changelog: a
 * comparison with the previous tag, or the tag itself for a first release.
 */
export const DEFAULT_LINK_FORMAT =
  "[`{{version}}`]: {{repositoryUrl}}/{{#previousTag}}compare/{{previousTag}}...{{tag}}{{/previousTag}}{{^previousTag}}releases/tag/{{tag}}{{/previousTag}}";

/** The kinds of Keep a Changelog, in its order. */
const DEFAULT_KINDS = [
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
] as const;

// --- Schema building blocks -------------------------------------------------

/** A setting that takes its default when YAML leaves it out or empty, as in "key:". */
const setting = <
  const Schema extends v.GenericSchema,
  const Default extends v.InferInput<Schema>,
>(
  schema: Schema,
  fallback: Default,
) => v.nullish(schema, fallback);

/** An optional value that YAML may leave empty. Both absent and empty mean undefined. */
const absent = <const Schema extends v.GenericSchema>(schema: Schema) =>
  v.pipe(
    v.nullish(schema),
    v.transform((value) => value ?? undefined),
  );

/** Words a problem with a mapping: an unknown key, a missing key, or no mapping at all. */
function describeMappingIssue(
  issue: v.StrictObjectIssue,
  context: string,
  notMapping: string,
): string {
  if (issue.expected === "never") {
    return `unknown setting ${JSON.stringify(issue.input)}${context}`;
  }
  const isMissingKey =
    (issue.path?.length ?? 0) > 0 && issue.input === undefined;
  return isMissingKey ? "is required" : notMapping;
}

/**
 * A mapping that rejects keys it does not know, so a typo fails instead of
 * being ignored. The context names the settings, as in "for type string".
 */
const mapping = <const Entries extends v.ObjectEntries>(
  entries: Entries,
  context = "",
  notMapping = "must be a mapping",
) =>
  v.strictObject(entries, (issue) =>
    describeMappingIssue(issue, context, notMapping),
  );

const text = v.string("must be a string");

const nonEmptyText = v.pipe(
  v.string("must be a non-empty string"),
  v.trim(),
  v.nonEmpty("must be a non-empty string"),
);

const wholeNumber = v.pipe(
  v.number("must be a whole number"),
  v.safeInteger("must be a whole number"),
);

const lengthLimit = absent(
  v.pipe(wholeNumber, v.minValue(0, "must be at least 0")),
);

// --- Kinds ------------------------------------------------------------------

const bump = v.picklist(BUMPS, `must be one of: ${BUMPS.join(", ")}`);

const bumpStrategy = v.picklist(
  BUMP_STRATEGIES,
  `must be one of: ${BUMP_STRATEGIES.join(", ")}`,
);

/** A kind of change, such as Added. A bare label in the list stands for a kind without a bump. */
const KindSchema = v.pipe(
  v.unknown(),
  v.transform((entry) =>
    typeof entry === "string" ? { label: entry } : entry,
  ),
  mapping(
    {
      label: nonEmptyText,
      bump: absent(bump),
    },
    "",
    "must be a label or a mapping",
  ),
);

const labelDuplicate = (kinds: readonly { label: string }[]) =>
  findDuplicate(kinds.map((kind) => kind.label.toLowerCase()));

const KindsSchema = v.pipe(
  v.array(KindSchema, "must be a list"),
  v.minLength(1, "must be a non-empty list"),
  v.check(
    (kinds) => labelDuplicate(kinds) === undefined,
    (issue) =>
      `duplicate label ${JSON.stringify(labelDuplicate(issue.input as readonly { label: string }[]))}`,
  ),
);

// --- Extra fields -------------------------------------------------------------

const fieldKey = v.pipe(
  v.string("must be letters, digits and underscores"),
  v.check(
    isFieldName,
    "must be letters, digits and underscores, not starting with a digit",
  ),
  v.check(
    (key) => !RESERVED_KEYS.includes(key),
    (issue) => `${JSON.stringify(issue.input)} is reserved`,
  ),
);

const fieldPrompt = absent(
  v.pipe(
    nonEmptyText,
    v.check(
      (prompt) => !/[\r\n]/.test(prompt),
      "must be a single line of text",
    ),
  ),
);

/** The settings that every extra field accepts, whatever its type. */
const commonFieldEntries = {
  key: fieldKey,
  prompt: fieldPrompt,
  required: setting(v.boolean("must be true or false"), false),
};

/** Describes why a regular expression does not compile, if it does not. */
function regExpProblem(source: string): string | undefined {
  const compiled = attempt(() => new RegExp(source));
  return compiled.ok ? undefined : compiled.error;
}

/** A regular expression in JavaScript syntax that a whole value must match. */
const patternText = v.pipe(
  v.string("must be a regular expression"),
  v.nonEmpty("must be a non-empty regular expression"),
  v.check(
    (source) => regExpProblem(source) === undefined,
    (issue) => regExpProblem(String(issue.input)) ?? "",
  ),
);

/**
 * The settings that make the values of a field links: the Mustache
 * templates for the web address of a value and for the label that
 * references the value in the notes, such as "#{{pr}}" for "[#42]".
 */
const linkEntries = {
  url: absent(nonEmptyText),
  label: absent(nonEmptyText),
};

const stringField = mapping(
  {
    ...commonFieldEntries,
    type: v.optional(v.literal("string"), "string"),
    minLength: lengthLimit,
    maxLength: lengthLimit,
    pattern: absent(patternText),
    ...linkEntries,
  },
  " for type string",
);

const blockField = mapping(
  {
    ...commonFieldEntries,
    type: v.literal("block"),
    minLength: lengthLimit,
    maxLength: lengthLimit,
  },
  " for type block",
);

const intField = mapping(
  {
    ...commonFieldEntries,
    type: v.literal("int"),
    minInt: absent(wholeNumber),
    maxInt: absent(wholeNumber),
    ...linkEntries,
  },
  " for type int",
);

const optionDuplicate = (options: readonly string[]) =>
  findDuplicate(options.map((option) => option.toLowerCase()));

/**
 * The options of an enum or enums field. Options match without regard to
 * case, so they must differ by more than case. An enums value joins its
 * choices with commas, so its options may not contain one.
 */
const enumOptions = (type: "enum" | "enums") =>
  v.pipe(
    v.array(
      v.pipe(
        v.union(
          [v.string(), v.number(), v.boolean()],
          "must hold non-empty text",
        ),
        v.transform((option) => String(option).trim()),
        v.nonEmpty("must hold non-empty text"),
      ),
      "must be a non-empty list",
    ),
    v.minLength(1, "must be a non-empty list"),
    v.check(
      (options) => optionDuplicate(options) === undefined,
      (issue) =>
        `duplicate option ${JSON.stringify(optionDuplicate(issue.input as readonly string[]))}`,
    ),
    v.check(
      (options) =>
        type === "enum" || options.every((option) => !option.includes(",")),
      "options of an enums field may not contain commas",
    ),
  );

const enumField = <const Type extends "enum" | "enums">(type: Type) =>
  mapping(
    {
      ...commonFieldEntries,
      type: v.literal(type),
      enumOptions: enumOptions(type),
    },
    ` for type ${type}`,
  );

/** The extra field settings by type. Without a type, a field holds a string. */
const FieldSettingsSchema = v.variant(
  "type",
  [stringField, blockField, intField, enumField("enum"), enumField("enums")],
  `must be one of: ${FIELD_TYPES.join(", ")}`,
);

type FieldSettings = v.InferOutput<typeof FieldSettingsSchema>;

function describeInverted(
  [minName, min]: readonly [string, number | undefined],
  [maxName, max]: readonly [string, number | undefined],
): string | undefined {
  const isInverted = min !== undefined && max !== undefined && min > max;
  return isInverted ? `${minName} ${min} exceeds ${maxName} ${max}` : undefined;
}

/** Describes a lower limit above the upper limit of a field, if there is one. */
function invertedLimit(field: FieldSettings): string | undefined {
  switch (field.type) {
    case "string":
    case "block":
      return describeInverted(
        ["minLength", field.minLength],
        ["maxLength", field.maxLength],
      );
    case "int":
      return describeInverted(
        ["minInt", field.minInt],
        ["maxInt", field.maxInt],
      );
    case "enum":
    case "enums":
      return undefined;
  }
}

/**
 * A front matter entry besides kind that "new" asks for and "check"
 * validates, such as a pull request number. Its value sits at the top level
 * of the front matter, next to kind. Without a prompt, "new" asks with the
 * key itself.
 */
/**
 * Describes a link setting that cannot work, if there is one. A label is
 * only for links, and wandelzeug finds the references of a string field in
 * the notes through its pattern.
 */
function linkProblem(field: FieldSettings): string | undefined {
  if (field.type !== "string" && field.type !== "int") return undefined;
  if (field.label !== undefined && field.url === undefined) {
    return "label needs url";
  }
  const lacksPattern =
    field.type === "string" &&
    field.url !== undefined &&
    field.pattern === undefined;
  return lacksPattern
    ? "url needs a pattern, which finds the references in the notes"
    : undefined;
}

const fieldProblem = (field: FieldSettings): string | undefined =>
  invertedLimit(field) ?? linkProblem(field);

const ExtraFieldSchema = v.pipe(
  FieldSettingsSchema,
  v.check(
    (field) => fieldProblem(field) === undefined,
    (issue) => fieldProblem(issue.input as FieldSettings) ?? "",
  ),
  v.transform((field) => ({ ...field, prompt: field.prompt ?? field.key })),
);

const keyDuplicate = (fields: readonly { key: string }[]) =>
  findDuplicate(fields.map((field) => field.key));

const ExtraFieldsSchema = v.pipe(
  v.array(ExtraFieldSchema, "must be a list"),
  v.check(
    (fields) => keyDuplicate(fields) === undefined,
    (issue) =>
      `duplicate key ${JSON.stringify(keyDuplicate(issue.input as readonly { key: string }[]))}`,
  ),
);

// --- Replacements -----------------------------------------------------------

/**
 * A file whose version number "batch" and "release" keep in step with the
 * changelog. find is a regular expression and replace a Mustache template
 * that takes the values of versionFormat.
 */
const ReplacementSchema = mapping({
  path: nonEmptyText,
  find: v.pipe(
    v.string("must be a regular expression"),
    v.nonEmpty("must be a non-empty regular expression"),
  ),
  replace: text,
});

// --- The tag helper -----------------------------------------------------------

/** The command that creates a tag by default: an annotated tag of git with the tag message from a file. */
export const DEFAULT_TAG_CREATE = [
  "git",
  "tag",
  "--annotate",
  "--cleanup=whitespace",
  "--file",
  "{{messageFile}}",
  "{{tag}}",
  "{{commit}}",
];

const DEFAULT_TAG_HELPER = { create: DEFAULT_TAG_CREATE };

/** A command as a list of Mustache templates, the program first. */
const commandLine = v.pipe(
  v.array(text, "must be a list of arguments"),
  v.minLength(1, "must be a non-empty list of arguments"),
);

const environmentName = v.pipe(
  v.string(),
  v.regex(
    /^[A-Za-z_][A-Za-z0-9_]*$/,
    "must be letters, digits and underscores, not starting with a digit",
  ),
);

/**
 * The commands that tag a release, without a shell, each argument a
 * Mustache template: an optional check that runs before anything changes,
 * and the command that creates the tag. The environment variables apply
 * to both.
 */
const TagHelperSchema = mapping(
  {
    check: absent(commandLine),
    create: commandLine,
    env: setting(
      v.record(environmentName, text, "must map variable names to values"),
      {},
    ),
  },
  "",
  "must be a mapping of the steps check and create, which replaced the command string of wandelzeug 0.1",
);

// --- The configuration ------------------------------------------------------

/**
 * Project settings from .changes/config.yaml. Paths are relative to the
 * project root, the directory that holds .changes. Absent and empty
 * settings take their defaults.
 */
const ConfigSchema = v.pipe(
  v.nullish(v.unknown(), {}),
  mapping({
    /** Directory below .changes for unreleased fragments. */
    unreleasedDir: setting(text, "unreleased"),
    /** Changelog that "wlz batch" adds releases to. */
    changelogPath: setting(text, "CHANGELOG.md"),
    /** Prefix of release names and the {{version}} value, as in "1.1.2". */
    versionPrefix: setting(text, ""),
    /** Prefix of git tags and the {{tag}} value, as in "v1.1.2". */
    tagPrefix: setting(text, "v"),
    /** Web address of the repository for compare links. Empty turns the default links off. */
    repositoryUrl: setting(text, ""),
    /** Mustache template for the fragment file name between "nnn-<id>-" and ".md". */
    fragmentName: setting(text, "{{kind}}-{{title}}"),
    /** Maximum length of the {{title}} slug in fragment file names. */
    titleMaxLength: setting(
      v.pipe(
        v.number("must be a positive integer"),
        v.integer("must be a positive integer"),
        v.minValue(1, "must be a positive integer"),
      ),
      48,
    ),
    /** Mustache template for the heading of a release. */
    versionFormat: setting(text, "## [`{{version}}`] ({{date}})"),
    /** Mustache template for the heading of a kind section. */
    kindFormat: setting(text, "### {{kind}}"),
    /** Mustache template for one change entry. */
    changeFormat: setting(text, "{{body}}"),
    /** Mustache template for a whole release, which places the formats as partials. */
    releaseTemplate: setting(text, DEFAULT_RELEASE_TEMPLATE),
    /** Mustache template for the message of the tag that "wlz release" creates. */
    tagTemplate: setting(text, DEFAULT_TAG_TEMPLATE),
    /** Mustache template for the link definition of a release. Empty turns links off. */
    linkFormat: setting(text, DEFAULT_LINK_FORMAT),
    /** How "wlz release" checks and creates the tag of a release, git tag by default. */
    tagHelper: setting(TagHelperSchema, DEFAULT_TAG_HELPER),
    /**
     * Whether "batch" and "release" write a data block at the bottom of
     * each release, which "render" needs to render the release again.
     */
    releaseData: setting(v.boolean("must be true or false"), true),
    /** Files whose version numbers "batch" and "release" update with each release. */
    replacements: setting(v.array(ReplacementSchema, "must be a list"), []),
    /** How "auto" bumps while the latest release is 0.y.z. */
    bumpStrategy: setting(bumpStrategy, "minor-capped"),
    /** Kinds in changelog order. */
    kinds: v.optional(KindsSchema, DEFAULT_KINDS),
    /** Front matter entries that "new" asks for and "check" validates. */
    extraFields: setting(ExtraFieldsSchema, []),
  }),
);

/** Project settings, with every default filled in. */
export type Config = v.InferOutput<typeof ConfigSchema>;

/** A kind of change, such as Added. Its bump drives "auto" versions. */
export type Kind = v.InferOutput<typeof KindSchema>;

/** A front matter entry that "new" asks for and "check" validates. */
export type ExtraField = v.InferOutput<typeof ExtraFieldSchema>;

export type FieldType = ExtraField["type"];

/** The extra fields of the given types. */
export type ExtraFieldOf<T extends FieldType> = Extract<
  ExtraField,
  { type: T }
>;

/** Writes the path of an issue the way the configuration spells it, as in "kinds[0].label". */
function issuePath(issue: v.BaseIssue<unknown>): string {
  const items = issue.path ?? [];
  // An unknown key is the last path item, and its message names it already.
  const isUnknownKey =
    issue.type === "strict_object" && issue.expected === "never";
  const shown = isUnknownKey ? items.slice(0, -1) : items;
  return shown.reduce((path, item) => {
    const key: unknown = item.key;
    if (typeof key === "number") return `${path}[${key}]`;
    return path === "" ? String(key) : `${path}.${String(key)}`;
  }, "");
}

const describeIssue = (issue: v.BaseIssue<unknown>): string => {
  const path = issuePath(issue);
  return path === "" ? issue.message : `${path}: ${issue.message}`;
};

/**
 * Parses the YAML value of a configuration file. Absent settings take their
 * defaults. A configuration with problems fails with every problem, one per
 * line.
 */
export function parseConfig(raw: unknown): Config {
  const result = v.safeParse(ConfigSchema, raw, { abortEarly: false });
  if (!result.success) {
    throw new Error(result.issues.map(describeIssue).join("\n"));
  }
  return result.output;
}

/** The settings that apply when .changes/config.yaml leaves them out. */
export const DEFAULT_CONFIG: Config = parseConfig({});

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
