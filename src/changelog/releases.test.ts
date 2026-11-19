import { describe, expect, test } from "bun:test";
import type { Change } from "../changes/fragments.ts";
import type { Bump, BumpStrategy } from "../shared/versions.ts";
import {
  breakingChange,
  change,
  isoDate,
  projectWith,
  release,
  version,
} from "../test-helpers.ts";
import type { Release } from "./markers.ts";
import {
  autoReleaseBump,
  previousRelease,
  releaseValues,
  renderLink,
  renderRelease,
} from "./releases.ts";

describe("breaking labels", () => {
  const values = releaseValues(
    projectWith({}).config,
    version("2.0.0"),
    isoDate("2026-11-17"),
    [],
  );
  const changes = [
    breakingChange("Removed", "* Old option"),
    breakingChange("Fixed", "* Strict parsing"),
    change("Fixed", "* Crash"),
  ];

  test("the default labels breaking changes unless their kind always breaks", () => {
    const notes = renderRelease(projectWith({}), values, changes);
    expect(notes).toContain("### Removed\n\n* Old option\n");
    expect(notes).toContain(
      "### Fixed\n\n* **Breaking:** Strict parsing\n* Crash",
    );
  });

  test("a change format without kindBreaks labels every breaking change", () => {
    const project = projectWith({
      changeFormat:
        "{{marker}}{{#breaking}}**Breaking:** {{/breaking}}{{text}}",
    });
    const notes = renderRelease(project, values, changes);
    expect(notes).toContain("### Removed\n\n* **Breaking:** Old option\n");
    expect(notes).toContain("* **Breaking:** Strict parsing\n* Crash");
  });
});

describe("auto bumps", () => {
  const breaking = [
    change("Fixed", "* Crash"),
    breakingChange("Changed", "* Format"),
  ];
  const added = [change("Fixed", "* Crash"), change("Added", "* Option")];

  const cases: [BumpStrategy, Release[], Change[], Bump][] = [
    ["minor-capped", [release("0.3.0")], breaking, "minor"],
    ["minor-capped", [], breaking, "minor"],
    ["minor-capped", [release("0.3.0")], added, "minor"],
    ["shifted", [release("0.3.0")], breaking, "minor"],
    ["shifted", [release("0.3.0")], added, "patch"],
    ["literal", [release("0.3.0")], breaking, "major"],
    ["minor-capped", [release("1.2.0"), release("0.9.0")], breaking, "major"],
    ["shifted", [release("1.2.0")], added, "minor"],
  ];

  test.each(cases)(
    "the %p strategy after %p bumps %p by %p",
    (bumpStrategy, releases, changes, expected) => {
      const { config } = projectWith({ bumpStrategy });
      expect(autoReleaseBump(releases, changes, config)).toBe(expected);
    },
  );
});

describe("release values", () => {
  const releases = [release("1.5.0"), release("1.4.2"), release("1.4.1")];

  test.each([
    ["1.6.0", "1.5.0"],
    ["1.4.3", "1.4.2"],
    ["2.0.0-rc.1", "1.5.0"],
    ["1.0.0", undefined],
  ])("the release before %p is %p", (next, expected) => {
    expect(previousRelease(releases, version(next))?.name).toBe(expected);
  });

  test("names and tags carry their own prefixes", () => {
    const config = projectWith({ versionPrefix: "", tagPrefix: "v" }).config;
    expect(
      releaseValues(config, version("1.4.3"), isoDate("2026-11-17"), releases),
    ).toEqual({
      version: "1.4.3",
      date: isoDate("2026-11-17"),
      tag: "v1.4.3",
      previousVersion: "1.4.2",
      previousTag: "v1.4.2",
    });
  });

  test("a first release has no predecessor", () => {
    const config = projectWith({}).config;
    const values = releaseValues(
      config,
      version("0.1.0"),
      isoDate("2026-11-17"),
      [],
    );
    expect(values.previousVersion).toBeUndefined();
    expect(values.previousTag).toBeUndefined();
  });
});

describe("links", () => {
  const values = {
    version: "1.1.2",
    date: isoDate("2024-09-27"),
    tag: "v1.1.2",
    previousVersion: "1.1.1",
    previousTag: "v1.1.1",
  };

  test("the default link compares with the previous tag", () => {
    const project = projectWith({ repositoryUrl: "https://codeberg.org/o/r/" });
    expect(renderLink(project, values)).toBe(
      "[`1.1.2`]: https://codeberg.org/o/r/compare/v1.1.1...v1.1.2",
    );
  });

  test.each([
    ["the repository URL is empty", {}],
    [
      "linkFormat is empty",
      { repositoryUrl: "https://x.invalid", linkFormat: "" },
    ],
  ])("links are off when %s", (_, settings) => {
    expect(renderLink(projectWith(settings), values)).toBeUndefined();
  });

  test("a link format with its own address works without a repository URL", () => {
    const project = projectWith({
      linkFormat: "[`{{version}}`]: https://example.invalid/tags/{{tag}}",
    });
    expect(renderLink(project, values)).toBe(
      "[`1.1.2`]: https://example.invalid/tags/v1.1.2",
    );
  });
});
