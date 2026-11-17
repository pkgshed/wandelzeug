/**
 * Setting up a project with "wlz init", including the onboarding of
 * an existing changelog.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  anchorMarker,
  hasMarker,
  LINKS_ANCHOR,
  type Release,
} from "../changelog/markers.ts";
import {
  displayPath,
  readOptionalFile,
  UsageError,
  writeNewFile,
} from "../shared/foundations.ts";
import { readOriginUrl, webUrlOfRemote } from "../shared/git.ts";
import { compareVersions, parseVersion } from "../shared/versions.ts";
import { CONFIG_FILE, DEFAULT_CONFIG } from "./config.ts";
import {
  changelogPath,
  changesPath,
  createProject,
  DRAFT_FILE,
  unreleasedPath,
} from "./root.ts";

/**
 * The header that "wlz init" writes into a new changelog. It names the
 * formats that the default settings follow.
 */
export const INIT_HEADER = [
  "# Changelog",
  "",
  "All notable changes to this project are documented in this file.",
  "",
  "The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).",
  "",
].join("\n");

/** Formats a string as a YAML scalar. JSON strings are valid YAML. */
const yamlString = (text: string): string => JSON.stringify(text);

/**
 * The configuration that "wlz init" writes. It spells out every default,
 * and the repository URL that init found.
 */
export const initConfig = (
  repositoryUrl: string,
): string => `# Configuration for wandelzeug. Paths are relative to the project root,
# the directory that holds .changes.

# Directory below .changes for unreleased change files.
unreleasedDir: unreleased
# Changelog that "wlz batch" adds each release to, right below the
# <!-- wlz:releases --> anchor, with its link below <!-- wlz:links -->.
changelogPath: CHANGELOG.md
# Prefix of release names and the {{version}} value, as in "1.1.2".
versionPrefix: ""
# Prefix of git tags and the {{tag}} value, as in "v1.1.2".
tagPrefix: v
# Web address of the repository for the compare links. While it is empty,
# the default linkFormat stays off.
repositoryUrl: ${yamlString(repositoryUrl)}

# Templates use Mustache (https://mustache.github.io/mustache.5.html)
# without HTML escaping. {{name}} inserts a value, and a section such as
# {{#pr}}...{{/pr}} renders only when pr has a value.

# Fragment file name between the "nnn-" sequence prefix and ".md".
# Values: title from the first body line, kind, and any front matter key
# such as pr. Every value becomes a lower-case slug.
fragmentName: ${yamlString(DEFAULT_CONFIG.fragmentName)}
# Maximum length of the title slug.
titleMaxLength: ${DEFAULT_CONFIG.titleMaxLength}

# Heading of a release. Values: version, date, tag, previousVersion and
# previousTag. The brackets make the version a link to its definition.
versionFormat: ${yamlString(DEFAULT_CONFIG.versionFormat)}
# Heading of a kind section. Value: kind.
kindFormat: ${yamlString(DEFAULT_CONFIG.kindFormat)}
# One change entry. Values: body, kind, and any front matter key, as in
# "{{body}}{{#pr}} (#{{pr}}){{/pr}}".
changeFormat: ${yamlString(DEFAULT_CONFIG.changeFormat)}

# The whole release. It places the three formats above as the partials
# {{> version}}, {{> kind}} and {{> change}}, each as whole lines, and
# loops over kinds, which hold a kind and its changes. To change a detail,
# edit a format. To change the layout, replace this template.
releaseTemplate: |
  {{> version}}
  {{#kinds}}

  {{> kind}}

  {{#changes}}
  {{> change}}
  {{/changes}}
  {{/kinds}}

# Link definition of a release, below the <!-- wlz:links --> anchor. It
# compares the tag with the previous tag, or links the tag of a first
# release. Values: those of versionFormat and repositoryUrl. An empty
# linkFormat turns links off.
linkFormat: ${yamlString(DEFAULT_CONFIG.linkFormat)}

# Command that "wlz release" runs to tag a release, such as semverkzeug
# (https://github.com/0x5a17ed/semverkzeug). It runs through the shell, so
# it may carry arguments, and it must accept "bump PART" with the options
# --expect, --message-file and --dry-run.
tagHelper: ${yamlString(DEFAULT_CONFIG.tagHelper)}

# Kinds in changelog order. A bump lets "auto" pick the next version.
kinds:
  - label: Added
    bump: minor
  - label: Changed
    bump: major
  - label: Deprecated
    bump: minor
  - label: Removed
    bump: major
  - label: Fixed
    bump: patch
  - label: Security
    bump: patch

# Front matter entries besides kind that "new" asks for and "check"
# validates. Their values sit at the top level of the front matter, next to
# kind. Each entry has a key, a prompt (default: the key), a type (default:
# string), and whether it is required (default: false). The types are:
#
#   string  one line of text, limited by minLength and maxLength
#   block   several lines of text, limited by minLength and maxLength
#   int     a whole number, limited by minInt and maxInt; "#42" counts as 42
#   enum    one of enumOptions
#   enums   any of enumOptions, stored as one comma-separated string
#
# For example:
#
# extraFields:
#   - key: pr
#     prompt: Pull request number
#     type: int
#     minInt: 1
#     required: true
#   - key: area
#     type: enum
#     enumOptions: [cli, docs, tests]
extraFields: []
`;

