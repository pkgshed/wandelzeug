import { describe, expect, test } from "bun:test";
import { nextVersion } from "../changelog/releases.ts";
import { release, version } from "../test-helpers.ts";
import {
  applyBumpStrategy,
  bumpVersion,
  compareVersions,
  formatVersion,
  type IsoDate,
  parseIsoDate,
  parseVersion,
} from "./versions.ts";

describe("versions and dates", () => {
  test("parseVersion reads prefix, prerelease and build", () => {
    expect(parseVersion("v1.2.3-rc.1+build.5")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: "rc.1",
      build: "build.5",
    });
  });

  test.each(["1.2", "01.2.3", "1.2.3-", "version"])(
    "parseVersion rejects %p",
    (text) => {
      expect(parseVersion(text)).toBeUndefined();
    },
  );

  test.each([
    ["1.2.3", "major", "2.0.0"],
    ["1.2.3", "minor", "1.3.0"],
    ["1.2.3", "patch", "1.2.4"],
    ["1.2.3-rc.1", "patch", "1.2.4"],
  ] as const)("bumping %p by %p yields %p", (start, bump, expected) => {
    expect(formatVersion(bumpVersion(version(start), bump), "")).toBe(expected);
  });

  test.each([
    ["minor-capped", "0.3.0", "major", "minor"],
    ["minor-capped", "0.3.0", "minor", "minor"],
    ["minor-capped", "0.3.0", "patch", "patch"],
    ["shifted", "0.3.0", "major", "minor"],
    ["shifted", "0.3.0", "minor", "patch"],
    ["shifted", "0.3.0", "patch", "patch"],
    ["literal", "0.3.0", "major", "major"],
    ["literal", "0.3.0", "minor", "minor"],
    ["minor-capped", "0.0.0", "major", "minor"],
    ["minor-capped", "1.2.0", "major", "major"],
    ["shifted", "1.2.0", "major", "major"],
    ["shifted", "1.2.0", "minor", "minor"],
  ] as const)(
    "the %p strategy turns a bump of %p by %p into %p",
    (strategy, start, bump, expected) => {
      expect(applyBumpStrategy(bump, version(start), strategy)).toBe(expected);
    },
  );

  test("compareVersions follows semantic version precedence", () => {
    expect(compareVersions(version("1.10.0"), version("1.9.0"))).toBe(1);
    expect(compareVersions(version("1.0.0-rc.1"), version("1.0.0"))).toBe(-1);
    expect(compareVersions(version("v1.0.0"), version("1.0.0"))).toBe(0);
  });

  test("nextVersion starts from 0.0.0 without releases", () => {
    expect(formatVersion(nextVersion([], "minor"), "v")).toBe("v0.1.0");
  });

  test("nextVersion skips prereleases", () => {
    const releases = [release("v2.0.0-rc.1"), release("v1.4.0")];
    expect(formatVersion(nextVersion(releases, "patch"), "v")).toBe("v1.4.1");
  });

  test.each(["2026-11-17", "2024-02-29"])("parseIsoDate accepts %p", (text) => {
    expect(parseIsoDate(text)).toBe(text as IsoDate);
  });

  test.each(["2026-02-30", "2026-1-1", "17.11.2026"])(
    "parseIsoDate rejects %p",
    (text) => {
      expect(parseIsoDate(text)).toBeUndefined();
    },
  );
});
