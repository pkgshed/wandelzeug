/**
 * Replacements keep version numbers in other files in step with the
 * changelog, such as the version in package.json. Each one finds text in a
 * file with a regular expression and puts a rendered template in its place.
 */

import {
  displayPath,
  readOptionalFile,
  withContext,
} from "../shared/foundations.ts";
import {
  renderTemplate,
  type Template,
  type TemplateView,
} from "../shared/templates.ts";

/** A replacement whose pattern and template parsed. */
export type Replacement = {
  /** The setting that defines the replacement, such as "replacements[0]". */
  readonly setting: string;
  /** The absolute path of the file. */
  readonly path: string;
  readonly find: RegExp;
  readonly replace: Template;
};

/**
 * Compiles the pattern of a replacement. It replaces every match, and ^ and
 * $ match at line breaks, as in changie, so a pattern can anchor to a line.
 */
export const compilePattern = (source: string): RegExp =>
  new RegExp(source, "gm");

/** A file that a release rewrites besides the changelog, with its new content. */
export type FileUpdate = {
  readonly path: string;
  readonly content: string;
};

/**
 * Replaces every match of a replacement in text. The rendered template
 * goes in as it is, so a "$" in it never refers to a match. A pattern that
 * matches nothing fails, because the file would silently keep an old
 * version.
 */
function applyReplacement(
  text: string,
  replacement: Replacement,
  view: TemplateView,
): string {
  if (text.match(replacement.find) === null) {
    throw new Error(
      `${replacement.setting}.find: no match for /${replacement.find.source}/`,
    );
  }
  const rendered = renderTemplate(replacement.replace, view);
  return text.replace(replacement.find, () => rendered);
}

/** Reads a file and applies its replacements in their configured order. */
async function updateFile(
  path: string,
  replacements: readonly Replacement[],
  view: TemplateView,
): Promise<FileUpdate> {
  const context = `replace in ${displayPath(path)}`;
  const original = await readOptionalFile(path);
  if (original === undefined) {
    throw new Error(`${context}: no such file`);
  }
  const content = withContext(context, () =>
    replacements.reduce(
      (text, replacement) => applyReplacement(text, replacement, view),
      original,
    ),
  );
  return { path, content };
}

/**
 * Plans the file updates of the replacements without writing anything.
 * Each file appears once, even when several replacements change it.
 */
export function planReplacements(
  replacements: readonly Replacement[],
  view: TemplateView,
): Promise<FileUpdate[]> {
  const paths = [...new Set(replacements.map((entry) => entry.path))];
  return Promise.all(
    paths.map((path) =>
      updateFile(
        path,
        replacements.filter((entry) => entry.path === path),
        view,
      ),
    ),
  );
}
