import { describe, expect, test } from "bun:test";
import { isoDate } from "../test-helpers.ts";
import {
  formatReleaseData,
  notesHash,
  parseReleaseData,
  type ReleaseData,
} from "./data.ts";

describe("release data", () => {
  test("notesHash is h1: and the base64 of the first 128 bits of SHA-256", () => {
    // The first 16 bytes of SHA-256("x") are 2d711642b726b04401627ca9fbac32f5.
    const hash: string = notesHash("x");
    expect(hash).toBe("h1:LXEWQrcmsEQBYnyp+6wy9Q==");
  });

  test("notesHash ignores line breaks and surrounding blank lines", () => {
    expect(notesHash("\n## 1.0.0\r\n\r\n* Fix\n\n")).toBe(
      notesHash("## 1.0.0\n\n* Fix"),
    );
    expect(notesHash("* Fix")).not.toBe(notesHash("* Fixed"));
  });

  const data: ReleaseData = {
    date: isoDate("2026-11-17"),
    hash: notesHash("notes"),
    changes: [
      {
        kind: "Added",
        metadata: { pr: 42, breaking: true, team: "core" },
        body: "* Support for TOML config\n\n  ```toml\n  key = 1\n  ```",
      },
      { kind: "Fixed", metadata: {}, body: "  * Indented first line" },
      { kind: "Fixed", metadata: { note: "a --> b" }, body: "* A --!> B" },
    ],
  };

  test("a data block parses back into the same data", () => {
    expect(parseReleaseData(formatReleaseData(data).join("\n"))).toEqual(data);
  });

  test("a data block never holds the end of an HTML comment", () => {
    const text = formatReleaseData(data).join("\n");
    expect(text).not.toMatch(/--!?>/);
    expect(text).toContain('note: "a -\\x2D> b"');
  });

  test("a data block groups the changes by kind, in the order of their first change", () => {
    expect(
      formatReleaseData({
        ...data,
        changes: [
          { kind: "Added", metadata: { pr: 7 }, body: "* One\n* Two" },
          { kind: "Fixed", metadata: {}, body: "* Crash" },
          { kind: "Added", metadata: {}, body: "* Three" },
        ],
      }),
    ).toEqual([
      "date: 2026-11-17",
      `hash: ${data.hash}`,
      "changes:",
      "  Added:",
      "    - pr: 7",
      "      body: |-",
      "        * One",
      "        * Two",
      '    - body: "* Three"',
      "  Fixed:",
      '    - body: "* Crash"',
    ]);
  });

  test("a kind that holds --> stays inside the comment", () => {
    const text = formatReleaseData({
      ...data,
      changes: [{ kind: "A --> B", metadata: {}, body: "* x" }],
    }).join("\n");
    expect(text).toContain('  "A -\\x2D> B":');
    expect(parseReleaseData(text).changes[0]?.kind).toBe("A --> B");
  });

  const header = `date: 2026-11-17\nhash: ${notesHash("x")}`;
  test.each([
    ["- a list", "the data block must be a mapping"],
    ["date: 2026-11-17\nauthor: me", 'unknown data block key "author"'],
    [`date: 2026-13-01\nhash: ${notesHash("x")}`, "date must be a date"],
    [
      `${header}\nchanges: {}`,
      "changes must map each kind to a list of changes",
    ],
    [
      `${header}\nchanges:\n  - body: "* Fix"`,
      "changes must map each kind to a list of changes",
    ],
    [
      `${header}\nchanges:\n  Fixed: []`,
      "changes.Fixed must be a non-empty list",
    ],
    [
      `${header}\nchanges:\n  Fixed:\n    - pr: 1`,
      "changes.Fixed[0]: body is missing",
    ],
    [
      `${header}\nchanges:\n  Fixed:\n    - body: "* "`,
      "changes.Fixed[0]: body is empty",
    ],
    [
      `${header}\nchanges:\n  Fixed:\n    - kind: Added\n      body: "* x"`,
      "changes.Fixed[0]: kind comes from the group that holds the change",
    ],
  ])("parseReleaseData rejects %p with %p", (yaml, message) => {
    expect(() => parseReleaseData(yaml)).toThrow(message);
  });
});
