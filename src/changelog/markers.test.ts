import { describe, expect, test } from "bun:test";
import { changelogDocument, isoDate, version } from "../test-helpers.ts";
import { notesHash, type ReleaseData } from "./data.ts";
import {
  anchorMarker,
  dataComment,
  insertRelease,
  knownReleases,
  LINKS_BEGIN,
  LINKS_END,
  parseChangelog,
  releaseNotes,
  releaseSection,
  replaceLines,
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
      "line 2: unknown wlz marker, expected an anchor, BEGIN or END wlz:release VERSION, or BEGIN or END wlz:links",
    ],
  ];

  test.each(broken)("parseChangelog rejects %p with %p", (lines, problem) => {
    const parsed = parseChangelog(lines.join("\n"));
    expect(parsed.ok ? [] : parsed.problems).toContain(problem);
  });

  test("parseChangelog finds the link markers below the release anchor", () => {
    const text = [anchor, "", "## 1.0.0", "", LINKS_BEGIN, LINKS_END, "[1]: x"];
    expect(changelogDocument(text.join("\n")).links).toEqual({
      begin: 4,
      end: 5,
    });
    expect(changelogDocument(anchor).links).toBeUndefined();
  });

  const misplacedLinks: [string[], string][] = [
    [
      [anchor, LINKS_BEGIN, LINKS_END, LINKS_BEGIN, LINKS_END],
      "line 4: second BEGIN wlz:links marker, the first is on line 2",
    ],
    [
      [LINKS_BEGIN, LINKS_END, anchor],
      "line 1: the link definitions must come after the release anchor",
    ],
    [
      [anchor, begin("v1.0.0"), LINKS_BEGIN, LINKS_END, end("v1.0.0")],
      "line 3: BEGIN wlz:links marker inside release v1.0.0",
    ],
    [[anchor, LINKS_BEGIN], "line 2: BEGIN wlz:links lacks its END marker"],
    [[anchor, LINKS_END], "line 2: END wlz:links marker without a BEGIN"],
    [
      [anchor, LINKS_BEGIN, begin("v1.0.0"), end("v1.0.0"), LINKS_END],
      "line 3: BEGIN of v1.0.0 inside the link definitions",
    ],
    [
      [anchor, "<!-- wlz:links -->"],
      "line 2: the links anchor of wandelzeug 0.1 is now a pair of markers: replace this line with <!-- BEGIN wlz:links -->, and put <!-- END wlz:links --> after the link definitions that wandelzeug added",
    ],
  ];

  test.each(misplacedLinks)(
    "parseChangelog rejects %p with %p",
    (lines, problem) => {
      const parsed = parseChangelog(lines.join("\n"));
      expect(parsed.ok ? [] : parsed.problems).toContain(problem);
    },
  );

  test("insertRelease adds the link below the BEGIN link marker, newest first", () => {
    const text = [
      anchor,
      "",
      LINKS_BEGIN,
      "[`1.0.0`]: old",
      LINKS_END,
      "",
    ].join("\n");
    const inserted = insertRelease(
      changelogDocument(text),
      "S",
      "[`1.1.0`]: new",
    );
    expect(inserted).toBe(
      [
        anchor,
        "",
        "S",
        "",
        LINKS_BEGIN,
        "[`1.1.0`]: new",
        "[`1.0.0`]: old",
        LINKS_END,
        "",
      ].join("\n"),
    );
  });

  test("insertRelease needs the link markers for a link", () => {
    expect(() =>
      insertRelease(changelogDocument(anchor), "S", "[x]: y"),
    ).toThrow("no <!-- BEGIN wlz:links --> marker for the link definition");
  });

  describe("data blocks", () => {
    const notes = "## 1.0.0\n\n### Added\n\n* Feature";
    const data: ReleaseData = {
      date: isoDate("2026-11-17"),
      hash: notesHash(notes),
      changes: [{ kind: "Added", metadata: { pr: 7 }, body: "* Feature" }],
    };
    const withData = [anchor, "", releaseSection("1.0.0", data, notes), ""];

    test("parseChangelog reads the data block at the bottom of a release", () => {
      const [section] = changelogDocument(withData.join("\n")).releases;
      expect(section).toMatchObject({
        name: "1.0.0",
        begin: 2,
        notesEnd: 8,
        end: 16,
      });
      expect(section?.data).toEqual(data);
    });

    test("a release without data has no data block", () => {
      const section = releaseSection("1.0.0", undefined, notes);
      expect(section).toBe(`${begin("1.0.0")}\n${notes}\n${end("1.0.0")}`);
      const [parsed] = changelogDocument([anchor, section].join("\n")).releases;
      expect(parsed).toMatchObject({ notesEnd: 7, end: 7, data: undefined });
    });

    test("releaseNotes leaves out the data block", () => {
      const document = changelogDocument(withData.join("\n"));
      expect(releaseNotes(document, version("1.0.0"))).toBe(`${notes}\n`);
    });

    test("a data block keeps the comment closed when a value holds -->", () => {
      const tricky: ReleaseData = {
        ...data,
        changes: [{ kind: "Added", metadata: {}, body: "* A --> B --!> C" }],
      };
      const section = releaseSection("1.0.0", tricky, notes);
      expect(
        section.split("\n").filter((line) => line.includes("-->")),
      ).toEqual([begin("1.0.0"), "-->", "<!-- END wlz:release 1.0.0 -->"]);
      const [parsed] = changelogDocument([anchor, section].join("\n")).releases;
      expect(parsed?.data?.changes[0]?.body).toBe("* A --> B --!> C");
    });

    const hash = notesHash("x");
    const brokenData: [string[], string][] = [
      [
        [
          anchor,
          begin("1.0.0"),
          "## 1.0.0",
          "<!-- wlz:data",
          "date: 2026-11-17",
        ],
        "line 4: the data block lacks its closing --> line",
      ],
      [
        [
          anchor,
          begin("1.0.0"),
          "<!-- wlz:data",
          "date: soon",
          "-->",
          end("1.0.0"),
        ],
        "line 3: release 1.0.0: date must be a date as YYYY-MM-DD",
      ],
      [
        [
          anchor,
          begin("1.0.0"),
          "<!-- wlz:data",
          "date: 2026-11-17",
          "hash: h1:short",
          "changes: []",
          "-->",
          end("1.0.0"),
        ],
        'line 3: release 1.0.0: hash must be "h1:" and 24 characters of base64',
      ],
      [
        [
          anchor,
          begin("1.0.0"),
          "<!-- wlz:data",
          "date: 2026-11-17",
          `hash: ${hash}`,
          "changes:",
          "  - kind: Added",
          "-->",
          end("1.0.0"),
        ],
        "line 3: release 1.0.0: changes[0]: body is missing",
      ],
      [
        [
          anchor,
          begin("1.0.0"),
          "<!-- wlz:data",
          "author: me",
          "-->",
          end("1.0.0"),
        ],
        'line 3: release 1.0.0: unknown data block key "author"',
      ],
      [
        [anchor, "<!-- wlz:data", "author: me", "-->"],
        "line 2: data block outside a release",
      ],
      [
        [
          anchor,
          begin("1.0.0"),
          ...dataComment(data),
          "## 1.0.0",
          end("1.0.0"),
        ],
        "line 3: the data block of release 1.0.0 must come right before its END marker",
      ],
      [
        [
          anchor,
          begin("1.0.0"),
          ...dataComment(data),
          ...dataComment(data),
          end("1.0.0"),
        ],
        "line 11: second data block in release 1.0.0",
      ],
    ];

    test.each(brokenData)(
      "parseChangelog rejects %p with %p",
      (lines, problem) => {
        const parsed = parseChangelog(lines.join("\n"));
        expect(parsed.ok ? [] : parsed.problems).toContain(problem);
      },
    );
  });

  test("replaceLines replaces and inserts lines, keeping the line breaks", () => {
    const document = changelogDocument([anchor, "a", "b", "c"].join("\r\n"));
    const text = replaceLines(document, [
      { start: 1, end: 1, lines: ["A1", "A2"] },
      { start: 3, end: 2, lines: ["inserted"] },
    ]);
    expect(text).toBe([anchor, "A1", "A2", "b", "inserted", "c"].join("\r\n"));
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
      expect(insertRelease(changelogDocument(text), section, undefined)).toBe(
        expected,
      );
    },
  );
});
