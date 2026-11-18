import { describe, expect, test } from "bun:test";
import { supportsColor } from "./terminal.ts";

describe("colour support", () => {
  test.each([
    ["a terminal", true, {}, true],
    ["a pipe", false, {}, false],
    ["a dumb terminal", true, { TERM: "dumb" }, false],
    ["a terminal with NO_COLOR", true, { NO_COLOR: "1" }, false],
    ["a terminal with an empty NO_COLOR", true, { NO_COLOR: "" }, true],
    ["a pipe with FORCE_COLOR", false, { FORCE_COLOR: "1" }, true],
    ["a pipe with an empty FORCE_COLOR", false, { FORCE_COLOR: "" }, true],
    ["a terminal with FORCE_COLOR=0", true, { FORCE_COLOR: "0" }, false],
    [
      "a terminal with FORCE_COLOR=false",
      true,
      { FORCE_COLOR: "false" },
      false,
    ],
    [
      "FORCE_COLOR over NO_COLOR",
      false,
      { FORCE_COLOR: "1", NO_COLOR: "1" },
      true,
    ],
  ])("%s gets colours: %p", (_case, isTerminal, env, expected) => {
    expect(supportsColor(isTerminal, env)).toBe(expected);
  });
});
