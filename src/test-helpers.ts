/**
 * Helpers that the tests share.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  anchorMarker,
  type ChangelogDocument,
  parseChangelog,
  type Release,
} from "./changelog/markers.ts";
import {
  parseReleaseTarget,
  type ReleaseTarget,
} from "./changelog/releases.ts";
import type { Change, Metadata } from "./changes/fragments.ts";
import { type GitRef, parseGitRef } from "./project/checks.ts";
import { CONFIG_FILE } from "./project/config.ts";
import { createProject } from "./project/root.ts";
import {
  type IsoDate,
  parseIsoDate,
  parseVersion,
  type Version,
} from "./shared/versions.ts";

export const SCRIPT = join(import.meta.dir, "cli.ts");

export function isoDate(text: string): IsoDate {
  const date = parseIsoDate(text);
  if (date === undefined) throw new Error(`test date ${text} is invalid`);
  return date;
}

export function version(text: string): Version {
  const parsed = parseVersion(text);
  if (parsed === undefined) throw new Error(`test version ${text} is invalid`);
  return parsed;
}

export function releaseTarget(text: string): ReleaseTarget {
  const target = parseReleaseTarget(text);
  if (target === undefined) throw new Error(`test target ${text} is invalid`);
  return target;
}

export const change = (
  kind: string,
  body: string,
  metadata: Metadata = {},
): Change => ({
  kind,
  metadata,
  body,
});

export const release = (name: string): Release => ({
  name,
  version: version(name),
});

/** Parses a changelog that the test expects to be free of marker problems. */
export function changelogDocument(text: string): ChangelogDocument {
  const parsed = parseChangelog(text);
  if (!parsed.ok) throw new Error(parsed.problems.join("\n"));
  return parsed.document;
}

/** Writes a changelog with the anchor and the given lines below it. */
export const writeChangelog = (
  root: string,
  ...lines: string[]
): Promise<void> =>
  writeFile(
    join(root, "CHANGELOG.md"),
    ["# Changelog", "", anchorMarker(undefined), "", ...lines, ""].join("\n"),
  );

/** Writes the configuration file of a project, creating .changes when needed. */
export async function writeConfig(root: string, text: string): Promise<void> {
  const path = join(root, CONFIG_FILE);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

export const projectWith = (settings: Record<string, unknown>) =>
  createProject("/project", settings);

/**
 * Replaces the random ID in fragment file names with "<id>", so tests can
 * compare names such as "001-<id>-fixed-crash.md".
 */
export const maskFragmentIds = (text: string): string =>
  text.replace(/(\d{3})-[0-9a-hjkmnp-tv-z]{5}(?=-|\.md)/g, "$1-<id>");

/** Reads the path that "wlz new" printed after "created". */
export function createdPath(stdout: string): string {
  const path = /^created (.+)$/m.exec(stdout)?.[1];
  if (path === undefined) throw new Error(`no created path in ${stdout}`);
  return path;
}

export function gitRef(text: string): GitRef {
  const ref = parseGitRef(text);
  if (ref === undefined) throw new Error(`test revision ${text} is invalid`);
  return ref;
}

/** Keeps the git configuration of the machine out of the tests. */
export const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
};

/** Runs git with the test configuration and returns its standard output. */
export async function gitOutput(
  directory: string,
  ...args: string[]
): Promise<string> {
  const child = Bun.spawn(["git", ...args], {
    cwd: directory,
    env: GIT_ENV,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (status !== 0) throw new Error(`git ${args.join(" ")}: ${stderr}`);
  return stdout;
}

export async function git(directory: string, ...args: string[]): Promise<void> {
  await gitOutput(directory, ...args);
}

/** Starts a repository on main that holds everything in the directory. */
export async function startRepository(directory: string): Promise<void> {
  await git(directory, "init", "--quiet", "--initial-branch=main");
  await commitAll(directory, "base");
}

export async function commitAll(
  directory: string,
  message: string,
): Promise<void> {
  await git(directory, "add", "--all");
  await git(directory, "commit", "--quiet", "--message", message);
}

export const PR_FIELD_CONFIG = [
  "extraFields:",
  "  - key: pr",
  "    prompt: Pull request number",
  "    type: int",
  "    required: true",
  "",
].join("\n");
