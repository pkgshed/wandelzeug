import { describe, expect, test } from "bun:test";
import { deriveTitle, slugify, truncateSlug } from "./slugs.ts";

describe("slugs and titles", () => {
  test.each([
    ["Support for TOML config", "support-for-toml-config"],
    ["Fix `--dry-run` crash!", "fix-dry-run-crash"],
    ["Café déjà vu", "cafe-deja-vu"],
    ["  ---  ", ""],
  ])("slugify(%p) is %p", (text, expected) => {
    expect(slugify(text)).toBe(expected);
  });

  test.each([
    ["support-for-toml-config", 12, "support-for"],
    ["support-for", 11, "support-for"],
    ["abcdefghij-k", 4, "abcd"],
  ] as const)("truncateSlug(%p, %p) is %p", (slug, maxLength, expected) => {
    expect(truncateSlug(slug, maxLength)).toBe(expected);
  });

  test.each([
    ["* Support for TOML\n  with details", "Support for TOML"],
    ["\n\n- Dashed item", "Dashed item"],
    ["1. Numbered item", "Numbered item"],
    ["Plain line", "Plain line"],
  ])("deriveTitle(%p) is %p", (body, expected) => {
    expect(deriveTitle(body)).toBe(expected);
  });
});
