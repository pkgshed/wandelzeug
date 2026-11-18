import { describe, expect, test } from "bun:test";
import { projectWith } from "../test-helpers.ts";
import { DEFAULT_CONFIG, parseConfig } from "./config.ts";
import { initConfig } from "./setup.ts";

describe("configuration", () => {
  test("an empty configuration uses the defaults", () => {
    expect(parseConfig(null)).toEqual(DEFAULT_CONFIG);
  });

  test("the configuration written by init spells out the defaults", () => {
    expect(parseConfig(Bun.YAML.parse(initConfig("")))).toEqual(DEFAULT_CONFIG);
  });

  test("empty YAML values take the defaults", () => {
    const config = parseConfig({ repositoryUrl: null, extraFields: null });
    expect(config.repositoryUrl).toBe(DEFAULT_CONFIG.repositoryUrl);
    expect(config.extraFields).toEqual([]);
  });

  test("every problem is reported, one per line", () => {
    expect(() =>
      parseConfig({ titleMaxLength: 0, kinds: [7], colour: "red" }),
    ).toThrow(
      [
        "titleMaxLength: must be a positive integer",
        "kinds[0]: must be a label or a mapping",
        'unknown setting "colour"',
      ].join("\n"),
    );
  });

  test("kinds may be bare labels", () => {
    const config = parseConfig({
      kinds: ["Added", { label: "Fixed", bump: "patch" }],
    });
    expect(config.kinds).toEqual([
      { label: "Added", bump: undefined },
      { label: "Fixed", bump: "patch" },
    ]);
  });

  const invalid: [Record<string, unknown>, RegExp][] = [
    [{ changesdir: ".changes" }, /unknown setting "changesdir"/],
    [{ changesDir: ".changes" }, /unknown setting "changesDir"/],
    [{ titleMaxLength: 0 }, /titleMaxLength: must be a positive integer/],
    [{ kinds: [] }, /kinds: must be a non-empty list/],
    [{ kinds: ["Added", "added"] }, /duplicate label "added"/],
    [
      { kinds: [{ label: "Added", bump: "huge" }] },
      /kinds\[0\]\.bump: must be one of: major, minor, patch/,
    ],
    [
      { kinds: [{ label: "Added", colour: "red" }] },
      /kinds\[0\]: unknown setting "colour"/,
    ],
    [
      { fragmentName: "{{kind}}/{{title}}" },
      /must not contain path separators/,
    ],
    [
      { versionFormat: "## {{verison}}" },
      /versionFormat: unknown value \{\{verison\}\}, expected one of: version, date/,
    ],
    [
      { kindFormat: "### {{kind" },
      /kindFormat: template "### \{\{kind": Unclosed tag at 10/,
    ],
    [
      { changeFormat: "{{> change}}" },
      /changeFormat: the partial \{\{> change\}\} belongs in releaseTemplate/,
    ],
    [
      { releaseTemplate: "{{> heading}}" },
      /releaseTemplate: unknown partial \{\{> heading\}\}, expected one of: version, kind, change/,
    ],
    [
      { releaseTemplate: "{{#kinds}}" },
      /releaseTemplate: template "\{\{#kinds\}\}": Unclosed section "kinds"/,
    ],
    [{ releaseTemplate: 7 }, /releaseTemplate: must be a string/],
    [{ fields: [] }, /unknown setting "fields"/],
    [{ headerPath: "header.md" }, /unknown setting "headerPath"/],
    [{ extraFields: { key: "pr" } }, /extraFields: must be a list/],
    [
      { extraFields: [{ key: "title" }] },
      /extraFields\[0\]\.key: "title" is reserved/,
    ],
    [
      { extraFields: [{ key: "pr-id" }] },
      /extraFields\[0\]\.key: must be letters, digits and underscores, not starting with a digit/,
    ],
    [
      { extraFields: [{ key: "pr", type: "integer" }] },
      /extraFields\[0\]\.type: must be one of: string, block, int, enum, enums/,
    ],
    [
      { extraFields: [{ key: "pr", required: "yes" }] },
      /extraFields\[0\]\.required: must be true or false/,
    ],
    [
      { extraFields: [{ key: "pr", prompt: "Pull\nrequest" }] },
      /extraFields\[0\]\.prompt: must be a single line of text/,
    ],
    [
      { extraFields: [{ key: "pr", colour: "red" }] },
      /extraFields\[0\]: unknown setting "colour" for type string/,
    ],
    [
      { extraFields: [{ key: "pr", minInt: 1 }] },
      /extraFields\[0\]: unknown setting "minInt" for type string/,
    ],
    [
      { extraFields: [{ key: "pr", type: "int", minLength: 1 }] },
      /extraFields\[0\]: unknown setting "minLength" for type int/,
    ],
    [
      { extraFields: [{ key: "pr", type: "int", minInt: 1.5 }] },
      /extraFields\[0\]\.minInt: must be a whole number/,
    ],
    [
      { extraFields: [{ key: "pr", type: "int", minInt: 5, maxInt: 2 }] },
      /extraFields\[0\]: minInt 5 exceeds maxInt 2/,
    ],
    [
      { extraFields: [{ key: "name", minLength: -1 }] },
      /extraFields\[0\]\.minLength: must be at least 0/,
    ],
    [
      { extraFields: [{ key: "area", type: "enum" }] },
      /extraFields\[0\]\.enumOptions: is required/,
    ],
    [
      {
        extraFields: [
          { key: "area", type: "enum", enumOptions: ["cli", "CLI"] },
        ],
      },
      /extraFields\[0\]\.enumOptions: duplicate option "cli"/,
    ],
    [
      { extraFields: [{ key: "area", type: "enums", enumOptions: ["a, b"] }] },
      /options of an enums field may not contain commas/,
    ],
    [
      { extraFields: [{ key: "pr" }, { key: "pr" }] },
      /extraFields: duplicate key "pr"/,
    ],
    [
      { extraFields: [{ key: "ticket", pattern: "(" }] },
      /extraFields\[0\]\.pattern: Invalid regular expression/,
    ],
    [
      { extraFields: [{ key: "notes", type: "block", pattern: "x" }] },
      /extraFields\[0\]: unknown setting "pattern" for type block/,
    ],
    [
      { extraFields: [{ key: "pr", type: "int", pattern: "x" }] },
      /extraFields\[0\]: unknown setting "pattern" for type int/,
    ],
    [
      { extraFields: [{ key: "pr", type: "int", label: "#{{pr}}" }] },
      /extraFields\[0\]: label needs url/,
    ],
    [
      { extraFields: [{ key: "issue", url: "https://x/{{issue}}" }] },
      /extraFields\[0\]: url needs a pattern, which finds the references in the notes/,
    ],
    [
      { extraFields: [{ key: "notes", type: "block", url: "https://x" }] },
      /extraFields\[0\]: unknown setting "url" for type block/,
    ],
    [
      { extraFields: [{ key: "pr", type: "int", url: "https://x/{{id}}" }] },
      /extraFields\[0\]\.url: unknown value \{\{id\}\}, expected one of: pr, repositoryUrl/,
    ],
    [
      {
        extraFields: [
          { key: "pr", type: "int", url: "https://x/{{pr}}", label: "#{{id}}" },
        ],
      },
      /extraFields\[0\]\.label: unknown value \{\{id\}\}, expected one of: pr/,
    ],
    [
      {
        extraFields: [
          { key: "pr", type: "int", url: "https://x/{{pr}}", label: "PR" },
        ],
      },
      /extraFields\[0\]\.label: must place \{\{pr\}\} exactly once between fixed text/,
    ],
    [{ releaseData: "yes" }, /releaseData: must be true or false/],
    [
      { replacements: { path: "package.json" } },
      /replacements: must be a list/,
    ],
    [
      { replacements: [{ path: "package.json", find: "x" }] },
      /replacements\[0\]\.replace: is required/,
    ],
    [
      { replacements: [{ path: "package.json", find: "", replace: "" }] },
      /replacements\[0\]\.find: must be a non-empty regular expression/,
    ],
    [
      { replacements: [{ path: "p", find: "x", replace: "", flags: "i" }] },
      /replacements\[0\]: unknown setting "flags"/,
    ],
    [
      { replacements: [{ path: "package.json", find: "(", replace: "" }] },
      /replacements\[0\]\.find: Invalid regular expression/,
    ],
    [
      { replacements: [{ path: "p", find: "x", replace: "{{verison}}" }] },
      /replacements\[0\]\.replace: unknown value \{\{verison\}\}, expected one of: version/,
    ],
    [
      { replacements: [{ path: "./CHANGELOG.md", find: "x", replace: "" }] },
      /replacements\[0\]\.path: the changelog takes no replacements/,
    ],
  ];

  test.each(invalid)("%p is rejected with %p", (settings, message) => {
    expect(() => projectWith(settings)).toThrow(message);
  });
});
