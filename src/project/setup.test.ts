import { describe, expect, test } from "bun:test";
import { changelogDocument, release } from "../test-helpers.ts";
import { onboardChangelog } from "./setup.ts";

describe("onboarding", () => {
  test("the anchor goes above the first release heading, below Unreleased", () => {
    const text = [
      "# Changelog",
      "",
      "## [Unreleased]",
      "",
      "## [1.4.2] - 2025-03-02",
      "- Fix",
      "",
      "## [1.10.0-rc.1] - 2025-01-01",
      "",
      "## [1.4.1] - 2025-02-01",
      "",
      "[1.4.2]: https://example.invalid/compare/v1.4.1...v1.4.2",
      "",
    ].join("\n");
    const onboarding = onboardChangelog(text, undefined);
    expect(onboarding).toEqual({
      text: text.replace(
        "## [1.4.2]",
        "<!-- wlz:releases baseline=1.4.2 -->\n\n## [1.4.2]",
      ),
      anchorLine: 5,
      baseline: "1.4.2",
    });
    expect(changelogDocument(onboarding.text).baseline?.name).toBe("1.4.2");
  });

  test("a given baseline wins over the headings", () => {
    const onboarding = onboardChangelog("## 1.0.0\n", release("v1.2.0"));
    expect(onboarding.text).toBe(
      "<!-- wlz:releases baseline=v1.2.0 -->\n\n## 1.0.0\n",
    );
  });

  test("a prerelease is the baseline only without a stable release", () => {
    expect(onboardChangelog("## 2.0.0-rc.1\n", undefined).baseline).toBe(
      "2.0.0-rc.1",
    );
  });

  test.each([
    [
      "# History\n\nSome text\n",
      "# History\n\nSome text\n\n<!-- wlz:releases -->\n",
    ],
    ["# History", "# History\n\n<!-- wlz:releases -->\n"],
    ["# History\r\n", "# History\r\n\r\n<!-- wlz:releases -->\r\n"],
  ])(
    "without release headings, %p gets the anchor at the end",
    (text, expected) => {
      const onboarding = onboardChangelog(text, undefined);
      expect(onboarding.text).toBe(expected);
      expect(onboarding.baseline).toBeUndefined();
    },
  );

  test.each(["## 1.4.2.1", "## Version 1.4.2", "1.4.2", "## 01.4.2"])(
    "%p is no release heading",
    (heading) => {
      expect(
        onboardChangelog(`${heading}\n`, undefined).baseline,
      ).toBeUndefined();
    },
  );
});
