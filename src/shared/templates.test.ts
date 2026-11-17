import { describe, expect, test } from "bun:test";
import {
  isFieldName,
  parseTemplate,
  renderTemplate,
  type TemplateView,
} from "./templates.ts";

describe("templates", () => {
  const cases: [string, TemplateView, string][] = [
    ["{{kind}}-{{title}}", { kind: "added", title: "foo" }, "added-foo"],
    ["{{#pr}}{{pr}}-{{/pr}}{{kind}}", { kind: "added", pr: 42 }, "42-added"],
    ["{{#pr}}{{pr}}-{{/pr}}{{kind}}", { kind: "added" }, "added"],
    ["{{#pr}}{{pr}}-{{/pr}}{{kind}}", { kind: "added", pr: "" }, "added"],
    ["{{missing}}|", {}, "|"],
    [
      "{{#breaking}}**Breaking:** {{/breaking}}x",
      { breaking: true },
      "**Breaking:** x",
    ],
    [
      "{{body}}",
      { body: "* Use `--dry-run` & <b>" },
      "* Use `--dry-run` & <b>",
    ],
    ["{{#items}}[{{.}}]{{/items}}", { items: ["a", "b"] }, "[a][b]"],
  ];

  test.each(cases)("%p with %p renders %p", (source, view, expected) => {
    expect(renderTemplate(parseTemplate(source), view)).toBe(expected);
  });

  test("partials render with the same values", () => {
    const template = parseTemplate("{{> heading}}!");
    const partials = { heading: "# {{title}}" };
    expect(renderTemplate(template, { title: "Hi" }, partials)).toBe("# Hi!");
  });

  test("parseTemplate reports the names of values, sections and partials", () => {
    const template = parseTemplate(
      "{{a}} {{{b}}} {{#c}}{{d}}{{> e}}{{/c}}{{^f}}x{{/f}}{{! note }}",
    );
    expect(template.names).toEqual(["a", "b", "c", "d", "f"]);
    expect(template.partials).toEqual(["e"]);
    expect(template.literalText).toBe("  x");
  });

  const malformed: [string, RegExp][] = [
    ["### {{kind", /template "### \{\{kind": Unclosed tag at 10/],
    ["{{#open}} never closed", /Unclosed section "open"/],
    ["{{#a}}{{/b}}", /Unclosed section "a"/],
  ];

  test.each(malformed)("parsing %p fails with %p", (source, message) => {
    expect(() => parseTemplate(source)).toThrow(message);
  });

  test.each([
    ["pr", true],
    ["_private2", true],
    ["2nd", false],
    ["pr-id", false],
    ["", false],
  ] as const)("isFieldName(%p) is %p", (text, expected) => {
    expect(isFieldName(text)).toBe(expected);
  });
});
