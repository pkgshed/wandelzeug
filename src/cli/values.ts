/**
 * Value parsers that turn the text of options and arguments into the types
 * of wandelzeug, such as versions, dates and bumps. Together with the
 * grammar in arguments.ts, this directory is the only place that imports
 * Optique.
 */

import { message, text, value } from "@optique/core/message";
import type { NonEmptyString } from "@optique/core/nonempty";
import { choice, keyValue, type ValueParser } from "@optique/core/valueparser";
import type { Release } from "../changelog/markers.ts";
import {
  BUMP_ARGUMENTS,
  type BumpArgument,
  parseReleaseTarget,
  type ReleaseTarget,
} from "../changelog/releases.ts";
import { type GitRef, parseGitRef } from "../project/checks.ts";
import {
  formatVersion,
  type IsoDate,
  parseIsoDate,
  parseVersion,
  ZERO_VERSION,
} from "../shared/versions.ts";

/** How a value parser reads text and writes its value back, as for help output. */
type ValueSyntax<T> = {
  readonly metavar: NonEmptyString;
  /** Describes the accepted text for the error, as in "a semantic version". */
  readonly expected: string;
  /** A valid value that Optique may use before the real one is known. */
  readonly placeholder: T;
  /** Returns undefined for text that the syntax does not accept. */
  readonly parse: (text: string) => T | undefined;
  readonly format: (parsed: T) => string;
};

/** Builds a synchronous value parser from a parse function of wandelzeug. */
const valueParser = <T>(syntax: ValueSyntax<T>): ValueParser<"sync", T> => ({
  mode: "sync",
  metavar: syntax.metavar,
  placeholder: syntax.placeholder,
  format: syntax.format,
  parse(input) {
    const parsed = syntax.parse(input);
    if (parsed === undefined) {
      return {
        success: false,
        error: message`expected ${text(syntax.expected)}, but got ${value(input)}`,
      };
    }
    return { success: true, value: parsed };
  },
});

/** A semantic version, kept with its spelling, such as "1.4.2". */
export const releaseValue = valueParser<Release>({
  metavar: "VERSION",
  expected: "a semantic version",
  placeholder: { name: "0.0.0", version: ZERO_VERSION },
  parse(text) {
    const version = parseVersion(text);
    return version === undefined ? undefined : { name: text, version };
  },
  format: (release) => release.name,
});

/** A calendar date as YYYY-MM-DD. */
export const isoDateValue = valueParser<IsoDate>({
  metavar: "DATE",
  expected: "a date as YYYY-MM-DD",
  placeholder: "1970-01-01" as IsoDate,
  parse: parseIsoDate,
  format: (date) => date,
});

/** A git revision that cannot pass for an option of git. */
export const gitRefValue = valueParser<GitRef>({
  metavar: "REF",
  expected: "a git revision that does not start with -",
  placeholder: "HEAD" as GitRef,
  parse: parseGitRef,
  format: (ref) => ref,
});

/** A bump, such as minor or auto. */
export const bumpValue: ValueParser<"sync", BumpArgument> = choice(
  BUMP_ARGUMENTS,
  { metavar: "BUMP" },
);

/** What "wlz batch" releases: an explicit version or a bump. */
export const releaseTargetValue = valueParser<ReleaseTarget>({
  metavar: "VERSION",
  expected: `a semantic version or one of: ${BUMP_ARGUMENTS.join(", ")}`,
  placeholder: { type: "bump", bump: "auto" },
  parse: parseReleaseTarget,
  format: (target) =>
    target.type === "bump" ? target.bump : formatVersion(target.version, ""),
});

/**
 * The web address of a repository, without trailing slashes. Only http
 * and https addresses make sense in changelog links.
 */
export const repositoryUrlValue = valueParser<string>({
  metavar: "URL",
  expected: "an http or https address",
  placeholder: "https://example.com",
  parse(text) {
    const isWebAddress =
      URL.canParse(text) &&
      ["https:", "http:"].includes(new URL(text).protocol);
    return isWebAddress ? text.replace(/\/+$/, "") : undefined;
  },
  format: (url) => url,
});

/** A front matter entry, such as pr=42. The key and the value keep their spaces for "new" to judge. */
export const metaEntryValue = keyValue({ metavar: "KEY=VALUE" });
