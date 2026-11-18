/**
 * Project roots with their parsed configuration and their paths.
 */

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { displayPath, mapValues, withContext } from "../shared/foundations.ts";
import { parseTemplate, type Template } from "../shared/templates.ts";
import {
  CHANGES_DIR,
  type Config,
  CONFIG_FILE,
  parseConfig,
} from "./config.ts";
import { labelRecognizer, type LinkField } from "../changes/references.ts";
import { compilePattern, type Replacement } from "./replacements.ts";

/** The parsed templates of a project. */
export type Templates = {
  readonly fragmentName: Template;
  readonly version: Template;
  readonly kind: Template;
  readonly change: Template;
  readonly release: Template;
  readonly link: Template;
  readonly tag: Template;
  readonly tagHelper: TagHelperTemplates;
};

/** The commands of the tag helper, each argument and each variable value a template. */
export type TagHelperTemplates = {
  readonly check: readonly Template[] | undefined;
  readonly create: readonly Template[];
  readonly env: Readonly<Record<string, Template>>;
};

/** The values that describe a release: its name, date, tag and predecessor. */
const RELEASE_VALUES = [
  "version",
  "date",
  "tag",
  "previousVersion",
  "previousTag",
];

/**
 * The values of the tag helper: those of a release, the bump, the project
 * root, the tag message as text and as a file, and the release commit,
 * which exists only once the check has passed.
 */
const TAG_CHECK_VALUES = [
  ...RELEASE_VALUES,
  "bump",
  "root",
  "message",
  "messageFile",
];
const TAG_CREATE_VALUES = [...TAG_CHECK_VALUES, "commit"];

/** The partials that releaseTemplate can place, filled by the formats of the same name. */
const RELEASE_PARTIALS = ["version", "kind", "change"];

/**
 * Parses the template of a setting. Only the templates of a whole release
 * may use partials, because a format that placed itself would never stop
 * rendering.
 */
function parseSettingTemplate(setting: string, source: string): Template {
  const template = withContext(setting, () => parseTemplate(source));
  const [partial] = template.partials;
  if (partial !== undefined) {
    throw new Error(
      `${setting}: the partial {{> ${partial}}} belongs in releaseTemplate or tagTemplate`,
    );
  }
  return template;
}

/** A project root with its configuration. */
export type Project = {
  readonly root: string;
  readonly config: Config;
  readonly templates: Templates;
  readonly replacements: readonly Replacement[];
  /** The extra fields with a url, whose references in the notes become links. */
  readonly linkFields: readonly LinkField[];
};

/**
 * Parses fragmentName. Its values are slugs, so only its literal text could
 * add a path separator. The "/" of a closing tag such as {{/pr}} is fine.
 */
function parseFragmentNameTemplate(source: string): Template {
  const template = parseSettingTemplate("fragmentName", source);
  if (/[\\/]/.test(template.literalText)) {
    throw new Error("fragmentName must not contain path separators");
  }
  return template;
}

/**
 * Parses a template that may only use the given values. Mustache renders an
 * unknown value as empty, so a typo would otherwise vanish without a trace.
 */
function parseTemplateWithNames(
  setting: string,
  source: string,
  allowed: readonly string[],
): Template {
  const template = parseSettingTemplate(setting, source);
  const unknown = template.names.find((name) => !allowed.includes(name));
  if (unknown !== undefined) {
    throw new Error(
      `${setting}: unknown value {{${unknown}}}, expected one of: ${allowed.join(", ")}`,
    );
  }
  return template;
}

/** Parses a template of a whole release, such as releaseTemplate, which may place the formats as partials. */
function parseLayoutTemplate(setting: string, source: string): Template {
  const template = withContext(setting, () => parseTemplate(source));
  const unknown = template.partials.find(
    (partial) => !RELEASE_PARTIALS.includes(partial),
  );
  if (unknown !== undefined) {
    throw new Error(
      `${setting}: unknown partial {{> ${unknown}}}, expected one of: ${RELEASE_PARTIALS.join(", ")}`,
    );
  }
  return template;
}

/** Parses the arguments of a command of the tag helper. */
const parseCommand = (
  setting: string,
  args: readonly string[],
  allowed: readonly string[],
): Template[] =>
  args.map((arg, index) =>
    parseTemplateWithNames(`${setting}[${index}]`, arg, allowed),
  );

function compileTagHelper(config: Config): TagHelperTemplates {
  const { check, create, env } = config.tagHelper;
  return {
    check:
      check === undefined
        ? undefined
        : parseCommand("tagHelper.check", check, TAG_CHECK_VALUES),
    create: parseCommand("tagHelper.create", create, TAG_CREATE_VALUES),
    env: Object.fromEntries(
      Object.entries(env).map(([name, value]) => [
        name,
        parseTemplateWithNames(
          `tagHelper.env.${name}`,
          value,
          TAG_CHECK_VALUES,
        ),
      ]),
    ),
  };
}

