import { describe, expect, test } from "bun:test";
import { changelogDocument, version } from "../test-helpers.ts";
import {
  anchorMarker,
  insertRelease,
  knownReleases,
  parseChangelog,
  releaseNotes,
} from "./markers.ts";

describe("changelog markers", () => {
  const anchor = anchorMarker(undefined);
  const begin = (name: string) => `<!-- BEGIN wlz:release ${name} -->`;
  const end = (name: string) => `<!-- END wlz:release ${name} -->`;
  const sample = [
    "# Changelog",
    "",
    anchorMarker("1.4.2"),
    "",
    begin("v1.6.0"),
    "## v1.6.0",
    end("v1.6.0"),
    "",
    begin("v1.5.0"),
    "## v1.5.0",
    "",
    "* Fix",
    end("v1.5.0"),
    "",
    "## 1.4.2",
    "",
  ].join("\n");

  test("parseChangelog finds the anchor, the baseline and the releases", () => {
    const document = changelogDocument(sample);
    expect(document.anchor).toBe(2);
    expect(document.baseline?.name).toBe("1.4.2");
    expect(
      document.releases.map(({ name, begin, end }) => ({ name, begin, end })),
    ).toEqual([
      { name: "v1.6.0", begin: 4, end: 6 },
      { name: "v1.5.0", begin: 8, end: 12 },
    ]);
  });

  test("knownReleases lists the releases and the baseline newest first", () => {
    const names = knownReleases(changelogDocument(sample)).map((r) => r.name);
    expect(names).toEqual(["v1.6.0", "v1.5.0", "1.4.2"]);
  });

  test("releaseNotes returns the text between the markers", () => {
    const document = changelogDocument(sample);
    expect(releaseNotes(document, version("1.5.0"))).toBe(
      "## v1.5.0\n\n* Fix\n",
    );
    expect(releaseNotes(document, version("1.4.2"))).toBeUndefined();
  });

  const broken: [string[], string][] = [
    [
      ["# Changelog"],
      'no <!-- wlz:releases --> anchor, run "wlz init" to add it',
    ],
    [[anchor, anchor], "line 2: second release anchor, the first is on line 1"],
    [
      ["<!-- wlz:releases since=1.0.0 -->"],
      'line 1: unknown anchor attribute "since=1.0.0"',
    ],
    [["<!-- wlz:releases baseline=1.0 -->"], 'line 1: invalid version "1.0"'],
    [[anchor, begin("v1.0.0")], "line 2: release v1.0.0 lacks its END marker"],
    [[anchor, end("v1.0.0")], "line 2: END of v1.0.0 without a BEGIN"],
    [
      [anchor, begin("v1.0.0"), end("v1.1.0")],
      "line 3: END of v1.1.0 closes release v1.0.0",
    ],
    [
      [anchor, begin("v1.0.0"), begin("v1.1.0")],
      "line 3: BEGIN of v1.1.0 inside release v1.0.0, which lacks its END",
    ],
    [
      [anchor, begin("v1.0.0"), end("v1.0.0"), begin("1.0.0"), end("1.0.0")],
      "line 4: release 1.0.0 appears twice, first on line 2",
    ],
    [[anchor, begin("latest")], 'line 2: invalid version "latest"'],
    [
      [anchor, "<!-- wlz:relase v1.0.0 -->"],
      "line 2: unknown wlz marker, expected the release anchor or BEGIN or END wlz:release VERSION",
    ],
  ];

  test.each(broken)("parseChangelog rejects %p with %p", (lines, problem) => {
    const parsed = parseChangelog(lines.join("\n"));
    expect(parsed.ok ? [] : parsed.problems).toContain(problem);
  });

  test("text between the markers stays opaque", () => {
    const text = [
      anchor,
      begin("v1.0.0"),
      "<!-- a comment -->",
      "## Notes",
      end("v1.0.0"),
    ];
    expect(parseChangelog(text.join("\n")).ok).toBe(true);
  });

  const section = "S1\nS2";
  test.each([
    [
      "the anchor ends the file",
      `# C\n\n${anchor}\n`,
      `# C\n\n${anchor}\n\nS1\nS2\n`,
    ],
    [
      "the anchor lacks a final newline",
      `# C\n${anchor}`,
      `# C\n${anchor}\n\nS1\nS2\n`,
    ],
    [
      "an older release follows",
      `${anchor}\n\n${begin("v1.0.0")}\n${end("v1.0.0")}\n`,
      `${anchor}\n\nS1\nS2\n\n${begin("v1.0.0")}\n${end("v1.0.0")}\n`,
    ],
    [
      "older text follows directly",
      `${anchor}\n## 1.0.0\n`,
      `${anchor}\n\nS1\nS2\n\n## 1.0.0\n`,
    ],
    [
      "the file uses CRLF",
      `# C\r\n${anchor}\r\n`,
      `# C\r\n${anchor}\r\n\r\nS1\r\nS2\r\n`,
    ],
  ])(
    "insertRelease places the release below the anchor when %s",
    (_, text, expected) => {
      expect(insertRelease(changelogDocument(text), section)).toBe(expected);
    },
  );
});
