import { describe, expect, test } from "bun:test";
import { markdownBlocks } from "./markdown.ts";

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
});