function compileTemplates(config: Config): Templates {
  return {
    fragmentName: parseFragmentNameTemplate(config.fragmentName),
    version: parseTemplateWithNames(
      "versionFormat",
      config.versionFormat,
      RELEASE_VALUES,
    ),
    kind: parseTemplateWithNames("kindFormat", config.kindFormat, ["kind"]),
    change: parseSettingTemplate("changeFormat", config.changeFormat),
    release: parseLayoutTemplate("releaseTemplate", config.releaseTemplate),
    tag: parseLayoutTemplate("tagTemplate", config.tagTemplate),
    tagHelper: compileTagHelper(config),
    link: parseTemplateWithNames("linkFormat", config.linkFormat, [
      ...RELEASE_VALUES,
      "repositoryUrl",
    ]),
  };
}

/** Compiles one replacement, whose template takes the release values. */
function compileReplacement(
  setting: string,
  path: string,
  entry: Config["replacements"][number],
): Replacement {
  return {
    setting,
    path,
    find: withContext(`${setting}.find`, () => compilePattern(entry.find)),
    replace: parseTemplateWithNames(
      `${setting}.replace`,
      entry.replace,
      RELEASE_VALUES,
    ),
  };
}

/**
 * Compiles the replacements of a configuration. None may change the
 * changelog, because the release would overwrite the replacement or the
 * other way round.
 */
function compileReplacements(root: string, config: Config): Replacement[] {
  const changelog = resolve(root, config.changelogPath);
  return config.replacements.map((entry, index) => {
    const setting = `replacements[${index}]`;
    const path = resolve(root, entry.path);
    if (path === changelog) {
      throw new Error(`${setting}.path: the changelog takes no replacements`);
    }
    return compileReplacement(setting, path, entry);
  });
}

/** The digits of an int value, as references write it, such as "42" in "[#42]". */
const INT_VALUE_PATTERN = "\\d+";

/**
 * Compiles the link settings of an extra field. The label defaults to the
 * value itself, and its url may also use repositoryUrl.
 */
function compileLinkField(
  field: Config["extraFields"][number],
  index: number,
): LinkField[] {
  if (field.type !== "string" && field.type !== "int") return [];
  if (field.url === undefined) return [];

  const setting = `extraFields[${index}]`;
  const { key } = field;
  const label = parseTemplateWithNames(
    `${setting}.label`,
    field.label ?? `{{${key}}}`,
    [key],
  );
  const url = parseTemplateWithNames(`${setting}.url`, field.url, [
    key,
    "repositoryUrl",
  ]);
  const valuePattern =
    field.type === "int" ? INT_VALUE_PATTERN : (field.pattern ?? "");
  const recognizer = withContext(`${setting}.label`, () =>
    labelRecognizer(label, key, valuePattern),
  );
  return [{ key, label, url, recognizer }];
}

/** Builds a project from its root directory and the parsed YAML configuration. */
export function createProject(root: string, rawConfig: unknown): Project {
  const config = parseConfig(rawConfig);
  return {
    root,
    config,
    templates: compileTemplates(config),
    replacements: compileReplacements(root, config),
    linkFields: config.extraFields.flatMap(compileLinkField),
  };
}

/** Loads the project whose configuration file sits in the given directory. */
export async function loadProject(root: string): Promise<Project> {
  const path = join(root, CONFIG_FILE);
  const text = await readFile(path, "utf8");
  return withContext(`load ${displayPath(path)}`, () =>
    createProject(root, Bun.YAML.parse(text)),
  );
}

async function findProjectRoot(directory: string): Promise<string | undefined> {
  if (await Bun.file(join(directory, CONFIG_FILE)).exists()) return directory;
  const parent = dirname(directory);
  return parent === directory ? undefined : findProjectRoot(parent);
}

/** Loads the nearest project at or above the given directory. */
export async function openProject(start: string): Promise<Project> {
  const root = await findProjectRoot(resolve(start));
  if (root === undefined) {
    throw new Error(
      `find ${CONFIG_FILE}: none in ${displayPath(start)} or above, run "wlz init" first`,
    );
  }
  return loadProject(root);
}

export const changesPath = (project: Project): string =>
  resolve(project.root, CHANGES_DIR);

export const unreleasedPath = (project: Project): string =>
  resolve(changesPath(project), project.config.unreleasedDir);

export const changelogPath = (project: Project): string =>
  resolve(project.root, project.config.changelogPath);

/** The draft that "new --edit" keeps until the change is recorded. */
export const DRAFT_FILE = ".draft.md";

export const draftPath = (project: Project): string =>
  join(changesPath(project), DRAFT_FILE);
