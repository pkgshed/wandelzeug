/**
 * Slugs and titles for fragment file names.
 */

export const LIST_MARKER = /^\s*(?:[*+-]|\d+[.)])\s+/;

/** Turns text into a lower-case slug of letters and digits joined by hyphens. */
export const slugify = (text: string): string =>
  text
    .normalize("NFKD")
    .replace(/\p{Mn}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

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
