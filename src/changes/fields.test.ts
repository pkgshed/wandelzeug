import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CONFIG,
  type ExtraField,
  parseConfig,
} from "../project/config.ts";
import { applyExtraFields } from "./fields.ts";
import type { Metadata } from "./fragments.ts";
import { readChangeOptions } from "./options.ts";

describe("extra fields", () => {
  /** Parses one extra field the way a configuration file would declare it. */
  const extraField = (settings: Record<string, unknown>): ExtraField => {
    const [field] = parseConfig({ extraFields: [settings] }).extraFields;
    if (field === undefined) throw new Error("test field did not parse");
    return field;
  };

  const prField = extraField({
    key: "pr",
    type: "int",
    minInt: 1,
    required: true,
  });
  const offsetField = extraField({ key: "offset", type: "int" });
  const nameField = extraField({ key: "name", minLength: 2, maxLength: 5 });
  const notesField = extraField({ key: "notes", type: "block" });
  const ticketField = extraField({ key: "ticket", pattern: "FOO-\\d{1,9}" });
  const areaField = extraField({
    key: "area",
    type: "enum",
    enumOptions: ["cli", "docs"],
  });
  const areasField = extraField({
    key: "areas",
    type: "enums",
    enumOptions: ["cli", "docs", "tests"],
  });

  test("a field needs only a key", () => {
    expect(extraField({ key: "pr" })).toEqual({
      key: "pr",
      prompt: "pr",
      required: false,
      type: "string",
      minLength: undefined,
      maxLength: undefined,
      pattern: undefined,
    });
  });

  test("an empty extraFields entry means no extra fields", () => {
    expect(parseConfig({ extraFields: null }).extraFields).toEqual([]);
  });

  const accepted: [ExtraField, Metadata, Metadata][] = [
    [prField, { pr: "#42" }, { pr: 42 }],
    [prField, { pr: "!7" }, { pr: 7 }],
    [prField, { pr: 12 }, { pr: 12 }],
    [offsetField, { offset: "-3" }, { offset: -3 }],
    [nameField, { name: 123 }, { name: "123" }],
    [nameField, { name: "  ann " }, { name: "ann" }],
    [
      notesField,
      { notes: "line one\nline two\n" },
      { notes: "line one\nline two" },
    ],
    [ticketField, { ticket: " FOO-1234 " }, { ticket: "FOO-1234" }],
    [areaField, { area: "Docs" }, { area: "docs" }],
    [areasField, { areas: "tests, CLI" }, { areas: "cli, tests" }],
    [areasField, { areas: "docs,docs" }, { areas: "docs" }],
    [offsetField, { offset: "" }, {}],
    [areaField, { team: "core" }, { team: "core" }],
  ];

  test.each(accepted)("%p reads %p as %p", (field, metadata, expected) => {
    expect(applyExtraFields([field], metadata)).toEqual({
      metadata: expected,
      problems: [],
    });
  });

  const rejected: [ExtraField, Metadata, string][] = [
    [prField, {}, 'missing required field "pr"'],
    [prField, { pr: " " }, 'missing required field "pr"'],
    [prField, { pr: "abc" }, 'field "pr" expects an integer, got "abc"'],
    [prField, { pr: 1.5 }, 'field "pr" expects an integer, got 1.5'],
    [prField, { pr: 0 }, 'field "pr" must be at least 1, got 0'],
    [
      nameField,
      { name: "a" },
      'field "name" needs at least 2 characters, got 1',
    ],
    [
      nameField,
      { name: "abcdef" },
      'field "name" allows at most 5 characters, got 6',
    ],
    [
      nameField,
      { name: "a\nb" },
      'field "name" must be a single line, type block allows more',
    ],
    [
      ticketField,
      { ticket: "BAR-1" },
      'field "ticket" must match FOO-\\d{1,9}, got "BAR-1"',
    ],
    [
      ticketField,
      { ticket: "xFOO-1" },
      'field "ticket" must match FOO-\\d{1,9}, got "xFOO-1"',
    ],
    [
      areaField,
      { area: "web" },
      'field "area" must be one of cli, docs, got "web"',
    ],
    [
      areasField,
      { areas: "cli, web" },
      'field "areas" accepts only cli, docs, tests, got "web"',
    ],
  ];

  test.each(rejected)("%p rejects %p with %p", (field, metadata, problem) => {
    expect(applyExtraFields([field], metadata).problems).toEqual([problem]);
  });

  test("readChangeOptions remembers keys given without a value", async () => {
    const options = await readChangeOptions(DEFAULT_CONFIG.kinds, {
      kind: "fixed",
      meta: [
        ["pr", "7"],
        ["ticket", ""],
        [" team", " core "],
      ],
    });
    expect(options).toEqual({
      kind: { label: "Fixed", bump: "patch" },
      body: undefined,
      metadata: { pr: 7, team: "core" },
      givenKeys: new Set(["pr", "ticket", "team"]),
    });
  });
});
