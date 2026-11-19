/**
 * Semantic versions, version bumps and calendar dates.
 */

/** The parts of a version that a bump can raise, from most to least significant. */
export const BUMPS = ["major", "minor", "patch"] as const;
export type Bump = (typeof BUMPS)[number];

export const isBump = (value: unknown): value is Bump =>
  (BUMPS as readonly unknown[]).includes(value);

/** A semantic version as described at https://semver.org. */
export type Version = {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: string | undefined;
  readonly build: string | undefined;
};

const VERSION_PATTERN =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const stableVersion = (
  major: number,
  minor: number,
  patch: number,
): Version => ({
  major,
  minor,
  patch,
  prerelease: undefined,
  build: undefined,
});

export const ZERO_VERSION = stableVersion(0, 0, 0);

/** Parses a semantic version with an optional "v" prefix. */
export function parseVersion(text: string): Version | undefined {
  const match = VERSION_PATTERN.exec(text);
  if (match === null) return undefined;

  const [, major, minor, patch, prerelease, build] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease,
    build,
  };
}

export function formatVersion(version: Version, prefix: string): string {
  const core = `${prefix}${version.major}.${version.minor}.${version.patch}`;
  const prerelease =
    version.prerelease === undefined ? "" : `-${version.prerelease}`;
  const build = version.build === undefined ? "" : `+${version.build}`;
  return core + prerelease + build;
}

/** Orders versions by semantic version precedence. */
export const compareVersions = (a: Version, b: Version): number =>
  Bun.semver.order(formatVersion(a, ""), formatVersion(b, ""));

/**
 * How "auto" bumps while the version is 0.y.z, which Semantic Versioning
 * reserves for initial development:
 *
 * - minor-capped: a major bump becomes a minor bump, the others stay.
 * - shifted: every bump moves one level lower, and patch stays patch.
 * - literal: every bump stays, so a major bump leaves 0.y.z.
 */
export const BUMP_STRATEGIES = ["minor-capped", "shifted", "literal"] as const;
export type BumpStrategy = (typeof BUMP_STRATEGIES)[number];

/**
 * Adjusts a bump of the given version to a bump strategy. The strategies
 * differ only while the version is 0.y.z. From 1.0.0 on, every bump stays.
 */
export function applyBumpStrategy(
  bump: Bump,
  version: Version,
  strategy: BumpStrategy,
): Bump {
  const isInitialDevelopment = version.major === 0;
  if (!isInitialDevelopment) return bump;
  switch (strategy) {
    case "minor-capped":
      return bump === "major" ? "minor" : bump;
    case "shifted":
      return bump === "major" ? "minor" : "patch";
    case "literal":
      return bump;
  }
}

/** Raises one part of a version and resets the less significant parts. */
export function bumpVersion(version: Version, bump: Bump): Version {
  switch (bump) {
    case "major":
      return stableVersion(version.major + 1, 0, 0);
    case "minor":
      return stableVersion(version.major, version.minor + 1, 0);
    case "patch":
      return stableVersion(version.major, version.minor, version.patch + 1);
  }
}

/** A calendar date in ISO 8601 form, such as 2026-11-17. */
export type IsoDate = string & { readonly __brand: "IsoDate" };

/** Parses a YYYY-MM-DD date and rejects days that do not exist. */
export function parseIsoDate(text: string): IsoDate | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;

  const date = new Date(`${text}T00:00:00Z`);
  const isCalendarDay =
    !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text);
  return isCalendarDay ? (text as IsoDate) : undefined;
}

/** Returns today's date in the local time zone. */
export function today(): IsoDate {
  const now = new Date();
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}` as IsoDate;
}
