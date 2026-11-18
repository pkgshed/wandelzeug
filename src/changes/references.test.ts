import { describe, expect, test } from "bun:test";
import { parseTemplate } from "../shared/templates.ts";
import { projectWith } from "../test-helpers.ts";
import { findReferences, labelRecognizer } from "./references.ts";

describe("references", () => {
  const project = projectWith({
    repositoryUrl: "https://github.com/o/r/",
    extraFields: [
      {
        key: "issue",
        pattern: "FOO-\\d{1,9}",
        url: "https://jira.corp.com/browse/{{issue}}",
      },
      {
        key: "pr",
        type: "int",
        label: "#{{pr}}",
        url: "{{repositoryUrl}}/pull/{{pr}}",
      },
    ],
  });

  test("a label recognizes its values between its fixed text", () => {
    const recognizer = labelRecognizer(
      parseTemplate("PR #{{pr}}."),
      "pr",
      "\\d+",
    );
    expect(recognizer.exec("PR #42.")?.[1]).toBe("42");
    expect(recognizer.test("PR #42")).toBe(false);
    expect(recognizer.test("PR x42.")).toBe(false);
  });

  test.each(["{{pr}}-{{pr}}", "#"])("the label %p fails", (label) => {
    expect(() => labelRecognizer(parseTemplate(label), "pr", "\\d+")).toThrow(
      "must place {{pr}} exactly once between fixed text",
    );
  });

  test("references come once each, in the order of the notes", () => {
    const notes = "* [FOO-1] and [#42]\n* Again [FOO-1], [FOO-2], and [BAR-3]";
    expect(findReferences(project, notes)).toEqual([
      { label: "FOO-1", url: "https://jira.corp.com/browse/FOO-1" },
      { label: "#42", url: "https://github.com/o/r/pull/42" },
      { label: "FOO-2", url: "https://jira.corp.com/browse/FOO-2" },
    ]);
  });

  test("GitLab merge requests and issues differ by their prefix", () => {
    const gitlab = projectWith({
      repositoryUrl: "https://gitlab.com/o/r",
      extraFields: [
        {
          key: "mr",
          type: "int",
          label: "!{{mr}}",
          url: "{{repositoryUrl}}/-/merge_requests/{{mr}}",
        },
        {
          key: "issue",
          type: "int",
          label: "#{{issue}}",
          url: "{{repositoryUrl}}/-/issues/{{issue}}",
        },
      ],
    });
    const notes = "* Fixes [#7] in [!42], not ![!43](logo.png) or `[#8]`";
    expect(findReferences(gitlab, notes)).toEqual([
      { label: "#7", url: "https://gitlab.com/o/r/-/issues/7" },
      { label: "!42", url: "https://gitlab.com/o/r/-/merge_requests/42" },
    ]);
  });

  test("a field without a url makes no references", () => {
    const plain = projectWith({
      extraFields: [{ key: "issue", pattern: "FOO-\\d+" }],
    });
    expect(findReferences(plain, "* [FOO-1]")).toEqual([]);
  });
});