/** The ignore file that keeps the draft of "new --edit" out of version control. */
const INIT_GITIGNORE = `# The draft that "wlz new --edit" keeps until the change is recorded.
/${DRAFT_FILE}
`;

/** What "wlz init" did to a file. */
export type InitAction = "created" | "kept" | "updated";

/** A file that "wlz init" looked after, and what it did. */
export type InitResult = {
  readonly path: string;
  readonly action: InitAction;
  /** What happened beyond the action, such as where the anchor went. */
  readonly detail: string | undefined;
};

type InitFile = {
  readonly path: string;
  readonly content: string;
};

async function createIfMissing(file: InitFile): Promise<InitResult> {
  const created = await writeNewFile(file.path, file.content);
  return {
    path: file.path,
    action: created ? "created" : "kept",
    detail: undefined,
  };
}

const RELEASE_HEADING =
  /^#{1,6}\s+\[?`?(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)`?\]?(?:\s|$)/;

/** A link definition whose label names a version, such as "[1.4.2]: https://...". */
const VERSION_LINK = /^\[`?v?\d+\.\d+\.\d+[^\]]*\]:\s*\S/;

/** A heading from before wandelzeug that names a version. */
type LegacyHeading = {
  readonly index: number;
  readonly release: Release;
};

function findLegacyHeadings(lines: readonly string[]): LegacyHeading[] {
  return lines.flatMap((line, index) => {
    const name = RELEASE_HEADING.exec(line)?.[1];
    const version = name === undefined ? undefined : parseVersion(name);
    if (name === undefined || version === undefined) return [];
    return [{ index, release: { name, version } }];
  });
}

/** Inserts lines before an index, with a blank line between them and any text above. */
function insertLinesAt(
  lines: readonly string[],
  index: number,
  inserted: readonly string[],
): string[] {
  const before = lines.slice(0, index);
  const lastBefore = before.at(-1);
  const needsGap = lastBefore !== undefined && lastBefore.trim() !== "";
  return [
    ...before,
    ...(needsGap ? [""] : []),
    ...inserted,
    ...lines.slice(index),
  ];
}

/**
 * Adds the links anchor below the release anchor: right above the first
 * link definition that names a version, so an "[unreleased]" definition
 * stays on top, or else at the end.
 */
function insertLinksAnchor(lines: readonly string[], anchor: number): string[] {
  const definition = lines.findIndex(
    (line, index) => index > anchor && VERSION_LINK.test(line),
  );
  if (definition === -1) {
    return insertLinesAt(lines, lines.length, [LINKS_ANCHOR, ""]);
  }
  return [
    ...lines.slice(0, definition),
    LINKS_ANCHOR,
    ...lines.slice(definition),
  ];
}

/** A changelog from before wandelzeug with the anchors added. */
export type Onboarding = {
  readonly text: string;
  /** The line of the release anchor, counting from 1. */
  readonly anchorLine: number;
  /** The line of the links anchor, counting from 1. */
  readonly linksLine: number;
  readonly baseline: string | undefined;
};

/**
 * Picks the newest stable release, or the newest prerelease when there is no
 * stable one. Bumps start from stable releases, so a prerelease baseline
 * would make "next" start over from 0.0.0.
 */
function pickBaseline(releases: readonly Release[]): Release | undefined {
  const newestFirst = [...releases].sort((a, b) =>
    compareVersions(b.version, a.version),
  );
  const newestStable = newestFirst.find(
    (release) => release.version.prerelease === undefined,
  );
  return newestStable ?? newestFirst[0];
}

/**
 * Adds the anchors to a changelog from before wandelzeug. The release anchor
 * goes above the first heading that names a version, such as "## 1.4.2" or
 * "## [1.4.2]". The newest stable version among those headings becomes the
 * baseline unless one is given. Without such a heading, the anchor goes to
 * the end. The links anchor follows as insertLinksAnchor describes. Apart
 * from the anchors and the blank lines around them, no line changes.
 */
export function onboardChangelog(
  text: string,
  baseline: Release | undefined,
): Onboarding {
  const lines = text.split(/\r?\n/);
  const headings = findLegacyHeadings(lines);
  const detected = pickBaseline(headings.map((heading) => heading.release));
  const baselineName = baseline?.name ?? detected?.name;

  const anchor = anchorMarker(baselineName);
  const position = headings[0]?.index ?? lines.length;
  const withAnchor = insertLinesAt(lines, position, [anchor, ""]);
  const result = insertLinksAnchor(withAnchor, withAnchor.indexOf(anchor));
  return {
    text: result.join(text.includes("\r\n") ? "\r\n" : "\n"),
    anchorLine: result.indexOf(anchor) + 1,
    linksLine: result.indexOf(LINKS_ANCHOR) + 1,
    baseline: baselineName,
  };
}

const newChangelog = (baseline: string | undefined): string =>
  `${INIT_HEADER}\n${anchorMarker(baseline)}\n\n${LINKS_ANCHOR}\n`;

/** What init does to the changelog, planned before anything is written. */
type ChangelogSetup = InitResult & {
  /** The text to write, or undefined to leave the file as it is. */
  readonly content: string | undefined;
};

function describeOnboarding(onboarding: Onboarding): string {
  const baseline =
    onboarding.baseline === undefined
      ? "without a baseline"
      : `with baseline ${onboarding.baseline}`;
  return `added the release anchor on line ${onboarding.anchorLine} ${baseline}, and the links anchor on line ${onboarding.linksLine}`;
}

async function planChangelogSetup(
  path: string,
  baseline: Release | undefined,
): Promise<ChangelogSetup> {
  const existing = await readOptionalFile(path);
  if (existing === undefined) {
    return {
      path,
      action: "created",
      detail: undefined,
      content: newChangelog(baseline?.name),
    };
  }

  const hasAnchors =
    hasMarker(existing, "anchor") || hasMarker(existing, "links");
  if (hasAnchors) {
    if (baseline !== undefined) {
      throw new UsageError(
        `init: ${displayPath(path)} has wlz anchors already, change its baseline there`,
      );
    }
    return {
      path,
      action: "kept",
      detail: "it has wlz anchors already",
      content: undefined,
    };
  }

  if (existing.trim() === "") {
    return {
      path,
      action: "updated",
      detail: "filled the empty file",
      content: newChangelog(baseline?.name),
    };
  }

  const onboarding = onboardChangelog(existing, baseline);
  return {
    path,
    action: "updated",
    detail: describeOnboarding(onboarding),
    content: onboarding.text,
  };
}

async function applyChangelogSetup(setup: ChangelogSetup): Promise<InitResult> {
  if (setup.content !== undefined) {
    const flag = setup.action === "created" ? "wx" : "w";
    await writeFile(setup.path, setup.content, { flag });
  }
  return {
    path: setup.path,
    action: setup.action,
    detail: setup.detail,
  };
}

/** The repository URL for the configuration, and how init found it. */
type RepositorySource = {
  readonly url: string;
  readonly note: string;
};

/**
 * Picks the repository URL: the given one, or the web address of the origin
 * remote. It never repeats the remote itself, which may hold credentials.
 */
async function findRepositoryUrl(
  directory: string,
  given: string | undefined,
): Promise<RepositorySource> {
  if (given !== undefined) {
    return { url: given, note: `repositoryUrl ${given} from --repository` };
  }

  const remote = await readOriginUrl(directory);
  const url = remote === undefined ? undefined : webUrlOfRemote(remote);
  if (url !== undefined) {
    return { url, note: `repositoryUrl ${url} from the origin remote` };
  }
  const reason =
    remote === undefined
      ? "no origin remote"
      : "the origin remote has no web address";
  return {
    url: "",
    note: `${reason}, so links stay off until you set repositoryUrl`,
  };
}

/** The choices of "wlz init" that override what it would detect. */
export type InitOptions = {
  /** The newest release from before wandelzeug. */
  readonly baseline?: Release | undefined;
  /** The web address of the repository for compare links. */
  readonly repositoryUrl?: string | undefined;
};

/**
 * Sets up wandelzeug in a directory: the configuration, the unreleased
 * directory, and a changelog with the anchors. An existing changelog only
 * gets the anchors added, as onboardChangelog describes. Fails when a
 * configuration exists already, before it writes anything.
 */
export async function initProject(
  directory: string,
  options: InitOptions = {},
): Promise<InitResult[]> {
  const configPath = join(directory, CONFIG_FILE);
  if (await Bun.file(configPath).exists()) {
    throw new Error(`init: ${displayPath(configPath)} exists already`);
  }

  const repository = await findRepositoryUrl(directory, options.repositoryUrl);
  const config = initConfig(repository.url);
  const project = createProject(directory, Bun.YAML.parse(config));
  const changelog = await planChangelogSetup(
    changelogPath(project),
    options.baseline,
  );
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, config, { flag: "wx" });
  await mkdir(unreleasedPath(project), { recursive: true });

  const files: readonly InitFile[] = [
    {
      path: join(unreleasedPath(project), ".gitkeep"),
      content: "",
    },
    {
      path: join(changesPath(project), ".gitignore"),
      content: INIT_GITIGNORE,
    },
  ];
  const results = await Promise.all(files.map(createIfMissing));
  return [
    { path: configPath, action: "created", detail: repository.note },
    ...results,
    await applyChangelogSetup(changelog),
  ];
}
