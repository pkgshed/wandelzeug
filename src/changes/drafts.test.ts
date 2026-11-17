import { describe, expect, test } from "bun:test";
import { parseConfig } from "../project/config.ts";
import { change } from "../test-helpers.ts";
import { interpretDraft, renderDraft } from "./drafts.ts";
import type { ChangeOptions } from "./options.ts";

describe("drafts", () => {
  const config = parseConfig({
    kinds: ["Added", { label: "Fixed", bump: "patch" }],
    extraFields: [
      { key: "pr", prompt: "Pull request", type: "int", required: true },
      { key: "ticket", prompt: "Ticket" },
      { key: "area", type: "enum", enumOptions: ["cli", "docs"] },
      { key: "notes", prompt: "Notes", type: "block" },
    ],
  });

  const options = (overrides: Partial<ChangeOptions>): ChangeOptions => ({
    kind: undefined,
    body: undefined,
    metadata: {},
    givenKeys: new Set(),
    ...overrides,
  });

  test("a draft fills in the options and marks the missing fields", () => {
    const draft = renderDraft(
      config,
      options({
        kind: { label: "Fixed", bump: "patch" },
        body: "* Crash on start\n",
        metadata: { pr: 7 },
      }),
    );
    expect(draft).toBe(
      [
        "---",
        "# Kinds: Added, Fixed",
        "# Leave the body empty to cancel the change.",
        "kind: Fixed",
        "pr: 7",
        "ticket: # Ticket (string, optional)",
        "area: # area (one of cli, docs, optional)",
        'notes: # Notes (block, optional, write "|" and indent the lines)',
        "---",
        "* Crash on start",
        "",
      ].join("\n"),
    );
  });

  test("a draft without options leaves the kind and the body open", () => {
    const draft = renderDraft(config, options({}));
    expect(draft).toContain("\nkind:\npr: # Pull request (int, required)\n");
    expect(draft.endsWith("---\n* \n")).toBe(true);
  });

  test("an untouched draft cancels the change", () => {
    expect(interpretDraft(config, renderDraft(config, options({})))).toEqual({
      status: "empty",
    });
    expect(interpretDraft(config, "\n")).toEqual({ status: "empty" });
  });

  test("a valid draft yields a change with typed fields", () => {
    const text = [
      "---",
      "# comment",
      "kind: fixed",
      "pr: '#42'",
      "ticket:",
      "area: CLI",
      "notes: |",
      "  First line",
      "  Second line",
      "---",
      "* Crash on start",
      "",
    ].join("\n");
    expect(interpretDraft(config, text)).toEqual({
      status: "valid",
      change: change("Fixed", "* Crash on start", {
        pr: 42,
        area: "cli",
        notes: "First line\nSecond line",
      }),
    });
  });

  test.each([
    ["---\nkind: Improved\npr: 1\n---\n* Crash\n", /unknown kind "Improved"/],
    ["---\nkind: Fixed\n---\n* Crash\n", /missing required field "pr"/],
    ["kind: Fixed\n* Crash\n", /missing front matter/],
  ])("the draft %p is invalid with %p", (text, problem) => {
    const outcome = interpretDraft(config, text);
    expect(outcome.status).toBe("invalid");
    expect(
      outcome.status === "invalid" ? outcome.problems.join("\n") : "",
    ).toMatch(problem);
  });
});
