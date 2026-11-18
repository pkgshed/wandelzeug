import { describe, expect, test } from "bun:test";
import {
  bracketedLabels,
  listItems,
  markdownBlocks,
  referencedLabels,
} from "./markdown.ts";

describe("markdown blocks", () => {
  test("blocks know their lines and keep the source of list items", () => {
    const text = [
      "## [1.4.2] - 2025-03-02",
      "",
      "### Added",
      "",
      "- One",
      "  continued",
      "",
      "- Two",
      "",
      "Some paragraph.",
      "",
      "```sh",
      "## not a heading",
      "```",
      "",
      "[`1.4.2`]: https://example.com",
    ].join("\n");

    expect(markdownBlocks(text)).toEqual([
      {
        type: "heading",
        depth: 2,
        text: "[1.4.2] - 2025-03-02",
        first: 0,
        last: 0,
      },
      { type: "heading", depth: 3, text: "Added", first: 2, last: 2 },
      {
        type: "list",
        items: ["- One\n  continued", "- Two"],
        first: 4,
        last: 7,
      },
      { type: "other", kind: "paragraph", first: 9, last: 9 },
      { type: "other", kind: "code", first: 11, last: 13 },
      { type: "definition", label: "`1.4.2`", first: 15, last: 15 },
    ]);
  });

  test("leading blank lines count towards the lines of the first block", () => {
    expect(markdownBlocks("\n\n# Title\n")).toEqual([
      { type: "heading", depth: 1, text: "Title", first: 2, last: 2 },
    ]);
  });

  test("listItems splits each top-level item into its marker and its text", () => {
    expect(
      listItems("* One\n  continued\n\n- Two\n  - nested\n\n10. Three"),
    ).toEqual([
      { marker: "* ", text: "One\n  continued", body: "* One\n  continued" },
      { marker: "- ", text: "Two\n  - nested", body: "- Two\n  - nested" },
      { marker: "10. ", text: "Three", body: "10. Three" },
    ]);
  });

  test.each(["A paragraph", "* One\n\nA paragraph", "```\n* code\n```", ""])(
    "listItems finds no items in %p",
    (markdown) => {
      expect(listItems(markdown)).toBeUndefined();
    },
  );

  test("bracketedLabels finds labels outside code, links and escapes", () => {
    const markdown = [
      "## [`1.6.0`] (2026-11-17)",
      "",
      "* Fixes [FOO-1] and [FOO-2], not `[FOO-3]`, \\[FOO-4\\], or [FOO-5](https://x)",
      "  - nested **[#42]**",
      "",
      "```",
      "[FOO-7]",
      "```",
    ].join("\n");
    expect(bracketedLabels(markdown)).toEqual(["FOO-1", "FOO-2", "#42"]);
  });

  test("referencedLabels finds the references that resolve to a definition", () => {
    const notes = [
      "## [`0.2.0`] (2026-11-18)",
      "",
      "* Fixes [FOO-1], [the bug][FOO-2], and [FOO-3][]",
      "* Not `[FOO-1]`, [FOO-4](https://x), \\[FOO-1\\], or [unknown]",
    ].join("\n");
    const definitions = [
      "[`0.2.0`]: https://a",
      "[FOO-1]: https://b",
      "[FOO-2]: https://c",
      "[FOO-3]: https://d",
      "[FOO-4]: https://e",
    ];
    expect(referencedLabels(notes, definitions)).toEqual([
      "`0.2.0`",
      "FOO-1",
      "FOO-2",
      "FOO-3",
    ]);
  });
});
