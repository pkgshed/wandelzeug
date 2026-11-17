import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
      env: { ...GIT_ENV, VISUAL: "", EDITOR: "", ...env },
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
        "<!-- BEGIN wlz:release 0.1.0 -->",
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

  test("next and latest start from the baseline of an onboarded changelog", async () => {
    await writeFile(join(root, "CHANGELOG.md"), "# History\n\n## [1.2.3]\n");
    expect((await run("init")).stdout).toContain(
      "updated CHANGELOG.md (added the release anchor on line 3 with baseline 1.2.3, and the links anchor on line 7)",
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
    [["frobnicate"], /unknown command "frobnicate"/],
    [["batch"], /batch: missing <version>/],
    [["batch", "1.0"], /invalid version "1\.0"/],
    [["next", "huge"], /next: invalid bump "huge"/],
    [["latest", "--nope"], /Unknown option '--nope'/],
    [["init", "--repository", "codeberg.org/o/r"], /invalid --repository/],
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
    [["check", "--since=-x"], /invalid --since "-x"/],
    [["merge"], /unknown command "merge"/],
    [["show"], /show: missing <version>/],
    [["show", "latest"], /invalid version "latest"/],
    [["new", "--edit", "--body", "-"], /--body cannot read stdin/],
    [
      ["new", "--resume", "-k", "fixed"],
      /--resume: the draft holds the change/,
    ],
  ])("%p is a usage error as well", async (args, message) => {
    await run("init");
    const result = await run(...args);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(message);
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
      await run("init");
      const configPath = join(root, ".changes/config.yaml");
      const config = await readFile(configPath, "utf8");
      await writeFile(
        configPath,
        config.replace('tagHelper: "semverkzeug"', `tagHelper: "sh ${script}"`),
      );
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
        "D\t.changes/unreleased/001-added-feature.md\nM\tCHANGELOG.md\n",
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
      expect(result.stdout).toContain("<!-- BEGIN wlz:release 0.1.0 -->");
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
      expect(result.stderr).toContain('release: invalid bump "1.2.3"');
    });
  });
});
