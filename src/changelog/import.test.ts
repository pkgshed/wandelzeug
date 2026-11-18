import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../project/config.ts";
import { changelogDocument, isoDate } from "../test-helpers.ts";
import { notesHash } from "./data.ts";
import { planImport } from "./import.ts";
import {
  anchorMarker,
  currentNotes,
  LINKS_BEGIN,
  LINKS_END,
} from "./markers.ts";

describe("import", () => {
  const kinds = DEFAULT_CONFIG.kinds;
  const imported = (lines: readonly string[]) =>
    planImport(changelogDocument(lines.join("\n")), kinds);

  const release120 = [
    "## [1.2.0] - 2025-04-01",
    "",
    "### Added",
    "",
    "- Support for TOML config",
    "  with a second line",
    "",
    "### Fixed",
    "",
    "- Crash",
  ];
  const release110 = [
    "## [1.1.0] - 2025-03-01",
    "",
    "### Misc",
    "",
    "- Tidied up",
  ];
  const release100 = [
    "## [1.0.0] - 2025-01-01",
    "",
    "### Added",
    "",
    "- First",
  ];
  const definitions = [
    "[1.2.0]: https://example.com/compare/v1.1.0...v1.2.0",
    "[1.1.0]: https://example.com/compare/v1.0.0...v1.1.0",
    "[1.0.0]: https://example.com/releases/tag/v1.0.0",
  ];

  /** A changelog that init onboarded, with the given releases from before wandelzeug. */
  const onboarded = (...releases: (readonly string[])[]) => [
    "# Changelog",
    "",
    anchorMarker("1.2.0"),
    "",
    ...releases.flatMap((release) => [...release, ""]),
    "[unreleased]: https://example.com/compare/v1.2.0...HEAD",
    LINKS_BEGIN,
    LINKS_END,
    ...definitions,
    "",
  ];

  test("releases from before wandelzeug get data blocks and keep their notes", () => {
    const plan = imported(onboarded(release120, release100));
    expect(plan.converted.map((release) => release.name)).toEqual([
      "1.2.0",
      "1.0.0",
    ]);
    expect(plan.stop).toBeUndefined();
    expect(plan.baseline.after).toBeUndefined();

    const document = changelogDocument(plan.content);
    expect(document.baseline).toBeUndefined();
    const [newest, oldest] = document.releases;
    expect(newest?.data?.date).toBe(isoDate("2025-04-01"));
    expect(newest?.data?.changes).toEqual([
      {
        kind: "Added",
        metadata: {},
        body: "- Support for TOML config\n  with a second line",
      },
      { kind: "Fixed", metadata: {}, body: "- Crash" },
    ]);
    for (const section of [newest, oldest]) {
      if (section?.data === undefined) throw new Error("missing data block");
      expect(notesHash(currentNotes(document, section))).toBe(
        section.data.hash,
      );
    }
    expect(currentNotes(document, oldest!)).toBe(release100.join("\n"));
  });

  test("the link definitions of imported releases move inside the markers", () => {
    const plan = imported(onboarded(release120, release100));
    expect(plan.movedLinks).toBe(2);
    expect(plan.content).toEndWith(
      [
        "[unreleased]: https://example.com/compare/v1.2.0...HEAD",
        LINKS_BEGIN,
        "[1.2.0]: https://example.com/compare/v1.1.0...v1.2.0",
        "[1.0.0]: https://example.com/releases/tag/v1.0.0",
        LINKS_END,
        "[1.1.0]: https://example.com/compare/v1.0.0...v1.1.0",
        "",
      ].join("\n"),
    );
  });

  test("the first release that does not fit stops the import and becomes the baseline", () => {
    const plan = imported(onboarded(release120, release110, release100));
    expect(plan.converted.map((release) => release.name)).toEqual(["1.2.0"]);
    expect(plan.stop).toMatchObject({
      release: { name: "1.1.0" },
      reason: 'its section "Misc" matches no configured kind',
      legacy: true,
    });
    expect(plan.baseline.after?.name).toBe("1.1.0");

    const lines = plan.content.split("\n");
    expect(lines[plan.stop?.line ?? -1]).toBe("## [1.1.0] - 2025-03-01");
    const document = changelogDocument(plan.content);
    expect(document.baseline?.name).toBe("1.1.0");
    expect(document.releases.map((release) => release.name)).toEqual(["1.2.0"]);
  });

  test.each([
    [
      ["## [1.2.0]", "", "### Added", "", "- x"],
      "its heading names no date as YYYY-MM-DD",
    ],
    [
      ["## [1.2.0] - 2025-04-01 [YANKED]", "", "### Added", "", "- x"],
      "its heading marks it as yanked, which a data block cannot record",
    ],
    [
      ["## [1.2.0] - 2025-04-01", "", "A summary.", "", "### Added", "", "- x"],
      "it holds a paragraph before its first kind heading, which a data block cannot record",
    ],
    [
      ["## [1.2.0] - 2025-04-01", "", "### Added", "", "- x", "", "More."],
      'it holds a paragraph under "Added", which a data block cannot record',
    ],
    [
      ["## [1.2.0] - 2025-04-01", "", "### Added", "", "```", "code", "```"],
      'it holds a code block under "Added", which a data block cannot record',
    ],
    [
      ["## [1.2.0] - 2025-04-01", "", "- x"],
      "it has a list before its first kind heading",
    ],
    [["## [1.2.0] - 2025-04-01", "", "### Added"], "it lists no changes"],
  ])("%p does not fit because %p", (release, reason) => {
    expect(imported(onboarded(release)).stop?.reason).toBe(reason);
  });

  const marked = (name: string, notes: readonly string[]) => [
    `<!-- BEGIN wlz:release ${name} -->`,
    ...notes,
    `<!-- END wlz:release ${name} -->`,
  ];

  test("a marked release without a data block gets one in its BEGIN marker", () => {
    const notes = [
      "## [`0.1.0`] (2026-11-17)",
      "",
      "### Added",
      "",
      "* Feature",
    ];
    const plan = imported([
      anchorMarker(undefined),
      "",
      ...marked("0.1.0", notes),
      "",
    ]);
    expect(plan.converted.map((release) => release.name)).toEqual(["0.1.0"]);

    const document = changelogDocument(plan.content);
    const [section] = document.releases;
    expect(section?.data?.changes).toEqual([
      { kind: "Added", metadata: {}, body: "* Feature" },
    ]);
    expect(currentNotes(document, section!)).toBe(notes.join("\n"));
  });

  test("a data block follows the notes after exactly one blank line", () => {
    const notes = [
      "## [`0.1.0`] (2026-11-17)",
      "",
      "### Added",
      "",
      "* Feature",
    ];
    for (const ending of [[], [""]]) {
      const plan = imported([
        anchorMarker(undefined),
        "",
        ...marked("0.1.0", [...notes, ...ending]),
        "",
      ]);
      expect(plan.content).toContain("* Feature\n\n<!-- wlz:data\n");
    }
  });

  test("a marked release that does not fit stops before the older releases", () => {
    const plan = imported([
      anchorMarker("1.2.0"),
      "",
      ...marked("2.0.0", ["## 2.0.0", "", "### Added", "", "* Feature"]),
      "",
      ...release120,
      "",
    ]);
    expect(plan.converted).toEqual([]);
    expect(plan.stop).toMatchObject({
      release: { name: "2.0.0" },
      reason: "its heading names no date as YYYY-MM-DD",
      legacy: false,
    });
    expect(plan.baseline.after?.name).toBe("1.2.0");
  });

  test("without link markers, the link definitions stay where they are", () => {
    const plan = imported([
      anchorMarker("1.0.0"),
      "",
      ...release100,
      "",
      "[1.0.0]: https://example.com/releases/tag/v1.0.0",
      "",
    ]);
    expect(plan).toMatchObject({ movedLinks: 0, unmovedLinks: 1 });
    expect(plan.content).toEndWith(
      "<!-- END wlz:release 1.0.0 -->\n\n[1.0.0]: https://example.com/releases/tag/v1.0.0\n",
    );
  });
});
