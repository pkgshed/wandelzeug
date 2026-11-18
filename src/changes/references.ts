/**
 * References to issues, pull requests and merge requests: labels in square
 * brackets, such as "[FOO-1234]" or "[#42]", that the extra fields with a
 * url turn into links. wandelzeug finds them in the rendered notes, so a
 * reference counts whether a change format placed it from the front matter
 * or the text of a change holds it.
 */

import type { Project } from "../project/root.ts";
import { bracketedLabels } from "../shared/markdown.ts";
import { renderTemplate, type Template } from "../shared/templates.ts";

/** An extra field whose values link somewhere. */
export type LinkField = {
  readonly key: string;
  /** The label of a value, such as "#{{pr}}". */
  readonly label: Template;
  /** The web address of a value, such as "{{repositoryUrl}}/pull/{{pr}}". */
  readonly url: Template;
  /** Matches a label of the field and captures its value. */
  readonly recognizer: RegExp;
};

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");

/**
 * Builds the pattern that recognizes the labels of a field and captures
 * their value. The label must place the value exactly once, between fixed
 * text, as "#{{pr}}" does.
 */
export function labelRecognizer(
  label: Template,
  key: string,
  valuePattern: string,
): RegExp {
  const marker = "\u0000";
  const parts = renderTemplate(label, { [key]: marker }).split(marker);
  const [before = "", after = ""] = parts;
  const placesValueOnce =
    parts.length === 2 && before + after === label.literalText;
  if (!placesValueOnce) {
    throw new Error(`must place {{${key}}} exactly once between fixed text`);
  }
  return new RegExp(
    `^${escapeRegExp(before)}(${valuePattern})${escapeRegExp(after)}$`,
  );
}

/** A label in the notes with the web address that it links to. */
export type Reference = {
  readonly label: string;
  readonly url: string;
};

/** Matches a label against the link fields in their configured order. */
function resolveLabel(project: Project, label: string): Reference | undefined {
  const repositoryUrl = project.config.repositoryUrl.replace(/\/+$/, "");
  for (const field of project.linkFields) {
    const value = field.recognizer.exec(label)?.[1];
    if (value === undefined) continue;
    const url = renderTemplate(field.url, {
      [field.key]: value,
      repositoryUrl,
    });
    return { label, url: url.trim() };
  }
  return undefined;
}

/**
 * Markdown matches labels without regard to case, so "[foo-1]" and
 * "[FOO-1]" share one definition.
 */
export const normalizeLabel = (label: string): string =>
  label.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Finds the references in notes, in the order of their first appearance,
 * once per label. A label in brackets that no link field recognizes stays
 * plain text and yields no reference.
 */
export function findReferences(project: Project, notes: string): Reference[] {
  const references = bracketedLabels(notes).flatMap((label) => {
    const reference = resolveLabel(project, label);
    return reference === undefined ? [] : [reference];
  });
  return references.filter(
    (reference, index) =>
      references.findIndex(
        (other) =>
          normalizeLabel(other.label) === normalizeLabel(reference.label),
      ) === index,
  );
}

/** Formats the Markdown link definition of a reference. */
export const definitionLine = (reference: Reference): string =>
  `[${reference.label}]: ${reference.url}`;
