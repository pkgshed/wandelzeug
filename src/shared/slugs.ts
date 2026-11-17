/**
 * Slugs and titles for fragment file names. This is the only module that
 * imports @sindresorhus/slugify.
 */

import transliteratingSlugify from "@sindresorhus/slugify";

export const LIST_MARKER = /^\s*(?:[*+-]|\d+[.)])\s+/;

/** Keeps the letters and digits of any script, joined by hyphens. */
const unicodeSlug = (text: string): string =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Turns text into a lower-case slug joined by hyphens. It transliterates to
 * ASCII where it can, such as "groesse" for "Größe", and keeps a word such
 * as "TypeScript" whole. Text without any Latin form, such as Japanese,
 * keeps its own letters instead of vanishing from the file name.
 */
export function slugify(text: string): string {
  const ascii = transliteratingSlugify(text, { decamelize: false });
  return ascii !== "" ? ascii : unicodeSlug(text);
}

/** Shortens a slug to at most maxLength characters, cutting at a hyphen where possible. */
export function truncateSlug(slug: string, maxLength: number): string {
  if (slug.length <= maxLength) return slug;

  let result = "";
  for (const word of slug.split("-")) {
    const candidate = result === "" ? word : `${result}-${word}`;
    if (candidate.length > maxLength) break;
    result = candidate;
  }

  const firstWordFits = result !== "";
  return firstWordFits ? result : Array.from(slug).slice(0, maxLength).join("");
}

/** Returns the first non-blank line of a body without its list marker. */
export function deriveTitle(body: string): string {
  const firstLine =
    body.split(/\r?\n/).find((line) => line.trim() !== "") ?? "";
  return firstLine.replace(LIST_MARKER, "").trim();
}
