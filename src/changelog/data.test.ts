import { describe, expect, test } from "bun:test";
import { breakingChange, change, isoDate } from "../test-helpers.ts";
import {
  formatDataAttributes,
  formatDataChanges,
  notesHash,
  parseReleaseData,
  type ReleaseData,
} from "./data.ts";

describe("release data", () => {
  test("notesHash is h1: and the base64 of the first 128 bits of SHA-256", () => {
    // The first 16 bytes of SHA-256("x") are 2d711642b726b04401627ca9fbac32f5.
    const hash: string = notesHash("x");
    expect(hash).toBe("h1:LXEWQrcmsEQBYnyp+6wy9Q");
  });

  test("a hash with the padding of wandelzeug 0.2.1 parses into the short form", () => {
    const short = notesHash("x");
    const parsed = parseReleaseData(
      `date=2026-11-17 hash=${short}==`,
      'Fixed:\n  - body: "* Crash"',
    );
    expect(parsed.hash).toBe(short);
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
        breaking: true,
        metadata: { pr: 42, draft: true, team: "core" },
        body: "* Support for TOML config\n\n  ```toml\n  key = 1\n  ```",
      },
      change("Fixed", "  * Indented first line"),
      change("Fixed", "* A --!> B", { note: "a --> b" }),
    ],
  };

  /** Formats a data block and parses it back, as the changelog markers do. */
  const roundTrip = (release: ReleaseData) =>
    parseReleaseData(
      formatDataAttributes(release),
      formatDataChanges(release.changes).join("\n"),
    );

  test("a data block parses back into the same data", () => {
    expect(roundTrip(data)).toEqual(data);
  });

  test("the date and the hash become attributes", () => {
    expect(formatDataAttributes(data)).toBe(
      `date=2026-11-17 hash=${data.hash}`,
    );
  });

  test("a data block never holds the end of an HTML comment", () => {
    const text = formatDataChanges(data.changes).join("\n");
    expect(text).not.toMatch(/--!?>/);
    expect(text).toContain('note: "a -\\x2D> b"');
  });

  test("the changes group by kind, in the order of their first change", () => {
    expect(
      formatDataChanges([
        change("Added", "* One\n* Two", { pr: 7 }),
        change("Fixed", "* Crash"),
        breakingChange("Added", "* Three", { pr: 8 }),
      ]),
    ).toEqual([
      "Added:",
      "  - pr: 7",
      "    body: |-",
      "      * One",
      "      * Two",
      "  - breaking: true",
      "    pr: 8",
      '    body: "* Three"',
      "Fixed:",
      '  - body: "* Crash"',
    ]);
  });

  test("a change without breaking: true does not break, whatever its kind", () => {
    const parsed = parseReleaseData(
      `date=2026-11-17 hash=${notesHash("x")}`,
      'Removed:\n  - body: "* Option"',
    );
    expect(parsed.changes).toEqual([change("Removed", "* Option")]);
  });

  test("a kind that holds --> stays inside the comment", () => {
    const tricky = {
      ...data,
      changes: [change("A --> B", "* x")],
    };
    expect(formatDataChanges(tricky.changes)).toContain('"A -\\x2D> B":');
    expect(roundTrip(tricky).changes[0]?.kind).toBe("A --> B");
  });

  const attributes = `date=2026-11-17 hash=${notesHash("x")}`;
  const changes = 'Fixed:\n  - body: "* Crash"';
  test.each([
    ["", changes, "the data block needs date=YYYY-MM-DD"],
    [
      `date=2026-13-01 hash=${notesHash("x")}`,
      changes,
      "needs date=YYYY-MM-DD",
    ],
    ["date=2026-11-17 hash=h1:short", changes, 'needs hash= with "h1:"'],
    [`${attributes} author=me`, changes, 'unknown data attribute "author=me"'],
    [`${attributes} date=2026-11-18`, changes, "date appears twice"],
    [attributes, "", "the data block must map each kind to a list of changes"],
    [
      attributes,
      '- body: "* Fix"',
      "the data block must map each kind to a list of changes",
    ],
    [attributes, "Fixed: []", "Fixed must hold a non-empty list of changes"],
    [attributes, "Fixed:\n  - pr: 1", "Fixed[0]: body is missing"],
    [attributes, 'Fixed:\n  - body: "* "', "Fixed[0]: body is empty"],
    [
      attributes,
      'Fixed:\n  - kind: Added\n    body: "* x"',
      "Fixed[0]: kind comes from the group that holds the change",
    ],
  ])("attributes %p with changes %p fail with %p", (head, yaml, message) => {
    expect(() => parseReleaseData(head, yaml)).toThrow(message);
  });
});
