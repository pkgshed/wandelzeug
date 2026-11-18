/**
 * The notes of a release for use outside the changelog, as "wlz show"
 * prints them for the description of a GitHub release. The notes end with
 * the link definitions that they use, because the changelog keeps those at
 * its bottom.
 */

import {
  definitionLine,
  findReferences,
  normalizeLabel,
} from "../changes/references.ts";
import type { Project } from "../project/root.ts";
import { referencedLabels } from "../shared/markdown.ts";
import { type ChangelogDocument, linkDefinitions } from "./markers.ts";

/**
 * Lists the link definitions that notes use, in the order of the notes:
 * those between the link markers, such as the link of the release, and
 * those of the references that the link fields recognize. A definition in
 * the changelog wins over a generated one with the same label.
 */
export function usedDefinitions(
  project: Project,
  document: ChangelogDocument,
  notes: string,
): string[] {
  const candidates = [
    ...linkDefinitions(document),
    ...findReferences(project, notes).map((reference) => ({
      label: reference.label,
      line: definitionLine(reference),
    })),
  ];
  const lines = new Map<string, string>();
  for (const candidate of candidates) {
    const label = normalizeLabel(candidate.label);
    if (!lines.has(label)) lines.set(label, candidate.line);
  }

  const used = referencedLabels(
    notes,
    candidates.map((candidate) => candidate.line),
  ).map(normalizeLabel);
  return [...new Set(used)].flatMap((label) => {
    const line = lines.get(label);
    return line === undefined ? [] : [line];
  });
}

/** Appends link definitions to notes after a blank line, if there are any. */
export const withDefinitions = (
  notes: string,
  definitions: readonly string[],
): string =>
  definitions.length === 0
    ? notes
    : `${notes.trimEnd()}\n\n${definitions.join("\n")}`;
