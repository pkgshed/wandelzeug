import { describe, expect, test } from "bun:test";
import { autoBump } from "../changelog/releases.ts";
import { DEFAULT_CONFIG } from "../project/config.ts";
import { change, projectWith } from "../test-helpers.ts";
import {
  fragmentFileName,
  nextSequence,
  parseChange,
  serializeChange,
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
    ["---\npr: 1\n---\n* Crash\n", /front matter needs a kind/],
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

  test("the default file name joins sequence, kind and title", () => {
    const project = projectWith({});
    const fileName = fragmentFileName(
      project,
      1,
      change("Added", "* Support for TOML config"),
    );
    expect(fileName).toBe("001-added-support-for-toml-config.md");
  });

  test("an optional pull request appears only when given", () => {
    const project = projectWith({
      fragmentName: "{{#pr}}{{pr}}-{{/pr}}{{kind}}-{{title}}",
      titleMaxLength: 11,
    });
    const withPr = change("Fixed", "* Crash on empty input", { pr: 42 });
    const withoutPr = change("Fixed", "* Crash on empty input");
    expect(fragmentFileName(project, 7, withPr)).toBe(
      "007-42-fixed-crash-on.md",
    );
    expect(fragmentFileName(project, 7, withoutPr)).toBe(
      "007-fixed-crash-on.md",
    );
  });

  test("nextSequence follows the highest numbered fragment", () => {
    expect(nextSequence([])).toBe(1);
    expect(
      nextSequence([
        ".gitkeep",
        "001-a.md",
        "010-b.md",
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
    expect(() =>
      autoBump([change("Noted", "* A")], [{ label: "Noted", bump: undefined }]),
    ).toThrow(/no unreleased change has a kind with a bump/);
  });
});
