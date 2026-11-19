import { describe, expect, test } from "bun:test";
import { autoBump } from "../changelog/releases.ts";
import { DEFAULT_CONFIG } from "../project/config.ts";
import { breakingChange, change, projectWith } from "../test-helpers.ts";
import {
  emptyFileName,
  encodeFragmentId,
  type FragmentId,
  fragmentFileName,
  nextSequence,
  parseChange,
  parseChangeFile,
  randomFragmentId,
  serializeChange,
  serializeEmptyChange,
} from "./fragments.ts";

describe("fragments", () => {
  const kinds = DEFAULT_CONFIG.kinds;
  const example = "---\nkind: Added\npr: 42\n---\n* Support for TOML config\n";

  test("parseChange reads the documented format", () => {
    expect(parseChange(example, kinds)).toEqual(
      change("Added", "* Support for TOML config", { pr: 42 }),
    );
  });

  test("serializeChange writes what parseChange reads", () => {
    const original = change("Fixed", "* Crash on start\n* Hang on exit", {
      mr: "!7",
      pr: 3,
    });
    expect(parseChange(serializeChange(original), kinds)).toEqual(original);
    expect(
      serializeChange(change("Added", "* Support for TOML config", { pr: 42 })),
    ).toBe(example);
  });

  test("serializeChange writes text with line breaks as a literal block", () => {
    const original = change("Changed", "* Rename a flag", {
      notes: "Use -n instead.\n\nScripts: need an update.",
      n: " indented\nsecond",
    });
    const text = serializeChange(original);
    expect(text).toBe(
      [
        "---",
        "kind: Changed",
        "notes: |-",
        "  Use -n instead.",
        "",
        "  Scripts: need an update.",
        '"n": |2-',
        "   indented",
        "  second",
        "---",
        "* Rename a flag",
        "",
      ].join("\n"),
    );
    expect(parseChange(text, kinds)).toEqual(original);
  });

  test("parseChange matches kinds without regard to case", () => {
    expect(parseChange("---\nkind: fixed\n---\n* Crash\n", kinds).kind).toBe(
      "Fixed",
    );
  });

  test("parseChange leaves out empty front matter values", () => {
    expect(
      parseChange("---\nkind: Fixed\npr:\n---\n* Crash\n", kinds).metadata,
    ).toEqual({});
  });

  const invalid: [string, RegExp][] = [
    ["* Crash\n", /missing front matter/],
    ["---\nkind: Fixed\n* Crash\n", /unterminated front matter/],
    ["---\npr: 1\n---\n* Crash\n", /kind is missing/],
    ["---\nkind: Improved\n---\n* Crash\n", /unknown kind "Improved"/],
    ["---\nkind: Fixed\n---\n\n", /body is empty/],
    ["---\nkind: Fixed\n---\n* \n", /body is empty/],
    [
      "---\nkind: Fixed\ntitle: Crash\n---\n* Crash\n",
      /metadata key "title" is reserved/,
    ],
    [
      "---\nkind: Fixed\nprs: [1, 2]\n---\n* Crash\n",
      /metadata "prs" must be a string/,
    ],
  ];

  test.each(invalid)("parseChange rejects %p with %p", (text, message) => {
    expect(() => parseChange(text, kinds)).toThrow(message);
  });

  const id = "k7m2q" as FragmentId;

  test("the default file name joins sequence, ID, kind and title", () => {
    const project = projectWith({});
    const fileName = fragmentFileName(
      project,
      1,
      id,
      change("Added", "* Support for TOML config"),
    );
    expect(fileName).toBe("001-k7m2q-added-support-for-toml-config.md");
  });

  test("an empty fragmentName leaves sequence and ID", () => {
    const project = projectWith({ fragmentName: "" });
    const fileName = fragmentFileName(project, 12, id, change("Fixed", "* A"));
    expect(fileName).toBe("012-k7m2q.md");
  });

  test("encodeFragmentId maps the low five bits of each byte to Crockford's base32", () => {
    const encoded: string = encodeFragmentId(
      Uint8Array.of(0, 9, 10, 31, 0b1110_0001),
    );
    expect(encoded).toBe("09az1");
  });

  test("encodeFragmentId skips i, l, o and u", () => {
    const encoded: string = encodeFragmentId(Uint8Array.of(18, 19, 20, 21, 27));
    expect(encoded).toBe("jkmnv");
  });

  test.each([0, 4, 6])("encodeFragmentId rejects %p bytes", (length) => {
    expect(() => encodeFragmentId(new Uint8Array(length))).toThrow(
      `a fragment ID needs 5 bytes, got ${length}`,
    );
  });

  test("randomFragmentId draws five characters of Crockford's base32", () => {
    expect(randomFragmentId()).toMatch(/^[0-9a-hjkmnp-tv-z]{5}$/);
  });

  test("an optional pull request appears only when given", () => {
    const project = projectWith({
      fragmentName: "{{#pr}}{{pr}}-{{/pr}}{{kind}}-{{title}}",
      titleMaxLength: 11,
    });
    const withPr = change("Fixed", "* Crash on empty input", { pr: 42 });
    const withoutPr = change("Fixed", "* Crash on empty input");
    expect(fragmentFileName(project, 7, id, withPr)).toBe(
      "007-k7m2q-42-fixed-crash-on.md",
    );
    expect(fragmentFileName(project, 7, id, withoutPr)).toBe(
      "007-k7m2q-fixed-crash-on.md",
    );
  });

  test("nextSequence follows the highest numbered fragment", () => {
    expect(nextSequence([])).toBe(1);
    expect(
      nextSequence([
        ".gitkeep",
        "001-a.md",
        "010-k7m2q-b.md",
        "notes.txt",
        "x.md",
        "011.txt",
      ]),
    ).toBe(11);
  });

  test("autoBump picks the most significant bump", () => {
    const kinds = DEFAULT_CONFIG.kinds;
    expect(
      autoBump([change("Fixed", "* A"), change("Added", "* B")], kinds),
    ).toBe("minor");
    expect(autoBump([change("Fixed", "* A")], kinds)).toBe("patch");
    const noted = { label: "Noted", bump: undefined, breaking: "ask" } as const;
    expect(() => autoBump([change("Noted", "* A")], [noted])).toThrow(
      /no unreleased change has a kind with a bump/,
    );
  });

  test("autoBump bumps the major version for a breaking change", () => {
    const kinds = DEFAULT_CONFIG.kinds;
    const changes = [change("Added", "* A"), breakingChange("Fixed", "* B")];
    expect(autoBump(changes, kinds)).toBe("major");
    const noted = { label: "Noted", bump: undefined, breaking: "ask" } as const;
    expect(autoBump([breakingChange("Noted", "* A")], [noted])).toBe("major");
  });

  test.each([
    ["Fixed", "", false],
    ["Fixed", "breaking: true\n", true],
    ["Fixed", "breaking: false\n", false],
    ["Fixed", "breaking:\n", false],
    ["Removed", "", true],
    ["Removed", "breaking: true\n", true],
    ["Added", "", false],
    ["Added", "breaking: false\n", false],
  ])("a %p change with %p breaks: %p", (kind, entry, expected) => {
    const text = `---\nkind: ${kind}\n${entry}---\n* Change\n`;
    expect(parseChange(text, kinds).breaking).toBe(expected);
  });

  test.each([
    [
      "Added",
      "breaking: true",
      'breaking: true contradicts kind "Added", which never breaks',
    ],
    [
      "Removed",
      "breaking: false",
      'breaking: false contradicts kind "Removed", which always breaks',
    ],
    ["Fixed", "breaking: yes", "breaking must be true or false"],
  ])("a %p change rejects %p", (kind, entry, message) => {
    const text = `---\nkind: ${kind}\n${entry}\n---\n* Change\n`;
    expect(() => parseChange(text, kinds)).toThrow(message);
  });

  test.each([
    ["---\nempty: true\n---\n", undefined],
    ["---\nempty: true\n---\nRefactoring only\n", "Refactoring only"],
    ["---\nempty: true\n---\nLine one\nLine two\n", "Line one\nLine two"],
  ])("parseChangeFile reads the empty change %p", (text, reason) => {
    expect(parseChangeFile(text, kinds)).toEqual({ type: "empty", reason });
    expect(serializeEmptyChange({ type: "empty", reason })).toBe(text);
  });

  test("parseChangeFile reads a change as a change", () => {
    expect(parseChangeFile(example, kinds)).toEqual({
      type: "change",
      change: change("Added", "* Support for TOML config", { pr: 42 }),
    });
  });

  test.each([
    ["---\nempty: false\n---\n", "empty must be true"],
    ["---\nempty: yes\n---\n", "empty must be true"],
    [
      "---\nempty: true\nkind: Added\npr: 7\n---\n",
      'an empty change holds nothing besides its reason, found "kind", "pr"',
    ],
  ])("parseChangeFile rejects %p", (text, message) => {
    expect(() => parseChangeFile(text, kinds)).toThrow(message);
  });

  test("parseChange refuses an empty change", () => {
    expect(() => parseChange("---\nempty: true\n---\n", kinds)).toThrow(
      'empty: true marks an empty change, which "wlz new --empty" records',
    );
  });

  test("an empty change gets a file name of its own", () => {
    expect(emptyFileName(3, id)).toBe("003-k7m2q-empty.md");
  });

  test("serializeChange writes breaking only for a breaking change", () => {
    const text = serializeChange(breakingChange("Fixed", "* Crash", { pr: 7 }));
    expect(text).toBe(
      "---\nkind: Fixed\nbreaking: true\npr: 7\n---\n* Crash\n",
    );
    expect(parseChange(text, kinds)).toEqual(
      breakingChange("Fixed", "* Crash", { pr: 7 }),
    );
    expect(serializeChange(change("Fixed", "* Crash"))).not.toContain(
      "breaking",
    );
  });
});
