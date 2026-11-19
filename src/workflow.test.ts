import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { notesHash } from "./changelog/data.ts";
import {
  planRelease,
  removeFragments,
  writeRelease,
} from "./changelog/releases.ts";
import { loadFragments, recordChange } from "./changes/fragments.ts";
import {
  changedFragments,
  checkProject,
  parseGitRef,
} from "./project/checks.ts";
import { loadProject, openProject } from "./project/root.ts";
import { INIT_HEADER, initProject, type InitResult } from "./project/setup.ts";
import {
  change,
  commitAll,
  git,
  gitRef,
  isoDate,
  maskFragmentIds,
  PR_FIELD_CONFIG,
  release,
  releaseTarget,
  startRepository,
  writeChangelog,
  writeConfig,
} from "./test-helpers.ts";

describe("project workflow", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "wandelzeug-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** The files in the unreleased directory, with "<id>" in place of their random IDs. */
  const unreleasedFiles = async (): Promise<string[]> =>
    (await readdir(join(root, ".changes", "unreleased")))
      .map(maskFragmentIds)
      .sort();

  test("init, new and batch add releases and links to the changelog", async () => {
    await initProject(root, { repositoryUrl: "https://codeberg.org/o/r" });
    const project = await loadProject(root);
    await recordChange(
      project,
      change("Fixed", "* Crash on empty input", { pr: 7 }),
    );
    await recordChange(project, change("Added", "* Support for TOML config"));
    await recordChange(project, change("Added", "* A dry-run flag for batch"));
    expect(await unreleasedFiles()).toEqual([
      ".gitkeep",
      "001-<id>-fixed-crash-on-empty-input.md",
      "002-<id>-added-support-for-toml-config.md",
      "003-<id>-added-a-dry-run-flag-for-batch.md",
    ]);

    const first = await planRelease(
      project,
      releaseTarget("auto"),
      isoDate("2026-11-17"),
    );
    const firstNotes = [
      "## [`0.1.0`] (2026-11-17)",
      "",
      "### Added",
      "",
      "* Support for TOML config",
      "* A dry-run flag for batch",
      "",
      "### Fixed",
      "",
      "* Crash on empty input",
    ].join("\n");
    const firstSection = [
      "<!-- BEGIN wlz:release 0.1.0 -->",
      firstNotes,
      "",
      `<!-- wlz:data date=2026-11-17 hash=${notesHash(firstNotes)}`,
      "Added:",
      '  - body: "* Support for TOML config"',
      '  - body: "* A dry-run flag for batch"',
      "Fixed:",
      "  - pr: 7",
      '    body: "* Crash on empty input"',
      "-->",
      "<!-- END wlz:release 0.1.0 -->",
    ].join("\n");
    expect(first.path).toBe(join(root, "CHANGELOG.md"));
    expect(first.section).toBe(firstSection);
    expect(first.links).toEqual([
      "[`0.1.0`]: https://codeberg.org/o/r/releases/tag/v0.1.0",
    ]);
    await writeRelease(first);
    await removeFragments(first.fragments);
    expect(await unreleasedFiles()).toEqual([".gitkeep"]);

    await recordChange(project, change("Fixed", "* Hang on exit"));
    const second = await planRelease(
      project,
      releaseTarget("patch"),
      isoDate("2026-11-18"),
    );
    await writeRelease(second);

    const secondNotes =
      "## [`0.1.1`] (2026-11-18)\n\n### Fixed\n\n* Hang on exit";
    expect(await readFile(join(root, "CHANGELOG.md"), "utf8")).toBe(
      [
        INIT_HEADER,
        "<!-- wlz:releases -->",
        "",
        "<!-- BEGIN wlz:release 0.1.1 -->",
        secondNotes,
        "",
        `<!-- wlz:data date=2026-11-18 hash=${notesHash(secondNotes)}`,
        "Fixed:",
        '  - body: "* Hang on exit"',
        "-->",
        "<!-- END wlz:release 0.1.1 -->",
        "",
        firstSection,
        "",
        "<!-- BEGIN wlz:links -->",
        "[`0.1.1`]: https://codeberg.org/o/r/compare/v0.1.0...v0.1.1",
        "[`0.1.0`]: https://codeberg.org/o/r/releases/tag/v0.1.0",
        "<!-- END wlz:links -->",
        "",
      ].join("\n"),
    );
  });

  test("the change format can link front matter values", async () => {
    await writeConfig(
      root,
      'changeFormat: "{{body}}{{#pr}} (#{{pr}}){{/pr}}"\n',
    );
    await writeChangelog(root);
    const project = await loadProject(root);
    await recordChange(project, change("Fixed", "* Crash", { pr: 7 }));
    await recordChange(project, change("Fixed", "* Hang"));

    const plan = await planRelease(
      project,
      releaseTarget("1.0.0"),
      isoDate("2026-11-17"),
    );
    expect(plan.section).toContain("### Fixed\n\n* Crash (#7)\n* Hang\n");
  });

  test("the change format applies to each item of a list body", async () => {
    await writeConfig(
      root,
      'changeFormat: "{{marker}}{{#issue}}[{{issue}}] {{/issue}}{{text}}"\n',
    );
    await writeChangelog(root);
    const project = await loadProject(root);
    await recordChange(
      project,
      change("Fixed", "* Crash on start\n* Hang on exit\n  for good", {
        issue: "FOO-7",
      }),
    );
    await recordChange(
      project,
      change("Fixed", "A paragraph instead of a list", { issue: "FOO-8" }),
    );

    const plan = await planRelease(
      project,
      releaseTarget("1.0.0"),
      isoDate("2026-11-17"),
    );
    expect(plan.notes).toEndWith(
      [
        "### Fixed",
        "",
        "* [FOO-7] Crash on start",
        "* [FOO-7] Hang on exit",
        "  for good",
        "[FOO-8] A paragraph instead of a list",
      ].join("\n"),
    );
  });

  test("a tag template can list the entries and their links as plain text", async () => {
    const tagTemplate = [
      "release {{tag}}",
      "",
      "{{#kinds}}",
      "{{#changes}}",
      "{{> change}}",
      "{{/changes}}",
      "{{/kinds}}",
      "",
      "{{#references}}",
      "[{{label}}]: <{{url}}>",
      "{{/references}}",
      "",
    ].join("\n");
    await writeConfig(
      root,
      Bun.YAML.stringify({
        repositoryUrl: "https://gitlab.corp.com/project-url",
        changeFormat:
          "{{marker}}{{#issue}}[{{issue}}] {{/issue}}{{text}}{{#mr}} ([!{{mr}}]){{/mr}}",
        tagTemplate,
        extraFields: [
          {
            key: "issue",
            pattern: "FOO-\\d{1,9}",
            url: "https://jira.corp.com/browse/{{issue}}",
          },
          {
            key: "mr",
            type: "int",
            label: "!{{mr}}",
            url: "{{repositoryUrl}}/-/merge_requests/{{mr}}",
          },
        ],
      }),
    );
    await writeChangelog(
      root,
      "<!-- BEGIN wlz:links -->",
      "<!-- END wlz:links -->",
    );
    const project = await loadProject(root);
    await recordChange(
      project,
      change("Added", "* Added the thing.", { issue: "FOO-1234", mr: 19 }),
    );

    const plan = await planRelease(
      project,
      releaseTarget("1.0.0"),
      isoDate("2026-11-17"),
    );
    expect(plan.tagMessage).toBe(
      [
        "release v1.0.0",
        "",
        "* [FOO-1234] Added the thing. ([!19])",
        "",
        "[FOO-1234]: <https://jira.corp.com/browse/FOO-1234>",
        "[!19]: <https://gitlab.corp.com/project-url/-/merge_requests/19>",
      ].join("\n"),
    );
  });

  test("a release template can replace the whole layout", async () => {
    const releaseTemplate = [
      "# Release {{version}}",
      "{{#kinds}}",
      "{{#changes}}",
      "- [{{kind}}] {{body}}{{#breaking}} (breaking){{/breaking}}",
      "{{/changes}}",
      "{{/kinds}}",
      "",
    ].join("\n");
    await writeConfig(root, Bun.YAML.stringify({ releaseTemplate }));
    await writeChangelog(root);
    const project = await loadProject(root);
    await recordChange(
      project,
      change("Changed", "API renamed", { breaking: true }),
    );
    await recordChange(project, change("Fixed", "Crash"));

    const plan = await planRelease(
      project,
      releaseTarget("2.0.0"),
      isoDate("2026-11-17"),
    );
    expect(plan.notes).toBe(
      [
        "# Release 2.0.0",
        "- [Changed] API renamed (breaking)",
        "- [Fixed] Crash",
      ].join("\n"),
    );
  });

  test("a release template can keep the formats as partials", async () => {
    const releaseTemplate =
      "{{> version}}\n{{#kinds}}\n{{#changes}}\n{{> change}}\n{{/changes}}\n{{/kinds}}\n";
    await writeConfig(
      root,
      Bun.YAML.stringify({ releaseTemplate, changeFormat: "- {{body}}" }),
    );
    await writeChangelog(root);
    const project = await loadProject(root);
    await recordChange(project, change("Added", "Feature"));
    await recordChange(project, change("Fixed", "Crash"));

    const plan = await planRelease(
      project,
      releaseTarget("1.1.0"),
      isoDate("2026-11-17"),
    );
    expect(plan.notes).toBe("## [`1.1.0`] (2026-11-17)\n- Feature\n- Crash");
  });

  test.each([
    [
      "a marked release",
      "<!-- BEGIN wlz:release v1.0.0 -->\n<!-- END wlz:release v1.0.0 -->",
    ],
    ["the baseline", ""],
  ])("batch refuses a version that %s has already", async (_, lines) => {
    await initProject(root, { baseline: release("1.0.0") });
    if (lines !== "") await writeChangelog(root, lines);
    const project = await loadProject(root);
    await recordChange(project, change("Fixed", "* Crash"));

    const attempt = planRelease(
      project,
      releaseTarget("1.0.0"),
      isoDate("2026-11-17"),
    );
    await expect(attempt).rejects.toThrow(/release v?1\.0\.0 exists already/);
  });

  test("batch needs the anchor in the changelog", async () => {
    await initProject(root);
    await writeFile(join(root, "CHANGELOG.md"), "# Changelog\n");
    const project = await loadProject(root);
    await recordChange(project, change("Fixed", "* Crash"));

    const attempt = planRelease(
      project,
      releaseTarget("patch"),
      isoDate("2026-11-17"),
    );
    await expect(attempt).rejects.toThrow(
      /CHANGELOG\.md: no <!-- wlz:releases --> anchor/,
    );
  });

  test("batch refuses an empty unreleased directory", async () => {
    await initProject(root);
    const project = await loadProject(root);
    await expect(
      planRelease(project, releaseTarget("patch"), isoDate("2026-11-17")),
    ).rejects.toThrow(/no unreleased changes/);
  });

  test("batch names the fragment that fails to parse", async () => {
    await initProject(root);
    const project = await loadProject(root);
    await writeFile(
      join(root, ".changes", "unreleased", "001-broken.md"),
      "* no front matter\n",
    );
    await expect(loadFragments(project)).rejects.toThrow(
      /001-broken\.md: missing front matter/,
    );
  });

  test("init refuses an existing configuration", async () => {
    await initProject(root);
    await expect(initProject(root)).rejects.toThrow(
      /\.changes\/config\.yaml exists already/,
    );
  });

  const changelogResult = (results: readonly InitResult[]) =>
    results.find((result) => result.path.endsWith("CHANGELOG.md"));

  test("init onboards an existing changelog", async () => {
    await writeFile(
      join(root, "CHANGELOG.md"),
      "# History\n\n## 1.4.2\n\n* Fix\n",
    );
    const results = await initProject(root);
    expect(changelogResult(results)).toEqual({
      path: join(root, "CHANGELOG.md"),
      action: "updated",
      detail:
        "added the release anchor on line 3 with baseline 1.4.2, and the link markers on line 9",
    });
    expect(await readFile(join(root, "CHANGELOG.md"), "utf8")).toBe(
      "# History\n\n<!-- wlz:releases baseline=1.4.2 -->\n\n## 1.4.2\n\n* Fix\n\n<!-- BEGIN wlz:links -->\n<!-- END wlz:links -->\n",
    );
  });

  test("init keeps a changelog that has the anchor already", async () => {
    await writeChangelog(root);
    const before = await readFile(join(root, "CHANGELOG.md"), "utf8");
    const results = await initProject(root);
    expect(changelogResult(results)?.action).toBe("kept");
    expect(await readFile(join(root, "CHANGELOG.md"), "utf8")).toBe(before);
  });

  test("init refuses a baseline for a changelog with an anchor", async () => {
    await writeChangelog(root);
    await expect(
      initProject(root, { baseline: release("2.0.0") }),
    ).rejects.toThrow(/has wlz markers already, change its baseline there/);
    expect(await Bun.file(join(root, ".changes", "config.yaml")).exists()).toBe(
      false,
    );
  });

  test("openProject finds the configuration in a parent directory", async () => {
    await initProject(root);
    const nested = join(root, "src", "deep");
    await mkdir(nested, { recursive: true });
    expect((await openProject(nested)).root).toBe(root);
  });

  test("checkProject reports every problem with its file", async () => {
    await writeConfig(root, PR_FIELD_CONFIG);
    await writeChangelog(root, "<!-- END wlz:release v1.0.0 -->");
    const project = await loadProject(root);
    const unreleased = join(root, ".changes", "unreleased");
    await recordChange(project, change("Fixed", "* Crash", { pr: 7 }));
    await writeFile(join(unreleased, "002-broken.md"), "* no front matter\n");
    await writeFile(
      join(unreleased, "003-no-pr.md"),
      "---\nkind: Added\n---\n* Feature\n",
    );

    expect(await checkProject(project)).toEqual({
      checked: 3,
      problems: [
        {
          path: join(unreleased, "002-broken.md"),
          message: 'missing front matter, the first line must be "---"',
        },
        {
          path: join(unreleased, "003-no-pr.md"),
          message: 'missing required field "pr"',
        },
        {
          path: join(root, "CHANGELOG.md"),
          message: "line 5: END of v1.0.0 without a BEGIN",
        },
      ],
    });
  });

  test("checkProject reports a missing changelog", async () => {
    await writeConfig(root, "");
    const project = await loadProject(root);
    expect((await checkProject(project)).problems).toEqual([
      {
        path: join(root, "CHANGELOG.md"),
        message: 'no such file, run "wlz init" to create it',
      },
    ]);
  });

  test("changedFragments lists committed fragments since the fork point", async () => {
    await initProject(root);
    await startRepository(root);
    await git(root, "switch", "--quiet", "--create", "feature");
    const project = await loadProject(root);
    expect(await changedFragments(project, gitRef("main"))).toEqual([]);

    await recordChange(project, change("Fixed", "* Crash"));
    expect(await changedFragments(project, gitRef("main"))).toEqual([]);

    await commitAll(root, "record a change");
    const changed = await changedFragments(project, gitRef("main"));
    expect(changed.map(maskFragmentIds)).toEqual([
      ".changes/unreleased/001-<id>-fixed-crash.md",
    ]);
  });

  test.each(["", "-x", "--output=/tmp/x"])("parseGitRef rejects %p", (text) => {
    expect(parseGitRef(text)).toBeUndefined();
  });
});
