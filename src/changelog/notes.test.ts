import { describe, expect, test } from "bun:test";
import { changelogDocument, projectWith } from "../test-helpers.ts";
import { anchorMarker, LINKS_BEGIN, LINKS_END } from "./markers.ts";
import { usedDefinitions, withDefinitions } from "./notes.ts";

describe("notes outside the changelog", () => {
  const project = projectWith({
    extraFields: [
      {
        key: "issue",
        pattern: "FOO-\\d+",
        url: "https://jira.corp.com/browse/{{issue}}",
      },
    ],
  });
  const document = changelogDocument(
    [
      anchorMarker(undefined),
      "",
      LINKS_BEGIN,
      "[`1.1.0`]: https://example.com/compare/v1.0.0...v1.1.0",
      "[`1.0.0`]: https://example.com/releases/tag/v1.0.0",
      "[FOO-1]: https://tracker.example.com/FOO-1",
      LINKS_END,
      "",
    ].join("\n"),
  );

  test("the definitions follow the notes in their order, once each", () => {
    const notes =
      "## [`1.1.0`] (2026-11-18)\n\n* Fixes [FOO-2] and [FOO-1]\n* Again [FOO-2]";
    expect(usedDefinitions(project, document, notes)).toEqual([
      "[`1.1.0`]: https://example.com/compare/v1.0.0...v1.1.0",
      "[FOO-2]: https://jira.corp.com/browse/FOO-2",
      "[FOO-1]: https://tracker.example.com/FOO-1",
    ]);
  });

  test("notes without references use no definitions", () => {
    expect(usedDefinitions(project, document, "## 1.1.0\n\n* Fix")).toEqual([]);
  });

  test("withDefinitions appends the definitions after a blank line", () => {
    expect(
      withDefinitions("## 1.0.0\n\n* [FOO-1]\n", ["[FOO-1]: https://x"]),
    ).toBe("## 1.0.0\n\n* [FOO-1]\n\n[FOO-1]: https://x");
    expect(withDefinitions("## 1.0.0\n", [])).toBe("## 1.0.0\n");
  });
});
