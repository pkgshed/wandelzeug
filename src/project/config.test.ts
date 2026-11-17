import { describe, expect, test } from "bun:test";
import { projectWith } from "../test-helpers.ts";
import { DEFAULT_CONFIG, parseConfig } from "./config.ts";
import { INIT_CONFIG } from "./setup.ts";

describe("configuration", () => {
  test("an empty configuration uses the defaults", () => {
    expect(parseConfig(null)).toEqual(DEFAULT_CONFIG);
  });

  test("the configuration written by init spells out the defaults", () => {
    expect(parseConfig(Bun.YAML.parse(INIT_CONFIG))).toEqual(DEFAULT_CONFIG);
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
    [{ titleMaxLength: 0 }, /titleMaxLength must be a positive integer/],
    [{ kinds: [] }, /kinds must be a non-empty list/],
    [{ kinds: ["Added", "added"] }, /duplicate label "added"/],
    [
      { kinds: [{ label: "Added", bump: "huge" }] },
      /kinds\[0\]\.bump must be one of/,
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
    [{ releaseTemplate: 7 }, /releaseTemplate must be a string/],
    [{ fields: [] }, /unknown setting "fields"/],
    [{ headerPath: "header.md" }, /unknown setting "headerPath"/],
    [{ extraFields: { key: "pr" } }, /extraFields must be a list/],
    [
      { extraFields: [{ key: "title" }] },
      /extraFields\[0\]\.key "title" is reserved/,
    ],
    [
      { extraFields: [{ key: "pr-id" }] },
      /extraFields\[0\]\.key must be letters, digits and underscores/,
    ],
    [
      { extraFields: [{ key: "pr", type: "integer" }] },
      /extraFields\[0\]\.type must be one of: string, block, int, enum, enums/,
    ],
    [
      { extraFields: [{ key: "pr", required: "yes" }] },
      /extraFields\[0\]\.required must be true or false/,
    ],
    [
      { extraFields: [{ key: "pr", prompt: "Pull\nrequest" }] },
      /extraFields\[0\]\.prompt must be a single line/,
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
      /extraFields\[0\]\.minInt must be a whole number/,
    ],
    [
      { extraFields: [{ key: "pr", type: "int", minInt: 5, maxInt: 2 }] },
      /extraFields\[0\]: minInt 5 exceeds maxInt 2/,
    ],
    [
      { extraFields: [{ key: "name", minLength: -1 }] },
      /extraFields\[0\]\.minLength must be at least 0/,
    ],
    [
      { extraFields: [{ key: "area", type: "enum" }] },
      /extraFields\[0\]\.enumOptions must be a non-empty list/,
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
  ];

  test.each(invalid)("%p is rejected with %p", (settings, message) => {
    expect(() => projectWith(settings)).toThrow(message);
  });
});
