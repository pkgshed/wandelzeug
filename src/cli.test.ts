import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { version as packageVersion } from "../package.json" with { type: "json" };
import { notesHash } from "./changelog/data.ts";
import {
  commitAll,
  git,
  gitOutput,
  GIT_ENV,
  PR_FIELD_CONFIG,
  SCRIPT,
  startRepository,
  writeConfig,
} from "./test-helpers.ts";

const PACKAGE_JSON = (version: string): string =>
  `{\n  "name": "demo",\n  "version": "${version}"\n}\n`;

describe("command line", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "wandelzeug-cli-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function runWith(env: Record<string, string>, ...args: string[]) {
    const child = Bun.spawn([process.execPath, SCRIPT, ...args], {
      cwd: root,
      // FORCE_COLOR=0 keeps colours out of the output, whatever the shell sets.
      env: { ...GIT_ENV, VISUAL: "", EDITOR: "", FORCE_COLOR: "0", ...env },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, exitCode };
  }

  const run = (...args: string[]) => runWith({}, ...args);

  const unreleasedFiles = async (): Promise<string[]> =>
    (await readdir(join(root, ".changes", "unreleased"))).sort();

  /** Sets EDITOR to a script that saves the draft it sees and writes the given text instead. */
  async function editorWriting(text: string): Promise<Record<string, string>> {
    await writeFile(join(root, "prepared.md"), text);
    await writeFile(
      join(root, "edit.sh"),
      'cp "$1" seen-draft.md\ncp prepared.md "$1"\n',
    );
    return { EDITOR: "sh edit.sh" };
  }

  /** Replaces text in the configuration that init wrote. */
  async function editConfig(search: string, replacement: string) {
    const path = join(root, ".changes/config.yaml");
    const config = await readFile(path, "utf8");
    await writeFile(path, config.replace(search, replacement));
  }

  /** Has init set up a project whose package.json version follows each release. */
  async function projectWithPackageVersion(): Promise<void> {
    await run("init");
    await writeFile(join(root, "package.json"), PACKAGE_JSON("0.0.0"));
    await editConfig(
      "replacements: []",
      [
        "replacements:",
        "  - path: package.json",
        `    find: '"version": "[^"]*"'`,
        `    replace: '"version": "{{version}}"'`,
      ].join("\n"),
    );
  }

  test("--version prints the version of the package", async () => {
    expect(await run("--version")).toMatchObject({
      exitCode: 0,
      stdout: `${packageVersion}\n`,
    });
  });

  test("--help lists the commands", async () => {
    const result = await run("--help");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: wlz COMMAND [OPTIONS]");
    expect(result.stdout).toMatch(/^ {2}release +Add the unreleased changes/m);
  });

  test.each([
    [["new", "--help"]],
    [["help", "new"]],
    [["new", "-k", "Added", "-h"]],
  ])("%p shows the help of new alone", async (args) => {
    const result = await run(...args);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toStartWith(
      "Record a change in the unreleased directory\nUsage: wlz new",
    );
    expect(result.stdout).toContain("-m, --meta KEY=VALUE");
    expect(result.stdout).not.toContain("--dry-run");
  });

  test("help takes colours where they are wanted", async () => {
    const plain = await run("release", "--help");
    expect(plain.stdout).not.toContain("\x1b[");

    const coloured = await runWith({ FORCE_COLOR: "1" }, "release", "--help");
    expect(coloured.exitCode).toBe(0);
    // Cargo's styles: bold bright green headers, bold bright cyan literals, cyan placeholders.
    expect(coloured.stdout).toContain("\x1b[1;92mUsage:\x1b[0m");
    expect(coloured.stdout).toContain("\x1b[1;96m--dry-run\x1b[0m");
    expect(coloured.stdout).toContain("\x1b[36mDATE\x1b[0m");
  });

  test("completion prints a script that registers wlz", async () => {
    const result = await run("completion", "bash");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("complete -o filenames -F _wlz -- wlz");
  });

  /** Asks for the suggestions that the bash script shows for the given words. */
  async function suggestions(...words: string[]): Promise<string[]> {
    const result = await run("completion", "bash", ...words);
    return result.stdout.split("\n").filter((line) => line !== "");
  }

  test.each([
    [["re"], ["release", "render"]],
    [
      ["release", "m"],
      ["major", "minor"],
    ],
    [["batch", "p"], ["patch"]],
    [["new", "--k"], ["--kind"]],
    [["new", "--edit", "--r"], []],
  ])("completing %p suggests %p", async (words, expected) => {
    expect(await suggestions(...words)).toEqual(expected);
  });

  test("completing -C asks the shell for directories", async () => {
    expect(await suggestions("new", "-C", "sr")).toEqual([
      "__FILE__:directory::sr:0",
    ]);
  });

  test("no command is a usage error", async () => {
    expect(await run()).toMatchObject({
      exitCode: 2,
      stderr: 'wlz: missing command\nRun "wlz --help" for usage.\n',
    });
  });

  test("new records a fragment from options", async () => {
    await run("init");
    const result = await run(
      "new",
      "-k",
      "fixed",
      "-b",
      "* Crash on start",
      "-m",
      "pr=7",
      "-m",
      "mr=",
    );
    expect(result).toMatchObject({
      exitCode: 0,
      stdout: "created .changes/unreleased/001-fixed-crash-on-start.md\n",
    });
    const text = await readFile(
      join(root, ".changes/unreleased/001-fixed-crash-on-start.md"),
      "utf8",
    );
    expect(text).toBe("---\nkind: Fixed\npr: 7\n---\n* Crash on start\n");
  });

  test("new without a terminal needs --kind", async () => {
    await run("init");
    const result = await run("new", "-b", "* Crash");
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("missing --kind");
  });

  test("batch --dry-run prints the release and keeps the fragments", async () => {
    await run("init", "--repository", "https://codeberg.org/o/r/");
    await run("new", "-k", "Added", "-b", "* Feature");
    const result = await run(
      "batch",
      "minor",
      "--date",
      "2026-11-17",
      "--dry-run",
    );
    expect(result).toMatchObject({
      exitCode: 0,
      stdout: [
        "<!-- BEGIN wlz:release 0.1.0",
        "date: 2026-11-17",
        `hash: ${notesHash("## [`0.1.0`] (2026-11-17)\n\n### Added\n\n* Feature")}`,
        "changes:",
        "  - kind: Added",
        '    body: "* Feature"',
        "-->",
        "## [`0.1.0`] (2026-11-17)",
        "",
        "### Added",
        "",
        "* Feature",
        "<!-- END wlz:release 0.1.0 -->",
        "",
        "[`0.1.0`]: https://codeberg.org/o/r/releases/tag/v0.1.0",
        "",
      ].join("\n"),
    });
    expect(await readdir(join(root, ".changes/unreleased"))).toContain(
      "001-added-feature.md",
    );
    expect(await readFile(join(root, "CHANGELOG.md"), "utf8")).not.toContain(
      "0.1.0",
    );
  });

  test("batch updates the files of the replacements", async () => {
    await projectWithPackageVersion();
    await run("new", "-k", "Added", "-b", "* Feature");
    const result = await run("batch", "minor");

    expect(result).toMatchObject({
      exitCode: 0,
      stdout: "updated CHANGELOG.md from 1 change\nupdated package.json\n",
    });
    expect(await readFile(join(root, "package.json"), "utf8")).toBe(
      PACKAGE_JSON("0.1.0"),
    );
  });

  test("batch changes nothing when a replacement finds no match", async () => {
    await projectWithPackageVersion();
    await writeFile(join(root, "package.json"), "{}\n");
    await run("new", "-k", "Added", "-b", "* Feature");
    const result = await run("batch", "minor");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "replace in package.json: replacements[0].find: no match",
    );
    expect(await unreleasedFiles()).toContain("001-added-feature.md");
    expect(await readFile(join(root, "CHANGELOG.md"), "utf8")).not.toContain(
      "0.1.0",
    );
  });

  test("next and latest start from the baseline of an onboarded changelog", async () => {
    await writeFile(join(root, "CHANGELOG.md"), "# History\n\n## [1.2.3]\n");
    expect((await run("init")).stdout).toContain(
      "updated CHANGELOG.md (added the release anchor on line 3 with baseline 1.2.3, and the link markers on line 7)",
    );
    expect((await run("latest")).stdout).toBe("1.2.3\n");
    expect((await run("next", "major")).stdout).toBe("2.0.0\n");
  });

  test("init takes the repository URL from the origin remote", async () => {
    await git(root, "init", "--quiet");
    await git(root, "remote", "add", "origin", "git@codeberg.org:o/r.git");
    expect((await run("init")).stdout).toContain(
      "created .changes/config.yaml (repositoryUrl https://codeberg.org/o/r from the origin remote)",
    );
  });

  test("init without an origin remote leaves links off", async () => {
    expect((await run("init")).stdout).toContain(
      "created .changes/config.yaml (no origin remote, so links stay off until you set repositoryUrl)",
    );
  });

  test("show prints the notes of a release", async () => {
    await run("init", "--baseline", "1.0.0");
    await run("new", "-k", "Fixed", "-b", "* Crash");
    await run("batch", "patch", "--date", "2026-11-17");
    expect((await run("latest")).stdout).toBe("1.0.1\n");

    expect(await run("show", "1.0.1")).toMatchObject({
      exitCode: 0,
      stdout: "## [`1.0.1`] (2026-11-17)\n\n### Fixed\n\n* Crash\n",
    });
    const baseline = await run("show", "1.0.0");
    expect(baseline.exitCode).toBe(1);
    expect(baseline.stderr).toContain(
      "show: release 1.0.0 predates wandelzeug and has no markers",
    );
    const missing = await run("show", "v9.9.9");
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain(
      "show: no marked release v9.9.9 in CHANGELOG.md",
    );
  });

  test.each([
    [["frobnicate"], /Unexpected option or subcommand: `frobnicate`/],
    [["batch"], /Expected a `VERSION`, but too few arguments/],
    [
      ["batch", "1.0"],
      /`VERSION`: expected a semantic version or one of: major, minor, patch, auto, but got "1\.0"/,
    ],
    [
      ["next", "huge"],
      /`BUMP`: Expected one of "major", "minor", "patch", and "auto", but got "huge"/,
    ],
    [["latest", "--nope"], /Unexpected option or subcommand: `--nope`/],
    [
      ["init", "--repository", "codeberg.org/o/r"],
      /`--repository`: expected an http or https address/,
    ],
  ])("%p is a usage error", async (args, message) => {
    await run("init");
    const result = await run(...args);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(message);
  });

  test("a command outside a project explains how to start one", async () => {
    const result = await run("latest");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('run "wlz init" first');
  });

  test("new without a terminal needs every required field", async () => {
    await run("init");
    await writeConfig(root, PR_FIELD_CONFIG);
    const missing = await run("new", "-k", "fixed", "-b", "* Crash");
    expect(missing.exitCode).toBe(2);
    expect(missing.stderr).toContain('missing required field "pr"');

    const given = await run(
      "new",
      "-k",
      "fixed",
      "-b",
      "* Crash",
      "-m",
      "pr=#42",
    );
    expect(given.exitCode).toBe(0);
    const text = await readFile(
      join(root, ".changes/unreleased/001-fixed-crash.md"),
      "utf8",
    );
    expect(text).toBe("---\nkind: Fixed\npr: 42\n---\n* Crash\n");
  });

  test("new --edit records the change written in the editor", async () => {
    await run("init");
    await writeConfig(root, PR_FIELD_CONFIG);
    const editor = await editorWriting(
      "---\nkind: Fixed\npr: '#7'\n---\n* Crash on start\n",
    );

    const result = await runWith(editor, "new", "--edit", "-k", "fixed");
    expect(result).toMatchObject({
      exitCode: 0,
      stdout: "created .changes/unreleased/001-fixed-crash-on-start.md\n",
    });
    expect(await readFile(join(root, "seen-draft.md"), "utf8")).toContain(
      "kind: Fixed\npr: # Pull request number (int, required)\n---\n* \n",
    );
    expect(await Bun.file(join(root, ".changes/.draft.md")).exists()).toBe(
      false,
    );
    const text = await readFile(
      join(root, ".changes/unreleased/001-fixed-crash-on-start.md"),
      "utf8",
    );
    expect(text).toBe("---\nkind: Fixed\npr: 7\n---\n* Crash on start\n");
  });

  test("new --edit records nothing when the body stays empty", async () => {
    await run("init");
    const result = await runWith({ EDITOR: "true" }, "new", "--edit");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("new: empty change, nothing recorded");
    expect(await unreleasedFiles()).toEqual([".gitkeep"]);
    expect(await Bun.file(join(root, ".changes/.draft.md")).exists()).toBe(
      false,
    );
  });

  test("new --resume recovers a draft that had problems", async () => {
    await run("init");
    await writeConfig(root, PR_FIELD_CONFIG);
    const draft = join(root, ".changes/.draft.md");

    const missingPr = await editorWriting("---\nkind: Fixed\n---\n* Crash\n");
    const failed = await runWith(missingPr, "new", "--edit");
    expect(failed.exitCode).toBe(1);
    expect(failed.stderr).toContain('missing required field "pr"');
    expect(failed.stderr).toContain(
      'The draft stays in .changes/.draft.md. Run "wlz new --resume" to continue it.',
    );
    expect(await readFile(draft, "utf8")).toBe(
      "---\nkind: Fixed\n---\n* Crash\n",
    );
    expect(await unreleasedFiles()).toEqual([".gitkeep"]);

    const refused = await runWith(missingPr, "new", "--edit");
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr).toContain(
      "an earlier draft waits in .changes/.draft.md",
    );

    const addPr = { EDITOR: `sed -i "s/^kind: Fixed$/kind: Fixed\\npr: 9/"` };
    const resumed = await runWith(addPr, "new", "--resume");
    expect(resumed).toMatchObject({
      exitCode: 0,
      stdout: "created .changes/unreleased/001-fixed-crash.md\n",
    });
    expect(
      await readFile(
        join(root, ".changes/unreleased/001-fixed-crash.md"),
        "utf8",
      ),
    ).toBe("---\nkind: Fixed\npr: 9\n---\n* Crash\n");
    expect(await Bun.file(draft).exists()).toBe(false);
  });

  test("new --edit keeps the draft when the editor fails", async () => {
    await run("init");
    const result = await runWith(
      { EDITOR: "false" },
      "new",
      "--edit",
      "-k",
      "fixed",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('run editor "false": exit status 1');
    expect(result.stderr).toContain('Run "wlz new --resume" to continue it.');
    expect(await readFile(join(root, ".changes/.draft.md"), "utf8")).toContain(
      "kind: Fixed\n",
    );
  });

  test("new --resume needs a kept draft", async () => {
    await run("init");
    const result = await runWith({ EDITOR: "true" }, "new", "--resume");
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      "new --resume: no draft in .changes/.draft.md",
    );
  });

  test("init keeps drafts out of version control", async () => {
    await run("init");
    expect(await readFile(join(root, ".changes/.gitignore"), "utf8")).toContain(
      "/.draft.md\n",
    );
  });

  test("new --edit needs an editor", async () => {
    await run("init");
    const result = await run("new", "--edit");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("set VISUAL or EDITOR");
  });

  test("check accepts valid changes", async () => {
    await run("init");
    await run("new", "-k", "Added", "-b", "* Feature");
    expect(await run("check")).toMatchObject({
      exitCode: 0,
      stdout: "checked 1 change\n",
    });
  });

  test("check lists the problems of every change", async () => {
    await run("init");
    await writeFile(
      join(root, ".changes/unreleased/001-broken.md"),
      "* no front matter\n",
    );
    await writeFile(
      join(root, ".changes/unreleased/002-odd.md"),
      "---\nkind: Odd\n---\n* Odd\n",
    );
    const result = await run("check");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      ".changes/unreleased/001-broken.md: missing front matter",
    );
    expect(result.stderr).toContain(
      '.changes/unreleased/002-odd.md: unknown kind "Odd"',
    );
    expect(result.stderr).toContain("wlz: check: 2 problems");
  });

  test("check --since requires a committed change on the branch", async () => {
    await run("init");
    await startRepository(root);
    await git(root, "switch", "--quiet", "--create", "feature");

    const before = await run("check", "--since", "main");
    expect(before.exitCode).toBe(1);
    expect(before.stderr).toContain(
      ".changes/unreleased: no change file added or modified since main",
    );

    await run("new", "-k", "Fixed", "-b", "* Crash");
    await commitAll(root, "record a change");
    expect(await run("check", "--since", "main")).toMatchObject({
      exitCode: 0,
      stdout: "checked 1 change\n",
    });
  });

  test.each([
    [
      ["check", "--since", "-x"],
      /`--since`: expected a git revision that does not start with -, but got "-x"/,
    ],
    [["relase", "minor"], /Did you mean `release`\?/],
    [["show"], /Expected a `VERSION`, but too few arguments/],
    [
      ["show", "latest"],
      /`VERSION`: expected a semantic version, but got "latest"/,
    ],
    [
      ["batch", "minor", "--date", "2026-13-01"],
      /`--date`: expected a date as YYYY-MM-DD, but got "2026-13-01"/,
    ],
    [["new", "-m", "pr"], /`-m`\/`--meta`: Expected "=" in "pr"/],
    [["new", "-m", "=7"], /`-m`\/`--meta`: Expected a non-empty key in "=7"/],
    [["new", "--edit", "--body", "-"], /--body cannot read stdin/],
    [
      ["new", "--resume", "-k", "fixed"],
      /"--resume" and "-k" "fixed" cannot be used together/,
    ],
  ])("%p is a usage error as well", async (args, message) => {
    await run("init");
    const result = await run(...args);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(message);
  });

  describe("render", () => {
    /** Has init set up a project with links, and releases 0.1.0 and 0.1.1. */
    async function projectWithReleases(): Promise<void> {
      await run("init", "--repository", "https://codeberg.org/o/r");
      await run("new", "-k", "Added", "-b", "* Feature", "-m", "pr=42");
      await run("batch", "minor", "--date", "2026-11-17");
      await run("new", "-k", "Fixed", "-b", "* Crash");
      await run("batch", "patch", "--date", "2026-11-18");
    }

    /** Replaces the line of a setting in the configuration that init wrote. */
    async function setSetting(key: string, value: string): Promise<void> {
      const path = join(root, ".changes/config.yaml");
      const config = await readFile(path, "utf8");
      const line = new RegExp(`^${key}: .*$`, "m");
      await writeFile(
        path,
        config.replace(line, `${key}: ${JSON.stringify(value)}`),
      );
    }

    const changelog = () => readFile(join(root, "CHANGELOG.md"), "utf8");

    async function changeTemplates(): Promise<void> {
      await setSetting("changeFormat", "{{body}}{{#pr}} (#{{pr}}){{/pr}}");
      await setSetting(
        "linkFormat",
        "[`{{version}}`]: {{repositoryUrl}}/releases/tag/{{tag}}",
      );
    }

    test("it renders past releases and their links with new templates", async () => {
      await projectWithReleases();
      await changeTemplates();

      expect(await run("render")).toMatchObject({
        exitCode: 0,
        stdout: "rendered 2 releases in CHANGELOG.md\n",
      });
      const text = await changelog();
      expect(text).toContain("\n* Feature (#42)\n");
      expect(text).toContain(
        "\n[`0.1.1`]: https://codeberg.org/o/r/releases/tag/v0.1.1\n",
      );
      expect((await run("check")).exitCode).toBe(0);
    });

    test("--dry-run prints the changelog and writes nothing", async () => {
      await projectWithReleases();
      await changeTemplates();
      const before = await changelog();

      const result = await run("render", "--dry-run");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("\n* Feature (#42)\n");
      expect(await changelog()).toBe(before);
    });

    test("a hand edit stops render until --force renders over it", async () => {
      await projectWithReleases();
      const path = join(root, "CHANGELOG.md");
      await writeFile(
        path,
        (await changelog()).replace("\n* Crash\n", "\n* Crash, by hand\n"),
      );
      const edited = await changelog();
      const problem =
        "release 0.1.1 was edited by hand since wandelzeug rendered it";

      const check = await run("check");
      expect(check.exitCode).toBe(1);
      expect(check.stderr).toContain(problem);

      const refused = await run("render");
      expect(refused.exitCode).toBe(1);
      expect(refused.stderr).toContain(problem);
      expect(refused.stderr).toContain("pass --force");
      expect(await changelog()).toBe(edited);

      expect((await run("render", "--force")).exitCode).toBe(0);
      expect(await changelog()).not.toContain("by hand");
      expect((await run("check")).exitCode).toBe(0);
    });

    test("a kind that the configuration lacks stops render and check", async () => {
      await projectWithReleases();
      await editConfig("  - label: Fixed", "  - label: Repaired");
      const problem =
        'release 0.1.1 has changes of kind "Fixed", which the configuration lacks';

      const refused = await run("render", "--force");
      expect(refused.exitCode).toBe(1);
      expect(refused.stderr).toContain(problem);
      expect((await run("check")).stderr).toContain(problem);
    });

    test("an empty repositoryUrl keeps the link definitions", async () => {
      await projectWithReleases();
      await setSetting("repositoryUrl", "");
      const before = await changelog();

      expect(await run("render")).toMatchObject({
        exitCode: 0,
        stdout:
          "rendered 2 releases in CHANGELOG.md\nkept the link definitions as they are, because repositoryUrl is empty\n",
      });
      expect(await changelog()).toBe(before);
    });

    test("releases without a data block and the links stay as they are", async () => {
      await run("init", "--repository", "https://codeberg.org/o/r");
      const legacy = [
        "<!-- BEGIN wlz:release 0.1.0 -->",
        "## 0.1.0 by hand",
        "<!-- END wlz:release 0.1.0 -->",
      ].join("\n");
      const path = join(root, "CHANGELOG.md");
      await writeFile(
        path,
        (await changelog())
          .replace(
            "<!-- wlz:releases -->\n",
            `<!-- wlz:releases -->\n\n${legacy}\n`,
          )
          .replace(
            "<!-- BEGIN wlz:links -->\n",
            "<!-- BEGIN wlz:links -->\n[`0.1.0`]: old\n",
          ),
      );
      await run("new", "-k", "Added", "-b", "* Feature", "-m", "pr=42");
      await run("batch", "minor", "--date", "2026-11-17");
      await changeTemplates();

      expect(await run("render")).toMatchObject({
        exitCode: 0,
        stdout:
          "rendered 1 release in CHANGELOG.md\nkept 1 release without a data block and the link definitions as they are\n",
      });
      const text = await changelog();
      expect(text).toContain(`${legacy}\n`);
      expect(text).toContain("\n* Feature (#42)\n");
      expect(text).toContain(
        "<!-- BEGIN wlz:links -->\n[`0.2.0`]: https://codeberg.org/o/r/compare/v0.1.0...v0.2.0\n[`0.1.0`]: old\n",
      );
    });
  });

  describe("import", () => {
    const history = [
      "# Changelog",
      "",
      "## [1.1.0] - 2025-03-01",
      "",
      "### Misc",
      "",
      "- Tidied up",
      "",
      "## [1.0.0] - 2025-01-01",
      "",
      "### Added",
      "",
      "- First release",
      "",
      "[1.1.0]: https://example.com/compare/v1.0.0...v1.1.0",
      "[1.0.0]: https://example.com/releases/tag/v1.0.0",
      "",
    ].join("\n");

    const writeHistory = (text: string) =>
      writeFile(join(root, "CHANGELOG.md"), text);

    test("init --import explains where it stopped and what to do next", async () => {
      await writeHistory(
        history.replace(
          "## [1.1.0]",
          "## [1.2.0] - 2025-04-01\n\n### Fixed\n\n- Crash\n\n## [1.1.0]",
        ),
      );
      const result = await run("init", "--import");
      expect(result.exitCode).toBe(0);
      const lines = (await readFile(join(root, "CHANGELOG.md"), "utf8")).split(
        "\n",
      );
      const line = lines.indexOf("## [1.1.0] - 2025-03-01") + 1;
      expect(result.stdout).toEndWith(
        [
          "imported 1 release: 1.2.0",
          `stopped at release 1.1.0 on line ${line}: its section "Misc" matches no configured kind`,
          "1.1.0 is now the baseline, and it and the releases below it stay as they are",
          'to import them too, change what stopped the import and run "wlz import" again',
          "",
        ].join("\n"),
      );
      expect((await run("latest")).stdout).toBe("1.2.0\n");
    });

    test("import converts the rest after a fix, and then finds nothing", async () => {
      await writeHistory(history);
      await run("init", "--import");
      await writeHistory(
        (await readFile(join(root, "CHANGELOG.md"), "utf8")).replace(
          "### Misc",
          "### Changed",
        ),
      );

      expect(await run("import")).toMatchObject({
        exitCode: 0,
        stdout: [
          "imported 2 releases: 1.1.0, 1.0.0",
          "moved 2 link definitions inside the wlz:links markers",
          "removed the baseline, because every release has a data block now",
          "",
        ].join("\n"),
      });
      expect((await run("check")).exitCode).toBe(0);
      expect((await run("import")).stdout).toBe(
        "found no releases without a data block\n",
      );
    });

    test("init without --import keeps the history as it is", async () => {
      await writeHistory(history);
      const result = await run("init");
      expect(result.stdout).not.toContain("imported");
      const text = await readFile(join(root, "CHANGELOG.md"), "utf8");
      expect(text).not.toContain("BEGIN wlz:release");
    });

    test("init --import takes no --baseline", async () => {
      await writeHistory(history);
      const result = await run("init", "--import", "--baseline", "1.0.0");
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain(
        "init: --import picks the baseline itself, so it takes no --baseline",
      );
    });

    test("render keeps the link definitions while repositoryUrl is empty", async () => {
      await writeHistory(history.replace("### Misc", "### Changed"));
      await run("init", "--import");
      const result = await run("render");
      expect(result.stdout).toBe(
        "rendered 2 releases in CHANGELOG.md\nkept the link definitions as they are, because repositoryUrl is empty\n",
      );
      expect(await readFile(join(root, "CHANGELOG.md"), "utf8")).toContain(
        "<!-- BEGIN wlz:links -->\n[1.1.0]: https://example.com/compare/v1.0.0...v1.1.0\n[1.0.0]: https://example.com/releases/tag/v1.0.0\n<!-- END wlz:links -->",
      );
    });
  });

  describe("release", () => {
    let helperDirectory: string;

    beforeEach(async () => {
      helperDirectory = await mkdtemp(join(tmpdir(), "wandelzeug-helper-"));
    });

    afterEach(async () => {
      await rm(helperDirectory, { recursive: true, force: true });
    });

    const callsLog = () => join(helperDirectory, "calls.log");
    const messageCopy = () => join(helperDirectory, "message.md");

    /**
     * Sets up a committed project whose tag helper is a fake: it logs its
     * arguments, copies the tag message, and fails at the check or at the
     * tag when FAIL_CHECK or FAIL_TAG is set.
     */
    async function projectWithFakeHelper(): Promise<void> {
      const script = join(helperDirectory, "helper.sh");
      await writeFile(
        script,
        [
          `printf '%s\\n' "$*" >> "${callsLog()}"`,
          'case " $* " in',
          '  *" --dry-run "*) [ -z "$FAIL_CHECK" ] || { echo "unexpected version" >&2; exit 1; } ;;',
          '  *) [ -z "$FAIL_TAG" ] || { echo "signing failed" >&2; exit 1; } ;;',
          "esac",
          `while [ $# -gt 0 ]; do [ "$1" = "--message-file" ] && cp "$2" "${messageCopy()}"; shift; done`,
          "exit 0",
          "",
        ].join("\n"),
      );
      await projectWithPackageVersion();
      await editConfig('tagHelper: "semverkzeug"', `tagHelper: "sh ${script}"`);
      await run("new", "-k", "Added", "-b", "* Feature");
      await startRepository(root);
    }

    const helperCalls = async (): Promise<string[]> =>
      (await readFile(callsLog(), "utf8")).trimEnd().split("\n");

    const headSubject = async (): Promise<string> =>
      (await gitOutput(root, "log", "-1", "--format=%s")).trim();

    test("it commits the release and tags the commit through the helper", async () => {
      await projectWithFakeHelper();
      const result = await run("release", "auto", "--date", "2026-11-17");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/^released 0\.1\.0 in commit [0-9a-f]+\n$/);
      const calls = await helperCalls();
      expect(calls).toHaveLength(2);
      expect(calls[0]).toBe(`-C ${root} bump minor --expect 0.1.0 --dry-run`);
      expect(calls[1]).toStartWith(
        `-C ${root} bump minor --expect 0.1.0 --message-file `,
      );
      expect(await readFile(messageCopy(), "utf8")).toBe(
        "## [`0.1.0`] (2026-11-17)\n\n### Added\n\n* Feature\n",
      );

      expect(await headSubject()).toBe("release 0.1.0");
      const changed = await gitOutput(
        root,
        "show",
        "--name-status",
        "--format=",
        "HEAD",
      );
      expect(changed).toBe(
        [
          "D\t.changes/unreleased/001-added-feature.md",
          "M\tCHANGELOG.md",
          "M\tpackage.json",
          "",
        ].join("\n"),
      );
      expect(await gitOutput(root, "status", "--porcelain")).toBe("");
    });

    test("a helper that disagrees changes nothing", async () => {
      await projectWithFakeHelper();
      const result = await runWith({ FAIL_CHECK: "1" }, "release", "patch");

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unexpected version");
      expect(await helperCalls()).toHaveLength(1);
      expect(await headSubject()).toBe("base");
      expect(await gitOutput(root, "status", "--porcelain")).toBe("");
    });

    test("a failed tag names the untagged release commit", async () => {
      await projectWithFakeHelper();
      const result = await runWith({ FAIL_TAG: "1" }, "release", "patch");

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(
        /The release commit [0-9a-f]+ stays untagged\. Fix the problem, then tag it, for example with "sh .*helper\.sh bump patch --expect 0\.0\.1"\./,
      );
      expect(await headSubject()).toBe("release 0.0.1");
    });

    test("--dry-run checks the tag and changes nothing", async () => {
      await projectWithFakeHelper();
      const result = await run("release", "minor", "--dry-run");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("<!-- END wlz:release 0.1.0 -->");
      expect(await helperCalls()).toEqual([
        `-C ${root} bump minor --expect 0.1.0 --dry-run`,
      ]);
      expect(await headSubject()).toBe("base");
      expect(await gitOutput(root, "status", "--porcelain")).toBe("");
    });

    test("an explicit version is a usage error", async () => {
      await projectWithFakeHelper();
      const result = await run("release", "1.2.3");

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain(
        '`BUMP`: Expected one of "major", "minor", "patch", and "auto", but got "1.2.3"',
      );
    });
  });
});
