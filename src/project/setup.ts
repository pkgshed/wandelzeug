/**
 * Setting up a project with "wlz init", including the onboarding of
 * an existing changelog.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { anchorMarker, hasAnchor, type Release } from "../changelog/markers.ts";
import {
  displayPath,
  readOptionalFile,
  UsageError,
  writeNewFile,
} from "../shared/foundations.ts";
import { compareVersions, parseVersion } from "../shared/versions.ts";
import { CONFIG_FILE } from "./config.ts";
import {
  changelogPath,
  changesPath,
  createProject,
  DRAFT_FILE,
  unreleasedPath,
} from "./root.ts";

/** The header that "wlz init" writes into a new changelog. */
export const INIT_HEADER =
  "# Changelog\n\nAll notable changes to this project are documented in this file.\n";

/** The configuration that "wlz init" writes. It spells out every default. */
export const INIT_CONFIG = `# Configuration for wandelzeug. Paths are relative to the project root,
# the directory that holds .changes.

# Directory below .changes for unreleased change files.
unreleasedDir: unreleased
# Changelog that "wlz batch" adds each release to, right below the
# <!-- wlz:releases --> anchor.
changelogPath: CHANGELOG.md
# Prefix for computed versions and the {{version}} value.
versionPrefix: v

# Templates use Mustache (https://mustache.github.io/mustache.5.html)
# without HTML escaping. {{name}} inserts a value, and a section such as
# {{#pr}}...{{/pr}} renders only when pr has a value.

# Fragment file name between the "nnn-" sequence prefix and ".md".
# Values: title from the first body line, kind, and any front matter key
# such as pr. Every value becomes a lower-case slug.
fragmentName: "{{kind}}-{{title}}"
# Maximum length of the title slug.
titleMaxLength: 48

# Heading of a release. Values: version and date.
versionFormat: "## {{version}} - {{date}}"
# Heading of a kind section. Value: kind.
kindFormat: "### {{kind}}"
# One change entry. Values: body, kind, and any front matter key, as in
# "{{body}}{{#pr}} (#{{pr}}){{/pr}}".
changeFormat: "{{body}}"

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
  /^#{1,6}\s+\[?(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\]?(?:\s|$)/;

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

/** A changelog from before wandelzeug with the release anchor added. */
export type Onboarding = {
  readonly text: string;
  /** The line of the anchor, counting from 1. */
  readonly anchorLine: number;
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
 * Adds the release anchor to a changelog from before wandelzeug. The anchor
 * goes above the first heading that names a version, such as "## 1.4.2" or
 * "## [1.4.2]". The newest stable version among those headings becomes the
 * baseline unless one is given. Without such a heading, the anchor goes to
 * the end. Apart from the anchor and the blank lines around it, no line
 * changes.
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
  const result = insertLinesAt(lines, position, [anchor, ""]);
  return {
    text: result.join(text.includes("\r\n") ? "\r\n" : "\n"),
    anchorLine: result.indexOf(anchor) + 1,
    baseline: baselineName,
  };
}

const newChangelog = (baseline: string | undefined): string =>
  `${INIT_HEADER}\n${anchorMarker(baseline)}\n`;

/** What init does to the changelog, planned before anything is written. */
type ChangelogSetup = InitResult & {
  /** The text to write, or undefined to leave the file as it is. */
  readonly content: string | undefined;
};

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

  if (hasAnchor(existing)) {
    if (baseline !== undefined) {
      throw new UsageError(
        `init: ${displayPath(path)} has a release anchor already, change its baseline there`,
      );
    }
    return {
      path,
      action: "kept",
      detail: "it has a release anchor already",
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
  const baselineNote =
    onboarding.baseline === undefined
      ? "without a baseline"
      : `with baseline ${onboarding.baseline}`;
  return {
    path,
    action: "updated",
    detail: `added the release anchor on line ${onboarding.anchorLine} ${baselineNote}`,
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

/**
 * Sets up wandelzeug in a directory: the configuration, the unreleased
 * directory, and a changelog with the release anchor. An existing changelog
 * only gets the anchor added, as onboardChangelog describes. Fails when a
 * configuration exists already, before it writes anything.
 */
export async function initProject(
  directory: string,
  baseline?: Release,
): Promise<InitResult[]> {
  const configPath = join(directory, CONFIG_FILE);
  if (await Bun.file(configPath).exists()) {
    throw new Error(`init: ${displayPath(configPath)} exists already`);
  }

  const project = createProject(directory, Bun.YAML.parse(INIT_CONFIG));
  const changelog = await planChangelogSetup(changelogPath(project), baseline);
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, INIT_CONFIG, { flag: "wx" });
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
    { path: configPath, action: "created", detail: undefined },
    ...results,
    await applyChangelogSetup(changelog),
  ];
}
