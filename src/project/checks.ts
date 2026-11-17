/**
 * The checks behind "wlz check", including the git comparison.
 */

import { readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { MISSING_CHANGELOG, parseChangelog } from "../changelog/markers.ts";
import { applyExtraFields } from "../changes/fields.ts";
import { isFragmentFile, parseChange } from "../changes/fragments.ts";
import {
  attempt,
  listDirectory,
  readOptionalFile,
} from "../shared/foundations.ts";
import type { Config } from "./config.ts";
import { runGit } from "../shared/git.ts";
import { changelogPath, type Project, unreleasedPath } from "./root.ts";

/** A problem that "wlz check" found in a fragment file. */
export type Problem = {
  readonly path: string;
  readonly message: string;
};

/** What "wlz check" found in the unreleased directory and the changelog. */
export type CheckReport = {
  /** The number of unreleased fragments. */
  readonly checked: number;
  readonly problems: readonly Problem[];
};

async function inspectFragment(
  config: Config,
  path: string,
): Promise<Problem[]> {
  const text = await readFile(path, "utf8");
  const parsed = attempt(() => parseChange(text, config.kinds));
  if (!parsed.ok) {
    return [{ path, message: parsed.error }];
  }

  const { problems } = applyExtraFields(
    config.extraFields,
    parsed.value.metadata,
  );
  return problems.map((message) => ({ path, message }));
}

async function inspectChangelog(project: Project): Promise<Problem[]> {
  const path = changelogPath(project);
  const text = await readOptionalFile(path);
  if (text === undefined) {
    return [{ path, message: MISSING_CHANGELOG }];
  }

  const parsed = parseChangelog(text);
  return parsed.ok ? [] : parsed.problems.map((message) => ({ path, message }));
}

/**
 * Validates every unreleased fragment against the configured kinds and
 * extra fields, and the markers of the changelog. Unlike batch, it reports
 * every problem instead of stopping at the first one.
 */
export async function checkProject(project: Project): Promise<CheckReport> {
  const directory = unreleasedPath(project);
  const fileNames = (await listDirectory(directory)).filter(isFragmentFile);
  const fragmentProblems = await Promise.all(
    fileNames.map((fileName) =>
      inspectFragment(project.config, join(directory, fileName)),
    ),
  );
  return {
    checked: fileNames.length,
    problems: [
      ...fragmentProblems.flat(),
      ...(await inspectChangelog(project)),
    ],
  };
}

/** A git revision that cannot be mistaken for a command line option. */
export type GitRef = string & { readonly __brand: "GitRef" };

/** Parses a git revision. It rejects a leading "-", which git would read as an option. */
export function parseGitRef(text: string): GitRef | undefined {
  const isOptionLike = text.startsWith("-");
  return text === "" || isOptionLike ? undefined : (text as GitRef);
}

/**
 * Lists the fragment files that the commits on HEAD add, modify or rename
 * since HEAD forked from the given revision. The paths are relative to the
 * project root. Uncommitted files do not count.
 */
export async function changedFragments(
  project: Project,
  since: GitRef,
): Promise<string[]> {
  const pathspec = relative(project.root, unreleasedPath(project)) || ".";
  // -z separates the names with NUL bytes, so git never quotes them.
  const output = await runGit(project.root, [
    "diff",
    "-z",
    "--name-only",
    "--relative",
    "--diff-filter=AMR",
    `${since}...HEAD`,
    "--",
    pathspec,
  ]);
  return output
    .split("\0")
    .filter((path) => path !== "" && isFragmentFile(basename(path)));
}
